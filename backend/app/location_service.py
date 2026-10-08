from __future__ import annotations

from datetime import timedelta

from sqlalchemy.orm import Session

from . import geo
from .config import settings
from .models import AppSetting, AuditLog, LocationPoint, Notification, StudentProfile, Trip, utcnow
from .events import bus as event_bus

_SETTING_OVERRIDES: dict[str, str] = {}


def get_setting(db: Session, key: str, default):
    """Runtime-configurable setting: DB override wins, else config default."""
    row = db.get(AppSetting, key)
    if row is not None and row.value != "":
        try:
            return type(default)(row.value)
        except (TypeError, ValueError):
            return default
    return default


def set_setting(db: Session, key: str, value) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        row = AppSetting(key=key, value=str(value))
        db.add(row)
    else:
        row.value = str(value)
    db.commit()


def occupancy_level(db: Session, count: int, capacity: int) -> str:
    if capacity <= 0:
        return "low"
    pct = count / capacity * 100
    low_max = float(get_setting(db, "occupancy_low_max_pct", settings.occupancy_low_max_pct))
    high_min = float(get_setting(db, "occupancy_high_min_pct", settings.occupancy_high_min_pct))
    if pct <= low_max:
        return "low"
    if pct >= high_min:
        return "high"
    return "medium"


def notify_students_of_route(
    db: Session,
    route_id: str,
    ntype: str,
    title: str,
    body: str,
    trip_id: str | None = None,
) -> int:
    """Create in-app notifications for every student who selected this route."""
    profiles = db.query(StudentProfile).filter(StudentProfile.route_id == route_id).all()
    for sp in profiles:
        db.add(
            Notification(
                user_id=sp.user_id,
                type=ntype,
                title=title,
                body=body,
                route_id=route_id,
                trip_id=trip_id,
            )
        )
        event_bus.publish(
            "notifications.new",
            {"userId": sp.user_id, "type": ntype, "title": title, "body": body, "tripId": trip_id, "routeId": route_id},
        )
    db.commit()
    return len(profiles)


def log_audit(db: Session, actor, action: str, detail: str) -> None:
    db.add(
        AuditLog(
            actor_id=getattr(actor, "id", "") or "",
            actor_name=getattr(actor, "full_name", "") or getattr(actor, "email", "") or "system",
            action=action,
            detail=detail,
        )
    )
    db.commit()


# ---------------- GPS ingestion & validation ----------------

def ingest_location(
    db: Session,
    trip: Trip,
    lat: float,
    lng: float,
    accuracy: float,
    speed: float,
    heading: float,
    device_time=None,
    source: str = "driver_phone",
) -> dict:
    """Validate + store a GPS fix, update trip position, broadcast to subscribers.

    Returns {"accepted": bool, "reason": str, "route_pos_m": float}.
    """
    # Basic coordinate sanity is enforced at schema level; deeper checks here.
    if not (abs(lat) <= 90 and abs(lng) <= 180):
        return {"accepted": False, "reason": "Invalid coordinates"}

    stale_cut = utcnow() - timedelta(minutes=10)
    if device_time and device_time < stale_cut:
        return {"accepted": False, "reason": "Stale GPS timestamp"}

    max_acc = float(get_setting(db, "location_max_accuracy_m", settings.location_max_accuracy_m))
    if accuracy and accuracy > max_acc:
        return {"accepted": False, "reason": f"GPS accuracy too low ({int(accuracy)}m)"}

    max_speed_kmh = float(get_setting(db, "location_max_speed_kmh", settings.location_max_speed_kmh))
    if speed and speed * 3.6 > max_speed_kmh:
        return {"accepted": False, "reason": "Impossible speed reported"}

    geometry = trip.route_rel.geometry or []
    route_pos, _snap_lat, _snap_lng, _off = geo.project_point_to_route(lat, lng, geometry) if len(geometry) >= 2 else (0.0, lat, lng, 0.0)

    # Unrealistic jump detection against the last valid fix
    max_jump = float(get_setting(db, "location_max_jump_m", settings.location_max_jump_m))
    if trip.current_lat is not None and trip.last_fix_at:
        elapsed = max((utcnow() - trip.last_fix_at).total_seconds(), 0.1)
        straight = geo.haversine_m(trip.current_lat, trip.current_lng, lat, lng)
        implied_kmh = (straight / 1000.0) / (elapsed / 3600.0) if elapsed > 0 else 0
        if straight > max_jump or implied_kmh > max_speed_kmh:
            return {"accepted": False, "reason": "GPS jump rejected", "route_pos_m": trip.route_pos_m}

    trip.current_lat = lat
    trip.current_lng = lng
    trip.current_accuracy = accuracy or 0
    trip.current_speed = speed or 0
    trip.current_heading = heading if heading else _heading_from_route(geometry, route_pos)
    trip.route_pos_m = route_pos
    total_len = geo.route_length_m(geometry) or 1
    trip.progress = min(route_pos / total_len, 1.0)
    trip.last_fix_at = utcnow()

    db.add(
        LocationPoint(
            trip_id=trip.id,
            lat=lat,
            lng=lng,
            speed=speed or 0,
            heading=heading or 0,
            accuracy=accuracy or 0,
            route_pos_m=route_pos,
            source=source,
            device_time=device_time,
        )
    )
    db.commit()

    _broadcast_location(db, trip)
    _check_approach_notifications(db, trip)
    return {"accepted": True, "reason": "ok", "route_pos_m": route_pos}


