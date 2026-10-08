from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_admin
from ..models import AssignmentLog, LocationPoint, OccupancyRecord, Route, SegmentStat, Trip, User, utcnow

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/overview")
def overview(days: int = 14, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    since = (utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    trips = db.query(Trip).filter(Trip.trip_date >= since).all()
    completed = [t for t in trips if t.status == "completed"]

    total_delay = sum(t.delay_min for t in trips)
    delayed = [t for t in trips if t.delay_min > 0]

    durations = []
    for t in completed:
        if t.actual_start and t.actual_end:
            durations.append((t.actual_end - t.actual_start).total_seconds() / 60)

    # trips per day
    by_day: dict[str, int] = {}
    for t in trips:
        by_day[t.trip_date] = by_day.get(t.trip_date, 0) + 1

    return {
        "windowDays": days,
        "totalTrips": len(trips),
        "completedTrips": len(completed),
        "cancelledTrips": len([t for t in trips if t.status == "cancelled"]),
        "avgDelayMin": round(total_delay / len(trips), 1) if trips else 0,
        "maxDelayMin": round(max((t.delay_min for t in trips), default=0), 1),
        "delayedTrips": len(delayed),
        "onTimePct": round(100 * (len(trips) - len(delayed)) / len(trips), 1) if trips else 100,
        "avgDurationMin": round(sum(durations) / len(durations), 1) if durations else 0,
        "tripsPerDay": sorted(by_day.items()),
        "totalGpsPoints": db.query(LocationPoint).filter(LocationPoint.created_at >= utcnow() - timedelta(days=days)).count(),
    }


@router.get("/routes")
def route_analytics(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    routes = db.query(Route).all()
    out = []
    for r in routes:
        trips = db.query(Trip).filter(Trip.route_id == r.id).all()
        completed = [t for t in trips if t.status == "completed"]
        durations = [
            (t.actual_end - t.actual_start).total_seconds() / 60
            for t in completed
            if t.actual_start and t.actual_end
        ]
        delays = [t.delay_min for t in trips]
        demand = (
            db.query(func.avg(Trip.occupancy))
            .filter(Trip.route_id == r.id, Trip.occupancy > 0)
            .scalar()
        )
        from ..models import StudentProfile

        students = db.query(StudentProfile).filter(StudentProfile.route_id == r.id).count()
        out.append(
            {
                "routeId": r.id,
                "name": r.name,
                "color": r.color,
                "trips": len(trips),
                "avgDurationMin": round(sum(durations) / len(durations), 1) if durations else 0,
                "avgDelayMin": round(sum(delays) / len(delays), 1) if delays else 0,
                "maxDelayMin": round(max(delays, default=0), 1),
                "avgOccupancy": round(float(demand), 1) if demand else 0,
                "students": students,
            }
        )
    out.sort(key=lambda x: -x["trips"])
    return out


@router.get("/delays")
def delay_analytics(days: int = 14, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    since = (utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    trips = db.query(Trip).filter(Trip.trip_date >= since, Trip.delay_min > 0).all()

    by_hour: dict[int, list[float]] = {}
    by_route: dict[str, list[float]] = {}
    for t in trips:
        hour = int(t.scheduled_start.split(":")[0])
        by_hour.setdefault(hour, []).append(t.delay_min)
        by_route.setdefault(t.route_rel.name if t.route_rel else "?", []).append(t.delay_min)

    return {
        "byHour": [
            {"hour": h, "avgDelay": round(sum(v) / len(v), 1), "count": len(v)}
            for h, v in sorted(by_hour.items())
        ],
        "byRoute": [
            {"route": name, "avgDelay": round(sum(v) / len(v), 1), "maxDelay": round(max(v), 1), "count": len(v)}
            for name, v in sorted(by_route.items(), key=lambda kv: -sum(kv[1]))
        ],
    }


@router.get("/occupancy")
def occupancy_analytics(days: int = 14, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    since = utcnow() - timedelta(days=days)
    records = db.query(OccupancyRecord).filter(OccupancyRecord.recorded_at >= since).all()

    by_hour: dict[int, list[float]] = {}
    for r in records:
        hour = r.recorded_at.hour
        if r.capacity:
            by_hour.setdefault(hour, []).append(r.count / r.capacity * 100)

    peak = sorted(
        ({"hour": h, "avgPct": round(sum(v) / len(v), 1), "samples": len(v)} for h, v in by_hour.items()),
        key=lambda x: -x["avgPct"],
    )
    return {"byHour": sorted(peak, key=lambda x: x["hour"]), "peakHours": peak[:5]}


@router.get("/eta-accuracy")
def eta_accuracy(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    """Compares ETA predictions (stored when computed) with actual arrivals — v1 sample."""
    return {
        "note": "Historical ETA accuracy tracking begins once trips complete with pickup ETAs recorded.",
        "sampleSize": 0,
    }


@router.get("/assignment-history")
def assignment_history(limit: int = 100, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    logs = db.query(AssignmentLog).order_by(AssignmentLog.created_at.desc()).limit(min(limit, 300)).all()
    trip_map = {}
    for l in logs:
        trip_map.setdefault(l.trip_id, db.get(Trip, l.trip_id))

    def bus_reg(bid):
        from ..models import Bus

        b = db.get(Bus, bid) if bid else None
        return b.registration_number if b else None

    def drv_name(did):
        from ..models import Driver

        d = db.get(Driver, did) if did else None
        return d.user.full_name if d and d.user else None

    return [
        {
            "id": l.id,
            "tripId": l.trip_id,
            "change": l.change,
            "oldBus": bus_reg(l.old_bus_id),
            "newBus": bus_reg(l.new_bus_id),
            "oldDriver": drv_name(l.old_driver_id),
            "newDriver": drv_name(l.new_driver_id),
            "note": l.note,
            "actor": l.actor,
            "createdAt": l.created_at.isoformat() + "Z",
        }
        for l in logs
    ]
