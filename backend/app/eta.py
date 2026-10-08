from __future__ import annotations

from sqlalchemy.orm import Session

from . import geo
from .config import settings
from .models import LocationPoint, SegmentStat, Trip, utcnow


def compute_eta(db: Session, trip: Trip, pickup_pos_m: float) -> dict:
    """Estimate arrival at the student's pickup point for a live trip.

    Blends current/recent bus speed with historical per-hour speeds for this route
    (segment-based model v2). Falls back to configured default speed when no data.
    Returns dict with eta seconds range, remaining distance, method and staleness.
    """
    route = trip.route_rel
    geometry = route.geometry or []
    if not geometry or len(geometry) < 2:
        return {"available": False, "reason": "Route geometry not configured"}

    # Direction matters: bus travels 0 -> total. If the pickup is behind the bus
    # (already passed), no arrival is expected this trip.
    remaining = pickup_pos_m - trip.route_pos_m
    if remaining < -150:  # small grace for GPS noise
        return {
            "available": False,
            "passed": True,
            "reason": "Bus has passed this pickup point for this trip",
            "distance_m": abs(remaining),
        }

    distance_m = max(remaining, 0.0)
    now_hour = utcnow().hour

    # --- speed selection: recent observed avg, else historical per-hour, else default ---
    speed_kmh = 0.0
    method = "default"
    if trip.current_speed and trip.current_speed > 0.5:  # m/s observed right now
        speed_kmh = trip.current_speed * 3.6
        method = "live_speed"

    recent_cut = utcnow()
    pts = (
        db.query(LocationPoint)
        .filter(LocationPoint.trip_id == trip.id)
        .order_by(LocationPoint.id.desc())
        .limit(6)
        .all()
    )
    if len(pts) >= 2:
        # average speed over the last few fixes with valid speeds
        speeds = [p.speed for p in pts if p.speed and p.speed > 0.5]
        if speeds:
            recent_kmh = (sum(speeds) / len(speeds)) * 3.6
            # blend live + recent for stability
            speed_kmh = (speed_kmh + recent_kmh) / 2 if speed_kmh > 0 else recent_kmh
            method = "recent_speed"

    hist = (
        db.query(SegmentStat)
        .filter(SegmentStat.route_id == trip.route_id, SegmentStat.hour == now_hour)
        .first()
    )
    if hist and hist.samples >= 2:
        if speed_kmh > 0:
            # weight historical conditions into the live estimate
            speed_kmh = 0.6 * speed_kmh + 0.4 * hist.avg_speed_kmh
            method = "blended_historical"
        else:
            speed_kmh = hist.avg_speed_kmh
            method = "historical"

    if speed_kmh <= 0:
        speed_kmh = settings.eta_default_speed_kmh
    speed_kmh = max(speed_kmh, settings.eta_min_speed_kmh)
    speed_kmh = min(speed_kmh, settings.location_max_speed_kmh)

    eta_sec = (distance_m / 1000.0) / speed_kmh * 3600.0
    eta_sec = max(eta_sec, 15)  # never claim "already there"
    stale = trip_stale(trip)

    return {
        "available": True,
        "eta_sec": round(eta_sec),
        "eta_low_sec": round(eta_sec * settings.eta_low_factor),
        "eta_high_sec": round(eta_sec * settings.eta_high_factor),
        "distance_m": round(distance_m),
        "speed_kmh": round(speed_kmh, 1),
        "method": method,
        "stale": stale,
        "passed": False,
    }


def trip_stale(trip: Trip) -> bool:
    if not trip.last_fix_at:
        return True
    return (utcnow() - trip.last_fix_at).total_seconds() > settings.location_stale_after_sec
