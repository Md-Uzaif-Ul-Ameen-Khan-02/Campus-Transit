from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import eta, geo
from ..config import settings
from ..db import get_db
from ..deps import get_current_student_profile, get_current_user
from ..location_service import get_setting, occupancy_level
from ..models import Notification, Route, StudentProfile, Trip, User, utcnow
from ..schemas import PickupIn, RouteSelectionIn

router = APIRouter(prefix="/student", tags=["student"])

LIVE_STATUSES = ["active", "delayed", "emergency"]


def _summary(db: Session, sp: StudentProfile) -> dict:
    route = db.get(Route, sp.route_id) if sp.route_id else None
    return {
        "route": {
            "id": route.id,
            "name": route.name,
            "code": route.code,
            "color": route.color,
            "lengthM": round(geo.route_length_m(route.geometry or []), 1),
            "geometry": route.geometry or [],
            "landmarks": route.landmarks or [],
            "direction": route.direction,
        }
        if route
        else None,
        "pickup": {
            "lat": sp.pickup_lat,
            "lng": sp.pickup_lng,
            "label": sp.pickup_label,
            "routePosM": sp.pickup_route_pos_m,
            "verified": sp.pickup_verified,
        }
        if sp.pickup_lat is not None
        else None,
        "notifyEnabled": sp.notify_enabled,
    }


@router.get("/summary")
def my_summary(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    sp: StudentProfile = Depends(get_current_student_profile),
):
    return _summary(db, sp)


@router.post("/route")
def select_route(
    data: RouteSelectionIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    sp: StudentProfile = Depends(get_current_student_profile),
):
    if data.route_id is not None:
        route = db.get(Route, data.route_id)
        if not route or not route.active:
            raise HTTPException(404, "Route not found or inactive")
        if sp.route_id != data.route_id:
            # reset pickup when switching routes
            sp.pickup_lat = None
            sp.pickup_lng = None
            sp.pickup_route_pos_m = None
            sp.pickup_verified = False
            sp.last_stage = 0
    else:
        sp.route_id = None
        sp.pickup_lat = None
        sp.pickup_lng = None
        sp.pickup_route_pos_m = None
        sp.pickup_verified = False
    sp.route_id = data.route_id
    db.commit()
    return _summary(db, sp)


@router.post("/pickup")
def set_pickup(
    data: PickupIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    sp: StudentProfile = Depends(get_current_student_profile),
):
    if not sp.route_id:
        raise HTTPException(400, "Select a route before choosing a pickup point")
    route = db.get(Route, sp.route_id)
    geometry = route.geometry or []
    if len(geometry) < 2:
        raise HTTPException(400, "This route has no map geometry yet — contact the transport office")

    pos, snap_lat, snap_lng, off = geo.project_point_to_route(data.lat, data.lng, geometry)
    max_snap = float(get_setting(db, "pickup_max_snap_distance_m", settings.pickup_max_snap_distance_m))
    if off > max_snap:
        raise HTTPException(
            422,
            f"This location does not appear to be along the selected route ({int(off)} m away). Choose a closer point, another route, or contact transport administration.",
        )
    sp.pickup_lat = data.lat
    sp.pickup_lng = data.lng
    sp.pickup_label = data.label or "My pickup point"
    sp.pickup_route_pos_m = pos
    sp.pickup_verified = True
    sp.last_stage = 0
    db.commit()
    return {
        **_summary(db, sp),
        "snap": {"routePosM": round(pos, 1), "snapLat": snap_lat, "snapLng": snap_lng, "offRouteM": round(off, 1)},
    }


