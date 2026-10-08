from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import geo
from ..db import get_db
from ..deps import require_admin, require_any
from ..location_service import log_audit
from ..models import Route, StudentProfile, Trip, User
from ..schemas import RouteIn, RouteOut

router = APIRouter(prefix="/routes", tags=["routes"])


def _route_out(r: Route, db: Session) -> RouteOut:
    students = db.query(StudentProfile).filter(StudentProfile.route_id == r.id).count()
    return RouteOut(
        id=r.id,
        name=r.name,
        code=r.code,
        description=r.description,
        direction=r.direction,
        color=r.color,
        active=r.active,
        geometry=r.geometry or [],
        landmarks=r.landmarks or [],
        standard_duration_min=r.standard_duration_min,
        length_m=round(geo.route_length_m(r.geometry or []), 1),
        student_count=students,
    )


@router.get("", response_model=list[RouteOut])
def list_routes(include_inactive: bool = False, db: Session = Depends(get_db), user: User = Depends(require_any)):
    q = db.query(Route)
    if not include_inactive:
        q = q.filter(Route.active == True)  # noqa: E712
    routes = q.order_by(Route.name).all()
    return [_route_out(r, db) for r in routes]


@router.get("/{route_id}", response_model=RouteOut)
def get_route(route_id: str, db: Session = Depends(get_db), user: User = Depends(require_any)):
    r = db.get(Route, route_id)
    if not r:
        raise HTTPException(404, "Route not found")
    return _route_out(r, db)


@router.post("", response_model=RouteOut)
def create_route(data: RouteIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    if data.direction not in ("outbound", "inbound"):
        raise HTTPException(400, "Direction must be outbound or inbound")
    geometry = [[p[0], p[1]] for p in (data.geometry or [])]
    if geometry and len(geometry) < 2:
        raise HTTPException(400, "Route geometry needs at least two points")
    r = Route(
        name=data.name,
        code=data.code,
        description=data.description,
        direction=data.direction,
        color=data.color,
        active=data.active,
        geometry=geometry,
        landmarks=[lm.model_dump() for lm in data.landmarks],
        standard_duration_min=data.standard_duration_min,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    length_km = geo.route_length_m(geometry) / 1000
    log_audit(db, user, "route.created", f"Route {r.name} created ({length_km:.1f} km)")
    return _route_out(r, db)


@router.put("/{route_id}", response_model=RouteOut)
def update_route(route_id: str, data: RouteIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    r = db.get(Route, route_id)
    if not r:
        raise HTTPException(404, "Route not found")
    geometry = [[p[0], p[1]] for p in (data.geometry or [])]
    r.name = data.name
    r.code = data.code
    r.description = data.description
    r.direction = data.direction
    r.color = data.color
    r.geometry = geometry
    r.landmarks = [lm.model_dump() for lm in data.landmarks]
    r.standard_duration_min = data.standard_duration_min
    if not data.active and r.active:
        on_trip = (
            db.query(Trip)
            .filter(Trip.route_id == route_id, Trip.status.in_(["active", "delayed", "emergency"]))
            .first()
        )
        if on_trip:
            raise HTTPException(409, "Route has an active trip — end it first")
        r.active = False
    elif data.active:
        r.active = True
    db.commit()
    db.refresh(r)
    log_audit(db, user, "route.updated", f"Route {r.name} updated")
    return _route_out(r, db)


@router.post("/{route_id}/snap")
def snap_point(route_id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(require_any)):
    """Project a coordinate onto this route — used by pickup selection UI."""
    r = db.get(Route, route_id)
    if not r:
        raise HTTPException(404, "Route not found")
    try:
        lat = float(payload.get("lat"))
        lng = float(payload.get("lng"))
    except (TypeError, ValueError):
        raise HTTPException(400, "lat and lng are required")
    geometry = r.geometry or []
    if len(geometry) < 2:
        raise HTTPException(400, "Route has no geometry yet")
    pos, snap_lat, snap_lng, off = geo.project_point_to_route(lat, lng, geometry)
    max_snap = 800
    return {
        "routePosM": round(pos, 1),
        "snapLat": snap_lat,
        "snapLng": snap_lng,
        "offRouteM": round(off, 1),
        "valid": off <= max_snap,
        "routeLengthM": round(geo.route_length_m(geometry), 1),
    }
