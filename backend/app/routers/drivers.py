from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_admin
from ..location_service import log_audit
from ..models import Driver, Trip, User
from ..schemas import DriverIn, DriverOut
from ..security import hash_password

router = APIRouter(prefix="/drivers", tags=["drivers"])


def _drv_out(d: Driver) -> DriverOut:
    return DriverOut(
        id=d.id,
        full_name=d.user.full_name if d.user else "",
        phone=d.user.phone if d.user else "",
        email=d.user.email if d.user else "",
        employee_code=d.employee_code,
        license_no=d.license_no,
        status=d.status,
        active=d.active,
    )


@router.get("", response_model=list[DriverOut])
def list_drivers(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    return [_drv_out(d) for d in db.query(Driver).order_by(Driver.id).all()]


@router.post("", response_model=DriverOut)
def create_driver(data: DriverIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    email = data.email.lower()
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(409, "A user with this email already exists")
    password = data.password or "driver@123"
    usr = User(
        id="",
        email=email,
        phone=data.phone,
        full_name=data.full_name,
        role="driver",
        password_hash=hash_password(password),
    )
    while db.get(User, usr.id):
        import uuid

        usr.id = f"usr_{uuid.uuid4().hex[:10]}"
    db.add(usr)
    db.flush()
    drv = Driver(
        user_id=usr.id,
        employee_code=data.employee_code,
        license_no=data.license_no,
        active=data.active,
        status="available" if data.active else "offline",
    )
    db.add(drv)
    db.commit()
    db.refresh(drv)
    log_audit(db, user, "driver.created", f"Driver {data.full_name} created ({email})")
    return _drv_out(drv)


@router.patch("/{driver_id}", response_model=DriverOut)
def update_driver(driver_id: str, data: DriverIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    drv = db.get(Driver, driver_id)
    if not drv:
        raise HTTPException(404, "Driver not found")
    usr = db.get(User, drv.user_id)
    usr.full_name = data.full_name
    usr.phone = data.phone
    if data.email.lower() != usr.email:
        if db.query(User).filter(User.email == data.email.lower()).first():
            raise HTTPException(409, "Another user already uses this email")
        usr.email = data.email.lower()
    if data.password:
        from ..security import hash_password as hp

        usr.password_hash = hp(data.password)
    drv.employee_code = data.employee_code
    drv.license_no = data.license_no
    if not data.active:
        on_trip = (
            db.query(Trip)
            .filter(Trip.driver_id == driver_id, Trip.status.in_(["active", "delayed", "emergency"]))
            .first()
        )
        if on_trip:
            raise HTTPException(409, "Driver is on an active trip — replace them first")
        drv.active = False
        drv.status = "unavailable"
    else:
        drv.active = True
        if drv.status in ("unavailable", "offline"):
            drv.status = "available"
    db.commit()
    db.refresh(drv)
    log_audit(db, user, "driver.updated", f"Driver {data.full_name} updated")
    return _drv_out(drv)


@router.post("/{driver_id}/status")
def set_driver_status(driver_id: str, payload: dict, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    drv = db.get(Driver, driver_id)
    if not drv:
        raise HTTPException(404, "Driver not found")
    status = payload.get("status")
    if status not in {"available", "unavailable", "offline"}:
        raise HTTPException(400, "Invalid status (use trip APIs for on-trip states)")
    if status == "available" and not drv.active:
        raise HTTPException(409, "Driver is deactivated — activate first")
    drv.status = status
    db.commit()
    log_audit(db, user, "driver.status", f"Driver {drv.user.full_name} status → {status}")
    return {"ok": True, "status": drv.status}


@router.get("/{driver_id}/history")
def driver_history(driver_id: str, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    drv = db.get(Driver, driver_id)
    if not drv:
        raise HTTPException(404, "Driver not found")
    trips = (
        db.query(Trip)
        .filter(Trip.driver_id == driver_id)
        .order_by(Trip.trip_date.desc(), Trip.scheduled_start.desc())
        .limit(100)
        .all()
    )
    return [
        {
            "tripId": t.id,
            "date": t.trip_date,
            "route": t.route_rel.name,
            "bus": t.bus_rel.registration_number if t.bus_rel else "",
            "scheduled": t.scheduled_start,
            "status": t.status,
            "occupancy": t.occupancy,
        }
        for t in trips
    ]
