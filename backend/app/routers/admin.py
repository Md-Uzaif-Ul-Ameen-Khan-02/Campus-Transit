from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_admin
from ..eta import trip_stale
from ..location_service import get_setting, occupancy_level
from ..models import Bus, Driver, Notification, Route, StudentProfile, Trip, User, utcnow

router = APIRouter(prefix="/admin", tags=["admin"])

LIVE_STATUSES = ["active", "delayed", "emergency"]


@router.get("/overview")
def overview(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    today = utcnow().strftime("%Y-%m-%d")
    active_trips = db.query(Trip).filter(Trip.status.in_(LIVE_STATUSES)).all()
    scheduled_today = (
        db.query(Trip)
        .filter(Trip.trip_date == today, Trip.status.in_(["scheduled", "assigned", "ready", "delayed"]))
        .count()
    )
    completed_today = db.query(Trip).filter(Trip.trip_date == today, Trip.status == "completed").count()
    delayed = db.query(Trip).filter(Trip.status.in_(["delayed", "emergency"])).count()
    emergency = db.query(Trip).filter(Trip.status == "emergency").count()

    # Students currently tracking (have route + pickup configured)
    tracking_students = (
        db.query(StudentProfile)
        .filter(StudentProfile.route_id.isnot(None), StudentProfile.pickup_route_pos_m.isnot(None))
        .count()
    )

    return {
        "totals": {
            "buses": db.query(Bus).count(),
            "buses_active": db.query(Bus).filter(Bus.status == "active").count(),
            "buses_available": db.query(Bus).filter(Bus.status == "available").count(),
            "buses_maintenance": db.query(Bus).filter(Bus.status == "maintenance").count(),
            "drivers": db.query(Driver).filter(Driver.active == True).count(),  # noqa: E712
            "drivers_on_trip": db.query(Driver).filter(Driver.status == "on_trip").count(),
            "routes": db.query(Route).filter(Route.active == True).count(),  # noqa: E712
            "students": db.query(User).filter(User.role == "student").count(),
        },
        "today": {
            "date": today,
            "scheduledTrips": scheduled_today,
            "activeTrips": len(active_trips),
            "completedTrips": completed_today,
            "delayed": delayed,
            "emergency": emergency,
            "studentsTracking": tracking_students,
        },
        "activeTripsList": [_trip_live(db, t) for t in active_trips],
    }


def _trip_live(db: Session, t: Trip) -> dict:
    return {
        "tripId": t.id,
        "routeId": t.route_id,
        "routeName": t.route_rel.name if t.route_rel else "",
        "routeColor": t.route_rel.color if t.route_rel else "#2563eb",
        "busReg": t.bus_rel.registration_number if t.bus_rel else "",
        "busId": t.bus_id,
        "capacity": t.bus_rel.capacity if t.bus_rel else 0,
        "driverName": t.driver_rel.user.full_name if t.driver_rel and t.driver_rel.user else "",
        "status": t.status,
        "occupancy": t.occupancy,
        "occupancyLevel": occupancy_level(db, t.occupancy, t.bus_rel.capacity) if t.bus_rel else "low",
        "speedKmh": round(t.current_speed * 3.6, 1),
        "lat": t.current_lat,
        "lng": t.current_lng,
        "heading": t.current_heading,
        "progress": t.progress,
        "lastFixAt": t.last_fix_at.isoformat() + "Z" if t.last_fix_at else None,
        "isStale": trip_stale(t) if t.last_fix_at else True,
        "source": t.source,
        "scheduledStart": t.scheduled_start,
        "delayMin": t.delay_min,
        "emergencyType": t.emergency_type,
        "viewers": _viewers(db, t.route_id),
    }


def _viewers(db: Session, route_id: str) -> int:
    return (
        db.query(StudentProfile)
        .filter(StudentProfile.route_id == route_id, StudentProfile.pickup_route_pos_m.isnot(None))
        .count()
    )


@router.get("/live")
def live_ops(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    trips = db.query(Trip).filter(Trip.status.in_(LIVE_STATUSES)).all()
    return [_trip_live(db, t) for t in trips]


@router.get("/pickup-distribution")
def pickup_distribution(route_id: str, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    profiles = (
        db.query(StudentProfile)
        .filter(StudentProfile.route_id == route_id, StudentProfile.pickup_route_pos_m.isnot(None))
        .all()
    )
    return [
        {
            "routePosM": round(p.pickup_route_pos_m, 1),
            "lat": p.pickup_lat,
            "lng": p.pickup_lng,
            "label": p.pickup_label,
        }
        for p in profiles
    ]