@router.get("/tracking")
def my_tracking(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    sp: StudentProfile = Depends(get_current_student_profile),
):
    """Auto-discovers the active trip(s) serving the student's route — no bus number needed."""
    if not sp.route_id or sp.pickup_route_pos_m is None:
        return {"tracking": False, "reason": "no_route_or_pickup"}

    route = db.get(Route, sp.route_id)
    trips = (
        db.query(Trip)
        .filter(Trip.route_id == sp.route_id, Trip.status.in_(LIVE_STATUSES))
        .all()
    )
    if not trips:
        # next scheduled trip today for information
        today = utcnow().strftime("%Y-%m-%d")
        upcoming = (
            db.query(Trip)
            .filter(
                Trip.route_id == sp.route_id,
                Trip.trip_date == today,
                Trip.status.in_(["scheduled", "assigned", "ready", "delayed"]),
            )
            .order_by(Trip.scheduled_start)
            .all()
        )
        return {
            "tracking": False,
            "route": {
                "id": route.id,
                "name": route.name,
                "color": route.color,
                "geometry": route.geometry or [],
                "landmarks": route.landmarks or [],
            },
            "pickup": {
                "lat": sp.pickup_lat,
                "lng": sp.pickup_lng,
                "label": sp.pickup_label,
                "routePosM": sp.pickup_route_pos_m,
            },
            "upcoming": [
                {
                    "tripId": t.id,
                    "scheduledStart": t.scheduled_start,
                    "bus": t.bus_rel.registration_number if t.bus_rel else "TBD",
                    "driver": t.driver_rel.user.full_name if t.driver_rel and t.driver_rel.user else "TBD",
                    "status": t.status,
                    "delayMin": t.delay_min,
                }
                for t in upcoming
            ],
        }

    buses = []
    stale_after = float(get_setting(db, "location_stale_after_sec", settings.location_stale_after_sec))
    for t in trips:
        item = {
            "tripId": t.id,
            "busId": t.bus_id,
            "busReg": t.bus_rel.registration_number if t.bus_rel else "",
            "busName": (t.bus_rel.display_name or t.bus_rel.registration_number) if t.bus_rel else "",
            "capacity": t.bus_rel.capacity if t.bus_rel else 0,
            "status": t.status,
            "delayMin": t.delay_min,
            "lat": t.current_lat,
            "lng": t.current_lng,
            "speedKmh": round(t.current_speed * 3.6, 1),
            "heading": t.current_heading,
            "routePosM": round(t.route_pos_m, 1),
            "progress": t.progress,
            "occupancy": t.occupancy,
            "occupancyLevel": occupancy_level(db, t.occupancy, t.bus_rel.capacity) if t.bus_rel else "low",
            "source": t.source,
            "lastFixAt": t.last_fix_at.isoformat() + "Z" if t.last_fix_at else None,
            "isStale": eta.trip_stale(t) if t.last_fix_at else True,
            "staleAfterSec": stale_after,
            "emergency": t.status == "emergency",
        }
        e = eta.compute_eta(db, t, sp.pickup_route_pos_m)
        item["eta"] = e
        buses.append(item)

    # earliest ETA bus first
    def _key(b):
        if b["eta"].get("available") and not b["eta"].get("passed"):
            return (0, b["eta"]["eta_sec"])
        return (1, 0)

    buses.sort(key=_key)
    return {
        "tracking": True,
        "route": {
            "id": route.id,
            "name": route.name,
            "color": route.color,
            "geometry": route.geometry or [],
            "landmarks": route.landmarks or [],
        },
        "pickup": {
            "lat": sp.pickup_lat,
            "lng": sp.pickup_lng,
            "label": sp.pickup_label,
            "routePosM": sp.pickup_route_pos_m,
        },
        "buses": buses,
        "primaryTripId": buses[0]["tripId"] if buses else None,
    }


@router.get("/pickup-options")
def pickup_options(
    lat: float,
    lng: float,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    sp: StudentProfile = Depends(get_current_student_profile),
):
    """Suggest nearest points along the selected route for a raw coordinate."""
    if not sp.route_id:
        raise HTTPException(400, "Select a route first")
    route = db.get(Route, sp.route_id)
    geometry = route.geometry or []
    if len(geometry) < 2:
        raise HTTPException(400, "Route has no geometry")
    pos, snap_lat, snap_lng, off = geo.project_point_to_route(lat, lng, geometry)
    landmarks = route.landmarks or []
    nearest_landmark = None
    best = float("inf")
    for lm in landmarks:
        d = geo.haversine_m(lat, lng, lm.get("lat", 0), lm.get("lng", 0))
        if d < best:
            best = d
            nearest_landmark = {"name": lm.get("name"), "distanceM": round(d)}
    return {
        "routePosM": round(pos, 1),
        "snapLat": snap_lat,
        "snapLng": snap_lng,
        "offRouteM": round(off, 1),
        "nearestLandmark": nearest_landmark,
    }


class NotifyToggle(BaseModel):
    enabled: bool


@router.post("/notifications/toggle")
def toggle_notifications(
    data: NotifyToggle,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
    sp: StudentProfile = Depends(get_current_student_profile),
):
    sp.notify_enabled = data.enabled
    db.commit()
    return {"ok": True, "enabled": sp.notify_enabled}
