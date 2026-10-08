from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..config import settings as cfg
from ..db import get_db
from ..deps import require_admin, require_any
from ..location_service import get_setting, log_audit, set_setting
from ..models import User
from ..schemas import SettingsIn, SettingsOut

router = APIRouter(prefix="/settings", tags=["settings"])

SETTABLE = {
    "location_interval_sec": 4,
    "location_stale_after_sec": 25,
    "location_max_accuracy_m": 150,
    "location_max_speed_kmh": 130.0,
    "location_max_jump_m": 3000,
    "eta_default_speed_kmh": 22.0,
    "eta_min_speed_kmh": 7.0,
    "occupancy_low_max_pct": 40,
    "occupancy_high_min_pct": 76,
    "pickup_max_snap_distance_m": 800,
    "demo_tick_sec": 2.0,
}


@router.get("", response_model=SettingsOut)
def get_all(db: Session = Depends(get_db), user: User = Depends(require_any)):
    data = {}
    for key, default in SETTABLE.items():
        data[key] = get_setting(db, key, default)
    return SettingsOut(**data)


@router.put("")
def update_all(data: SettingsIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    changed = {}
    for field, value in data.model_dump(exclude_none=True).items():
        if field in SETTABLE:
            set_setting(db, field, value)
            changed[field] = value
    log_audit(db, user, "settings.updated", ", ".join(f"{k}={v}" for k, v in changed.items()))
    return {"ok": True, "changed": changed}
