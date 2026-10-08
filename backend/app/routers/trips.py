from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import demo_simulator, eta, geo
from ..db import get_db
from ..deps import get_current_driver, get_current_user, require_admin
from ..location_service import (
    get_setting,
    ingest_location,
    log_audit,
    notify_students_of_route,
    occupancy_level,
)
from ..events import bus as event_bus
from ..models import (
    AssignmentLog,
    Bus,
    DemoRun,
    Driver,
    LocationPoint,
    OccupancyRecord,
    Route,
    StudentProfile,
    Trip,
    User,
    utcnow,
)
from ..schemas import (
    DelayReportIn,
    DriverOut,
    EmergencyIn,
    LocationIn,
    OccupancyIn,
    ReplaceBusIn,
    ReplaceDriverIn,
    TripIn,
    TripOut,
)

router = APIRouter(prefix="/trips", tags=["trips"])

LIVE_STATUSES = ["active", "delayed", "emergency"]


def _trip_out(db: Session, t: Trip) -> dict:
    route = t.route_rel
    bus = t.bus_rel
    driver = t.driver_rel
    driver_name = ""
    if driver:
        driver_name = driver.user.full_name if driver.user else ""
    return {
        "id": t.id,
        "route_id": t.route_id,
        "bus_id": t.bus_id,
        "driver_id": t.driver_id,
        "trip_date": t.trip_date,
        "scheduled_start": t.scheduled_start,
        "scheduled_end": t.scheduled_end,
        "status": t.status,
        "occupancy": t.occupancy,
        "delay_min": t.delay_min,
        "source": t.source,
        "current_lat": t.current_lat,
        "current_lng": t.current_lng,
        "route_name": route.name if route else "",
        "route_color": route.color if route else "#2563eb",
        "bus_reg": bus.registration_number if bus else "",
        "bus_name": (bus.display_name or bus.registration_number) if bus else "",
        "capacity": bus.capacity if bus else 0,
        "driver_name": driver_name,
        "last_fix_at": t.last_fix_at,
        "route_pos_m": round(t.route_pos_m, 1),
        "progress": t.progress,
        "speed_kmh": round(t.current_speed * 3.6, 1),
        "actual_start": t.actual_start,
        "actual_end": t.actual_end,
        "emergency_type": t.emergency_type,
        "replacement_bus_id": t.replacement_bus_id,
        "original_bus_id": t.original_bus_id,
    }


