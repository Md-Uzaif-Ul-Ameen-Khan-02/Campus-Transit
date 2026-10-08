from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user, require_admin
from ..location_service import log_audit, notify_students_of_route
from ..models import Alert, Notification, Route, Trip, User, utcnow
from ..schemas import AlertIn

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("")
def list_alerts(limit: int = 50, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Alerts visible to the current user: global alerts, plus alerts on their route/trips."""
    if user.role == "admin":
        items = db.query(Alert).order_by(Alert.created_at.desc()).limit(min(limit, 200)).all()
        return [_alert_out(a) for a in items]

    relevant: list[Alert] = []
    items = db.query(Alert).order_by(Alert.created_at.desc()).limit(200).all()
    for a in items:
        if a.scope == "all":
            relevant.append(a)
        elif user.role == "student":
            from ..models import StudentProfile

            sp = db.query(StudentProfile).filter(StudentProfile.user_id == user.id).first()
            if sp and a.scope == "route" and a.route_id and a.route_id == sp.route_id:
                relevant.append(a)
    return [_alert_out(a) for a in relevant[: min(limit, 100)]]


def _alert_out(a: Alert) -> dict:
    return {
        "id": a.id,
        "title": a.title,
        "body": a.body,
        "kind": a.kind,
        "scope": a.scope,
        "routeId": a.route_id,
        "tripId": a.trip_id,
        "createdAt": a.created_at.isoformat() + "Z",
    }


@router.post("")
def publish_alert(data: AlertIn, db: Session = Depends(get_db), user: User = Depends(require_admin)):
    if data.scope == "route" and not data.route_id:
        raise ValueError("route scope requires route_id")
    a = Alert(
        title=data.title,
        body=data.body,
        kind=data.kind,
        scope=data.scope,
        route_id=data.route_id if data.scope == "route" else None,
        trip_id=data.trip_id if data.scope == "trip" else None,
        created_by=user.id,
    )
    db.add(a)

    if data.scope == "route" and data.route_id:
        notify_students_of_route(db, data.route_id, "alert", data.title, data.body)
    elif data.scope == "trip" and data.trip_id:
        trip = db.get(Trip, data.trip_id)
        if trip:
            notify_students_of_route(db, trip.route_id, "alert", data.title, data.body, trip_id=trip.id)
    else:
        # broadcast to every student with a selected route
        from ..models import StudentProfile

        for sp in db.query(StudentProfile).filter(StudentProfile.route_id.isnot(None)).all():
            db.add(
                Notification(
                    user_id=sp.user_id,
                    type="alert",
                    title=data.title,
                    body=data.body,
                )
            )
    db.commit()
    log_audit(db, user, "alert.published", f"Alert '{data.title}' ({data.scope})")
    return _alert_out(a)


@router.get("/routes-options")
def route_options(db: Session = Depends(get_db), user: User = Depends(require_admin)):
    routes = db.query(Route).filter(Route.active == True).order_by(Route.name).all()  # noqa: E712
    return [{"id": r.id, "name": r.name} for r in routes]