def _heading_from_route(geometry, route_pos: float) -> float:
    try:
        _lat, _lng, hdg = geo.point_along_route(geometry, route_pos)
        return hdg
    except Exception:
        return 0.0


def _broadcast_location(db: Session, trip: Trip) -> None:
    event_bus.publish(
        "bus.location.updated",
        {
            "tripId": trip.id,
            "busId": trip.bus_id,
            "routeId": trip.route_id,
            "latitude": trip.current_lat,
            "longitude": trip.current_lng,
            "speed": trip.current_speed,
            "heading": trip.current_heading,
            "accuracy": trip.current_accuracy,
            "routePosM": round(trip.route_pos_m, 1),
            "progress": trip.progress,
            "occupancy": trip.occupancy,
            "source": trip.source,
            "timestamp": trip.last_fix_at.isoformat() + "Z" if trip.last_fix_at else None,
        },
    )


def _check_approach_notifications(db: Session, trip: Trip) -> None:
    """Notify students on this route as the bus approaches their personal pickup."""
    profiles = (
        db.query(StudentProfile)
        .filter(
            StudentProfile.route_id == trip.route_id,
            StudentProfile.pickup_route_pos_m.isnot(None),
            StudentProfile.notify_enabled.is_(True),
        )
        .all()
    )
    if not profiles:
        return

    # ETA-based notification stage for each student (cheap recompute per fix)
    from .eta import compute_eta

    for sp in profiles:
        eta = compute_eta(db, trip, sp.pickup_route_pos_m)
        if not eta.get("available") or eta.get("passed"):
            continue
        eta_min = eta["eta_sec"] / 60.0
        distance_m = eta["distance_m"]

        if eta_min <= 1 or distance_m <= 120:
            stage = 4
            title = "Bus arriving at your pickup point"
            body = "Your bus is arriving at your pickup point now."
        elif eta_min <= 3:
            stage = 3
            title = "Bus will arrive shortly"
            body = f"Your bus will reach your pickup point in about {max(1, round(eta_min))} min."
        elif eta_min <= 10:
            stage = 2
            title = "Your bus is approaching"
            body = f"Your bus is {eta['distance_m'] / 1000:.1f} km away — about {round(eta_min)} min to your pickup."
        else:
            stage = 1
            title = ""
            body = ""

        if stage == 0 or stage <= sp.last_stage:
            continue
        sp.last_stage = stage
        db.add(
            Notification(
                user_id=sp.user_id,
                type="approaching",
                title=title,
                body=body,
                route_id=trip.route_id,
                trip_id=trip.id,
            )
        )
        event_bus.publish(
            "notifications.new",
            {
                "userId": sp.user_id,
                "type": "approaching",
                "title": title,
                "body": body,
                "tripId": trip.id,
                "routeId": trip.route_id,
            },
        )
    db.commit()
