from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import active_trip_for_bus, require_admin
from ..location_service import log_audit
from ..models import Bus, Trip, User
from ..schemas import BusIn, BusOut

router = APIRouter(prefix="/buses", tags=["buses"])


@router.get("", response_model=list[BusOut])
def list_buses(
    status: str | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    q = db.query(Bus)
    if status:
        q = q.filter(Bus.status == status)
    return q.order_by(Bus.registration_number).all()


@router.post("", response_model=BusOut)
def create_bus(data: BusIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    if db.query(Bus).filter(Bus.registration_number == data.registration_number).first():
        raise HTTPException(409, "A bus with this registration number already exists")
    bus = Bus(
        registration_number=data.registration_number,
        display_name=data.display_name,
        capacity=data.capacity,
        vehicle_type=data.vehicle_type,
        status=data.status if data.active else "inactive",
        active=data.active,
        is_ev=data.is_ev,
        accessible=data.accessible,
        notes=data.notes,
    )
    db.add(bus)
    db.commit()
    db.refresh(bus)
    log_audit(db, user, "bus.created", f"Bus {bus.registration_number} created (capacity {bus.capacity})")
    return bus


@router.patch("/{bus_id}", response_model=BusOut)
def update_bus(bus_id: str, data: BusIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    bus = db.get(Bus, bus_id)
    if not bus:
        raise HTTPException(404, "Bus not found")
    bus.registration_number = data.registration_number
    bus.display_name = data.display_name
    bus.capacity = data.capacity
    bus.vehicle_type = data.vehicle_type
    bus.notes = data.notes
    bus.is_ev = data.is_ev
    bus.accessible = data.accessible
    if not data.active:
        if active_trip_for_bus(db, bus_id):
            raise HTTPException(409, "Bus is on an active trip — replace it first")
        bus.active = False
        bus.status = "inactive"
    elif not bus.active:
        bus.active = True
        bus.status = data.status if data.status != "inactive" else "available"
    else:
        bus.status = data.status
    db.commit()
    db.refresh(bus)
    log_audit(db, user, "bus.updated", f"Bus {bus.registration_number} updated")
    return bus


@router.post("/{bus_id}/status")
def set_status(bus_id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    bus = db.get(Bus, bus_id)
    if not bus:
        raise HTTPException(404, "Bus not found")
    status = payload.get("status")
    allowed = {"available", "maintenance", "unavailable", "inactive"}
    if status not in allowed:
        raise HTTPException(400, "Invalid status")
    if status == "inactive":
        if active_trip_for_bus(db, bus_id):
            raise HTTPException(409, "Bus is on an active trip — replace it first")
        bus.active = False
    else:
        bus.active = True
    bus.status = status
    db.commit()
    log_audit(db, user, "bus.status", f"Bus {bus.registration_number} status → {status}")
    return {"ok": True, "status": bus.status}


@router.get("/{bus_id}/history")
def bus_history(bus_id: str, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    bus = db.get(Bus, bus_id)
    if not bus:
        raise HTTPException(404, "Bus not found")
    trips = (
        db.query(Trip)
        .filter(Trip.bus_id == bus_id)
        .order_by(Trip.trip_date.desc(), Trip.scheduled_start.desc())
        .limit(100)
        .all()
    )
    return [
        {
            "tripId": t.id,
            "date": t.trip_date,
            "route": t.route_rel.name,
            "driver": t.driver_rel.user.full_name if t.driver_rel and t.driver_rel.user else "",
            "scheduled": t.scheduled_start,
            "actualStart": t.actual_start.isoformat() + "Z" if t.actual_start else None,
            "actualEnd": t.actual_end.isoformat() + "Z" if t.actual_end else None,
            "status": t.status,
            "occupancy": t.occupancy,
        }
        for t in trips
    ]