@router.get("")
def list_trips(
    date: str | None = Query(None),
    route_id: str | None = Query(None),
    status: str | None = Query(None),
    mine: bool = False,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(Trip)
    if date:
        q = q.filter(Trip.trip_date == date)
    if route_id:
        q = q.filter(Trip.route_id == route_id)
    if status:
        q = q.filter(Trip.status.in_(status.split(",")))
    if mine and user.role == "driver":
        drv = db.query(Driver).filter(Driver.user_id == user.id).first()
        if drv:
            q = q.filter(Trip.driver_id == drv.id)
    trips = q.order_by(Trip.trip_date.desc(), Trip.scheduled_start.desc()).limit(500).all()
    return [_trip_out(db, t) for t in trips]


@router.post("", status_code=201)
def create_trip(data: TripIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    route = db.get(Route, data.route_id)
    if not route or not route.active:
        raise HTTPException(400, "Route not found or inactive")
    if not _valid_time(data.scheduled_start) or (data.scheduled_end and not _valid_time(data.scheduled_end)):
        raise HTTPException(400, "Times must be in HH:MM format")
    if data.scheduled_end and data.scheduled_end <= data.scheduled_start:
        raise HTTPException(400, "Scheduled end must be after start")
    if data.status not in ("scheduled", "assigned"):
        raise HTTPException(400, "Initial status must be scheduled or assigned")

    bus = db.get(Bus, data.bus_id) if data.bus_id else None
    driver = db.get(Driver, data.driver_id) if data.driver_id else None
    if data.bus_id and (not bus or not bus.active):
        raise HTTPException(400, "Bus not found or inactive")
    if data.driver_id and (not driver or not driver.active):
        raise HTTPException(400, "Driver not found or inactive")

    _validate_assignment(db, data.trip_date, data.scheduled_start, data.scheduled_end, bus, driver)

    t = Trip(
        route_id=data.route_id,
        bus_id=data.bus_id,
        driver_id=data.driver_id,
        trip_date=data.trip_date,
        scheduled_start=data.scheduled_start,
        scheduled_end=data.scheduled_end or _estimate_end(route, data.scheduled_start),
        status=data.status if (data.bus_id and data.driver_id) else "scheduled",
    )
    db.add(t)
    db.flush()
    db.add(
        AssignmentLog(
            trip_id=t.id,
            change="created",
            new_bus_id=data.bus_id,
            new_driver_id=data.driver_id,
            actor=user.full_name,
            note=f"Trip created for {data.trip_date} {data.scheduled_start}",
        )
    )
    db.commit()
    db.refresh(t)
    log_audit(db, user, "trip.created", f"Trip {t.id} created: {route.name} @ {data.scheduled_start} on {data.trip_date}")
    return _trip_out(db, t)


def _valid_time(s: str) -> bool:
    try:
        datetime.strptime(s, "%H:%M")
        return True
    except (ValueError, TypeError):
        return False


def _estimate_end(route: Route, start: str) -> str:
    minutes = route.standard_duration_min or 45
    try:
        h, m = map(int, start.split(":"))
        total = h * 60 + m + int(minutes)
        return f"{(total // 60) % 24:02d}:{total % 60:02d}"
    except Exception:
        return ""


def _minutes(s: str) -> int:
    h, m = map(int, s.split(":"))
    return h * 60 + m


def _validate_assignment(
    db: Session,
    trip_date: str,
    start: str,
    end: str | None,
    bus: Bus | None,
    driver: Driver | None,
    exclude_trip_id: str | None = None,
) -> None:
    """Conflict checks: bus and driver must not overlap other trips that day."""
    end_minutes = _minutes(end) if end else _minutes(start) + 60
    q = db.query(Trip).filter(
        Trip.trip_date == trip_date,
        Trip.status.in_(["scheduled", "assigned", "ready", "active", "delayed", "emergency"]),
    )
    if exclude_trip_id:
        q = q.filter(Trip.id != exclude_trip_id)
    candidates = q.all()

    if bus:
        if bus.status == "maintenance":
            raise HTTPException(409, f"Bus {bus.registration_number} is under maintenance")
        if bus.status == "unavailable":
            raise HTTPException(409, f"Bus {bus.registration_number} is marked unavailable")
        for t in candidates:
            if t.bus_id == bus.id:
                if _overlaps(t, start, end_minutes):
                    raise HTTPException(
                        409,
                        f"Bus {bus.registration_number} is already assigned to a trip at {t.scheduled_start} on {trip_date}",
                    )
    if driver:
        for t in candidates:
            if t.driver_id == driver.id:
                if _overlaps(t, start, end_minutes):
                    raise HTTPException(
                        409,
                        f"Driver is already assigned to a trip at {t.scheduled_start} on {trip_date}",
                    )


def _overlaps(t: Trip, start: str, end_minutes: int) -> bool:
    t_start = _minutes(t.scheduled_start)
    t_end = _minutes(t.scheduled_end) if t.scheduled_end else t_start + 60
    return t_start < end_minutes and t_end > _minutes(start)


@router.get("/{trip_id}")
def get_trip(trip_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    t = db.get(Trip, trip_id)
    if not t:
        raise HTTPException(404, "Trip not found")
    return _trip_out(db, t)


@router.post("/{trip_id}/start")
def start_trip(trip_id: str, db: Session = Depends(get_db), driver: Driver = Depends(get_current_driver)):
    t = db.get(Trip, trip_id)
    if not t:
        raise HTTPException(404, "Trip not found")
    if t.driver_id != driver.id:
        raise HTTPException(403, "This trip is not assigned to you")
    if t.status in ("completed", "cancelled"):
        raise HTTPException(409, "This trip has already ended")
    if t.status in ("active", "delayed", "emergency"):
        raise HTTPException(409, "Trip is already active")
    if not t.bus_id:
        raise HTTPException(409, "No bus is assigned to this trip yet — contact the transport office")
    if t.bus_rel.status in ("maintenance", "unavailable", "inactive"):
        raise HTTPException(409, "The assigned bus is not available")
    if not (t.route_rel.geometry and len(t.route_rel.geometry) >= 2):
        raise HTTPException(409, "Route geometry is not configured — contact the transport office")

    t.status = "active"
    t.actual_start = utcnow()
    t.source = "driver_phone"
    if driver.status != "emergency":
        driver.status = "on_trip"
    if t.bus_rel.status != "maintenance":
        t.bus_rel.status = "active"
    db.add(
        AssignmentLog(
            trip_id=t.id,
            change="started",
            actor=driver.user.full_name,
            note="Trip started by driver",
        )
    )
    db.commit()

    event_bus.publish("trip.started", {"tripId": t.id, "routeId": t.route_id, "busId": t.bus_id})
    log_audit(db, driver.user, "trip.started", f"Trip {t.id} started ({t.route_rel.name})")
    return _trip_out(db, t)


@router.post("/{trip_id}/end")
def end_trip(trip_id: str, db: Session = Depends(get_db), driver: Driver = Depends(get_current_driver)):
    t = db.get(Trip, trip_id)
    if not t:
        raise HTTPException(404, "Trip not found")
    if t.driver_id != driver.id:
        raise HTTPException(403, "This trip is not assigned to you")
    if t.status not in LIVE_STATUSES:
        raise HTTPException(409, "Trip is not currently active")

    for run in db.query(DemoRun).filter(DemoRun.trip_id == t.id, DemoRun.running == True).all():  # noqa: E712
        run.running = False

    t.status = "completed"
    t.actual_end = utcnow()
    t.emergency_type = ""
    if t.bus_rel and t.bus_rel.status == "active":
        t.bus_rel.status = "available"
    driver.status = "available"
    db.add(
        AssignmentLog(
            trip_id=t.id,
            change="completed",
            actor=driver.user.full_name,
            note="Trip completed",
        )
    )
    db.commit()

    event_bus.publish(
        "trip.ended",
        {"tripId": t.id, "routeId": t.route_id, "busId": t.bus_id},
    )
    log_audit(db, driver.user, "trip.ended", f"Trip {t.id} completed ({t.route_rel.name})")
    return _trip_out(db, t)


@router.post("/{trip_id}/location")
def post_location(
    trip_id: str,
    data: LocationIn,
    db: Session = Depends(get_db),
    driver: Driver = Depends(get_current_driver),
):
    t = db.get(Trip, trip_id)
    if not t:
        raise HTTPException(404, "Trip not found")
    if t.driver_id != driver.id:
        raise HTTPException(403, "Not your trip")
    if t.status not in LIVE_STATUSES:
        raise HTTPException(409, "Trip is not active — start it before sharing location")
    result = ingest_location(
        db,
        t,
        lat=data.lat,
        lng=data.lng,
        accuracy=data.accuracy,
        speed=data.speed,
        heading=data.heading,
        device_time=data.device_time,
        source=data.source if data.source in ("driver_phone", "iot_device") else "driver_phone",
    )
    if not result["accepted"]:
        raise HTTPException(422, result["reason"])
    return result


@router.post("/{trip_id}/occupancy")
def post_occupancy(
    trip_id: str,
    data: OccupancyIn,
    db: Session = Depends(get_db),
    driver: Driver = Depends(get_current_driver),
):
    t = db.get(Trip, trip_id)
    if not t:
        raise HTTPException(404, "Trip not found")
    if t.driver_id != driver.id:
        raise HTTPException(403, "Not your trip")
    if t.status not in LIVE_STATUSES:
        raise HTTPException(409, "Trip is not active")
    capacity = t.bus_rel.capacity if t.bus_rel else 0
    t.occupancy = data.count
    db.add(OccupancyRecord(trip_id=t.id, count=data.count, capacity=capacity, level=occupancy_level(db, data.count, capacity)))
    db.commit()
    event_bus.publish(
        "bus.occupancy.updated",
        {
            "tripId": t.id,
            "routeId": t.route_id,
            "occupancy": data.count,
            "capacity": capacity,
            "level": occupancy_level(db, data.count, capacity),
        },
    )
    return {"ok": True, "count": data.count, "capacity": capacity, "level": occupancy_level(db, data.count, capacity)}


@router.post("/{trip_id}/delay")
def report_delay(
    trip_id: str,
    data: DelayReportIn,
    db: Session = Depends(get_db),
    driver: Driver = Depends(get_current_driver),
):
    t = db.get(Trip, trip_id)
    if not t:
        raise HTTPException(404, "Trip not found")
    if t.driver_id != driver.id:
        raise HTTPException(403, "Not your trip")
    if t.status not in LIVE_STATUSES + ["assigned", "ready"]:
        raise HTTPException(409, "Trip is not startable")
    reason_text = {
        "traffic": "Traffic congestion",
        "mechanical": "Mechanical problem",
        "road_blockage": "Road blockage",
        "weather": "Weather conditions",
        "other": "Operational delay",
    }.get(data.reason, "Delay")
    t.delay_min = max(t.delay_min, data.minutes)
    if t.status in ("assigned", "ready"):
        t.status = "delayed"
    elif t.status in LIVE_STATUSES:
        t.status = "delayed" if t.status != "emergency" else t.status
    db.add(
        AssignmentLog(
            trip_id=t.id,
            change="delay_reported",
            actor=driver.user.full_name,
            note=f"{reason_text}: ~{data.minutes:.0f} min",
        )
    )
    db.commit()

    event_bus.publish("trip.delayed", {"tripId": t.id, "routeId": t.route_id, "minutes": data.minutes, "reason": reason_text})
    notify_students_of_route(
        db,
        t.route_id,
        "delay",
        "Bus delayed",
        f"{reason_text} — your bus may be about {data.minutes:.0f} minutes late.",
        trip_id=t.id,
    )
    log_audit(db, driver.user, "trip.delay", f"Delay reported on trip {t.id}: {reason_text} ~{data.minutes:.0f}m")
    return {"ok": True, "delay_min": t.delay_min}


@router.post("/{trip_id}/emergency")
def trigger_emergency(
    trip_id: str,
    data: EmergencyIn,
    db: Session = Depends(get_db),
    driver: Driver = Depends(get_current_driver),
):
    t = db.get(Trip, trip_id)
    if not t:
        raise HTTPException(404, "Trip not found")
    if t.driver_id != driver.id:
        raise HTTPException(403, "Not your trip")
    if t.status == "emergency":
        return _trip_out(db, t)
    if t.status not in LIVE_STATUSES:
        raise HTTPException(409, "Trip is not active")

    t.status = "emergency"
    t.emergency_type = data.kind
    t.emergency_at = utcnow()
    driver.status = "emergency"
    db.add(
        AssignmentLog(
            trip_id=t.id,
            change="emergency",
            actor=driver.user.full_name,
            note=f"Emergency ({data.kind}): {data.note}",
        )
    )
    db.commit()

    event_bus.publish(
        "emergency.triggered",
        {
            "tripId": t.id,
            "routeId": t.route_id,
            "busId": t.bus_id,
            "kind": data.kind,
            "lat": t.current_lat,
            "lng": t.current_lng,
        },
    )
    log_audit(db, driver.user, "emergency.triggered", f"Emergency {data.kind} on trip {t.id}")
    return _trip_out(db, t)


@router.post("/{trip_id}/emergency/resolve")
def resolve_emergency(
    trip_id: str,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    t = db.get(Trip, trip_id)
    if not t:
        raise HTTPException(404, "Trip not found")
    if t.status != "emergency":
        raise HTTPException(409, "Trip is not in emergency state")
    t.status = "delayed" if t.delay_min > 0 else "active"
    t.emergency_type = ""
    if t.driver_rel and t.driver_rel.status == "emergency":
        t.driver_rel.status = "on_trip"
    db.commit()
    event_bus.publish("emergency.resolved", {"tripId": t.id, "routeId": t.route_id})
    log_audit(db, user, "emergency.resolved", f"Emergency resolved on trip {t.id}")
    return _trip_out(db, t)


@router.post("/{trip_id}/replace-bus")
def replace_bus(
    trip_id: str,
    data: ReplaceBusIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    t = db.get(Trip, trip_id)
    if not t:
        raise HTTPException(404, "Trip not found")
    if t.status in ("completed", "cancelled"):
        raise HTTPException(409, "Cannot replace the bus of an ended trip")
    new_bus = db.get(Bus, data.bus_id)
    if not new_bus:
        raise HTTPException(404, "New bus not found")
    if not new_bus.active:
        raise HTTPException(400, "New bus is inactive")
    if new_bus.id == t.bus_id:
        raise HTTPException(400, "Selected bus is already assigned to this trip")
    if new_bus.status == "maintenance":
        raise HTTPException(409, f"Bus {new_bus.registration_number} is under maintenance")
    if new_bus.status == "unavailable":
        raise HTTPException(409, f"Bus {new_bus.registration_number} is marked unavailable")
    _validate_assignment(
        db,
        t.trip_date,
        t.scheduled_start,
        t.scheduled_end,
        new_bus,
        None,
        exclude_trip_id=t.id,
    )

    old_bus = t.bus_rel
    old_reg = old_bus.registration_number if old_bus else "none"
    was_live = t.status in LIVE_STATUSES

    if old_bus and old_bus.status == "active":
        old_bus.status = "available" if old_bus.active else "inactive"

    t.replacement_bus_id = new_bus.id
    if not t.original_bus_id:
        t.original_bus_id = t.bus_id
    t.bus_id = new_bus.id
    if t.status == "assigned" or t.status == "scheduled":
        t.status = "assigned"
    if new_bus.status in ("available", "assigned"):
        new_bus.status = "active" if was_live else "assigned"

    db.add(
        AssignmentLog(
            trip_id=t.id,
            change="replace_bus",
            old_bus_id=t.original_bus_id,
            new_bus_id=new_bus.id,
            actor=user.full_name,
            note=data.reason or f"Bus replaced: {old_reg} → {new_bus.registration_number}",
        )
    )
    db.commit()

    event_bus.publish(
        "trip.replaced",
        {
            "tripId": t.id,
            "routeId": t.route_id,
            "busId": new_bus.id,
            "busReg": new_bus.registration_number,
            "oldBusReg": old_reg,
            "live": was_live,
        },
    )
    notify_students_of_route(
        db,
        t.route_id,
        "replacement",
        "Bus changed",
        f"The bus serving your route changed from {old_reg} to {new_bus.registration_number}. Your tracking continues automatically.",
        trip_id=t.id,
    )
    log_audit(
        db,
        user,
        "trip.bus_replaced",
        f"Trip {t.id}: bus {old_reg} → {new_bus.registration_number}" + (f" ({data.reason})" if data.reason else ""),
    )
    return _trip_out(db, t)


@router.post("/{trip_id}/replace-driver")
def replace_driver(
    trip_id: str,
    data: ReplaceDriverIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    t = db.get(Trip, trip_id)
    if not t:
        raise HTTPException(404, "Trip not found")
    if t.status in ("completed", "cancelled"):
        raise HTTPException(409, "Cannot replace the driver of an ended trip")
    new_driver = db.get(Driver, data.driver_id)
    if not new_driver:
        raise HTTPException(404, "New driver not found")
    if not new_driver.active:
        raise HTTPException(400, "New driver is deactivated")
    if new_driver.id == t.driver_id:
        raise HTTPException(400, "Selected driver is already assigned to this trip")
    _validate_assignment(
        db,
        t.trip_date,
        t.scheduled_start,
        t.scheduled_end,
        None,
        new_driver,
        exclude_trip_id=t.id,
    )

    old_driver = t.driver_rel
    old_name = old_driver.user.full_name if old_driver and old_driver.user else "none"
    was_live = t.status in LIVE_STATUSES

    if old_driver and old_driver.status in ("on_trip", "assigned", "emergency"):
        old_driver.status = "available"

    if not t.original_driver_id:
        t.original_driver_id = t.driver_id
    t.driver_id = new_driver.id
    if was_live:
        new_driver.status = "on_trip"
    else:
        new_driver.status = "assigned"

    db.add(
        AssignmentLog(
            trip_id=t.id,
            change="replace_driver",
            old_driver_id=t.original_driver_id,
            new_driver_id=new_driver.id,
            actor=user.full_name,
            note=data.reason or f"Driver replaced: {old_name} → {new_driver.user.full_name}",
        )
    )
    db.commit()

    event_bus.publish("trip.replaced", {"tripId": t.id, "routeId": t.route_id, "driverId": new_driver.id})
    log_audit(db, user, "trip.driver_replaced", f"Trip {t.id}: driver {old_name} → {new_driver.user.full_name}")
    return _trip_out(db, t)


@router.post("/{trip_id}/cancel")
def cancel_trip(trip_id: str, data: dict, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    t = db.get(Trip, trip_id)
    if not t:
        raise HTTPException(404, "Trip not found")
    if t.status in ("completed", "cancelled"):
        raise HTTPException(409, "Trip already ended")
    if t.status in LIVE_STATUSES:
        for run in db.query(DemoRun).filter(DemoRun.trip_id == t.id).all():
            run.running = False
        if t.bus_rel and t.bus_rel.status == "active":
            t.bus_rel.status = "available"
        if t.driver_rel and t.driver_rel.status in ("on_trip", "emergency"):
            t.driver_rel.status = "available"
    t.status = "cancelled"
    db.add(AssignmentLog(trip_id=t.id, change="cancelled", actor=user.full_name, note=data.get("reason", "")))
    db.commit()
    event_bus.publish("trip.cancelled", {"tripId": t.id, "routeId": t.route_id})
    notify_students_of_route(
        db,
        t.route_id,
        "cancellation",
        "Trip cancelled",
        f"The {t.scheduled_start} trip on your route has been cancelled by the transport office.",
        trip_id=t.id,
    )
    log_audit(db, user, "trip.cancelled", f"Trip {t.id} cancelled")
    return _trip_out(db, t)


@router.get("/{trip_id}/track")
def track_trip(trip_id: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Full tracking snapshot for one trip: position + per-student personalized ETA."""
    t = db.get(Trip, trip_id)
    if not t:
        raise HTTPException(404, "Trip not found")
    payload = _trip_out(db, t)
    payload["is_live"] = t.status in LIVE_STATUSES
    stale_after = float(get_setting(db, "location_stale_after_sec", 25))
    payload["is_stale"] = eta.trip_stale(t) if t.last_fix_at else True
    payload["stale_after_sec"] = stale_after

    if user.role == "student":
        sp = db.query(StudentProfile).filter(StudentProfile.user_id == user.id).first()
        if sp and sp.pickup_route_pos_m is not None:
            payload["my_eta"] = eta.compute_eta(db, t, sp.pickup_route_pos_m)
            payload["my_pickup"] = {
                "lat": sp.pickup_lat,
                "lng": sp.pickup_lng,
                "label": sp.pickup_label,
                "routePosM": sp.pickup_route_pos_m,
            }
        if t.bus_rel and t.occupancy and t.bus_rel.capacity:
            payload["occupancy_level"] = occupancy_level(db, t.occupancy, t.bus_rel.capacity)
    route = t.route_rel
    payload["route_geometry"] = route.geometry or []
    return payload


@router.get("/{trip_id}/locations")
def trip_locations(
    trip_id: str,
    limit: int = Query(500, ge=1, le=5000),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    pts = (
        db.query(LocationPoint)
        .filter(LocationPoint.trip_id == trip_id)
        .order_by(LocationPoint.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "lat": p.lat,
            "lng": p.lng,
            "speed": p.speed,
            "heading": p.heading,
            "accuracy": p.accuracy,
            "routePosM": p.route_pos_m,
            "source": p.source,
            "ts": p.created_at.isoformat() + "Z",
        }
        for p in reversed(pts)
    ]


# ---------------- Demo mode (clearly separated simulated GPS) ----------------

@router.post("/{trip_id}/simulate")
def simulate_trip(
    trip_id: str,
    data: dict,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    """Start demo movement for a trip. Fixes are tagged source='demo_sim'."""
    t = db.get(Trip, trip_id)
    if not t:
        raise HTTPException(404, "Trip not found")
    if t.status not in LIVE_STATUSES:
        raise HTTPException(409, "Trip must be active to simulate movement")
    has_real_gps = (
        db.query(LocationPoint)
        .filter(LocationPoint.trip_id == t.id, LocationPoint.source == "driver_phone")
        .first()
        is not None
    )
    if has_real_gps:
        raise HTTPException(
            409,
            "This trip is receiving real driver GPS — simulation is blocked to avoid mixing fake and real data",
        )

    for run in db.query(DemoRun).filter(DemoRun.trip_id == t.id).all():
        run.running = False
    if data.get("from_start"):
        # Clean restart: forget previous fixes so jump validation accepts the new run
        t.current_lat = None
        t.current_lng = None
        t.last_fix_at = None
        t.route_pos_m = 0
        t.progress = 0
    run = DemoRun(
        trip_id=t.id,
        speed_kmh=float(data.get("speed_kmh", 28)),
        progress=0.0 if data.get("from_start") else max(t.route_pos_m, 0.0),
    )
    db.add(run)
    t.source = "demo_sim"
    db.commit()
    demo_simulator.simulator.start()
    log_audit(db, user, "demo.simulation_started", f"Demo simulation started for trip {t.id}")
    return {"ok": True, "note": "Demo simulation running — fixes tagged demo_sim"}


@router.post("/{trip_id}/simulate/stop")
def stop_simulation(trip_id: str, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    demo_simulator.simulator.stop_run(trip_id)
    db.query(DemoRun).filter(DemoRun.trip_id == trip_id).update({"running": False})
    t = db.get(Trip, trip_id)
    if t and t.source == "demo_sim":
        t.source = "driver_phone"
    db.commit()
    log_audit(db, user, "demo.simulation_stopped", f"Demo simulation stopped for trip {trip_id}")
    return {"ok": True}
