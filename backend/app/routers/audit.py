from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import require_admin
from ..models import AuditLog, User

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("")
def list_audit(
    limit: int = 100,
    action: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_admin),
):
    q = db.query(AuditLog)
    if action:
        q = q.filter(AuditLog.action == action)
    logs = q.order_by(AuditLog.created_at.desc()).limit(min(limit, 500)).all()
    return [
        {
            "id": a.id,
            "actor": a.actor_name,
            "action": a.action,
            "detail": a.detail,
            "createdAt": a.created_at.isoformat() + "Z",
        }
        for a in logs
    ]
