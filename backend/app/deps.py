from __future__ import annotations

from fastapi import Depends, HTTPException, WebSocket, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from .db import get_db
from .models import Bus, Driver, StudentProfile, Trip, User, utcnow
from .security import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def get_current_user(token: str | None = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user = db.get(User, payload.get("sub", ""))
    if not user or user.disabled:
        raise HTTPException(status_code=401, detail="User not found or disabled")
    return user


def require_roles(*roles: str):
    def checker(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user
    return checker


require_admin = require_roles("admin")
require_driver = require_roles("driver")
require_student = require_roles("student")
require_any = require_roles("student", "driver", "admin")


def get_current_driver(user: User = Depends(require_driver), db: Session = Depends(get_db)) -> Driver:
    drv = db.query(Driver).filter(Driver.user_id == user.id).first()
    if not drv:
        raise HTTPException(status_code=404, detail="Driver profile not found")
    return drv


def get_current_student_profile(user: User = Depends(require_student), db: Session = Depends(get_db)) -> StudentProfile:
    prof = db.query(StudentProfile).filter(StudentProfile.user_id == user.id).first()
    if not prof:
        prof = StudentProfile(user_id=user.id)
        db.add(prof)
        db.commit()
        db.refresh(prof)
    return prof


def get_ws_user(ws: WebSocket, db: Session) -> User | None:
    token = ws.query_params.get("token")
    if not token:
        return None
    payload = decode_token(token)
    if not payload:
        return None
    return db.get(User, payload.get("sub", ""))


def active_trip_for_bus(db: Session, bus_id: str) -> Trip | None:
    return (
        db.query(Trip)
        .filter(Trip.bus_id == bus_id, Trip.status.in_(["active", "delayed", "emergency"]))
        .first()
    )


def trip_is_live(trip: Trip, stale_after_sec: int) -> bool:
    if trip.status not in ("active", "delayed", "emergency"):
        return False
    if not trip.last_fix_at:
        return False
    return (utcnow() - trip.last_fix_at).total_seconds() <= stale_after_sec
