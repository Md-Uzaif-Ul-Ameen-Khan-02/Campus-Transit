from __future__ import annotations

import asyncio
import time

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from .config import settings
from .db import engine, get_db
from .events import bus as event_bus
from .models import Alert, Notification, StudentProfile, User
from .routers import (admin, alerts, analytics, audit, auth, buses, drivers, notifications, routes,
                      settings as settings_router, student, trips)
from .ws import router as ws_router

app = FastAPI(title="Smart Campus Transportation & Personalized Bus ETA Platform", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple in-memory rate limiter for auth + GPS ingestion endpoints."""

    def __init__(self, app):
        super().__init__(app)
        self.buckets: dict[str, list[float]] = {}
        self.limits = {"/api/auth/login": (20, 60), "/api/auth/register": (10, 60)}

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        for prefix, (max_req, window) in self.limits.items():
            if path.startswith(prefix):
                key = f"{request.client.host if request.client else 'anon'}:{prefix}"
                now = time.time()
                bucket = [t for t in self.buckets.get(key, []) if now - t < window]
                if len(bucket) >= max_req:
                    return JSONResponse({"detail": "Too many requests — slow down."}, status_code=429)
                bucket.append(now)
                self.buckets[key] = bucket
                break
        return await call_next(request)


app.add_middleware(RateLimitMiddleware)


@app.middleware("http")
async def no_store_api(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.on_event("startup")
async def startup():
    import asyncio

    from .db import SessionLocal
    from .models import Base

    Base.metadata.create_all(engine)
    loop = asyncio.get_running_loop()
    event_bus.bind_loop(loop)
    from . import demo_simulator

    demo_simulator.simulator.start()

    asyncio.create_task(periodic_tasks())


async def periodic_tasks():
    """Every 5s: auto-start scheduled trips, compute approach notifications for stale-free demos,
    and refresh live statuses."""
    from . import demo_simulator
    from .location_service import _check_approach_notifications, log_audit
    from .models import Trip

    while True:
        try:
            await asyncio.sleep(5)
            db = SessionLocal()
            try:
                now = utcnow_now()
                today = now.strftime("%Y-%m-%d")
                now_min = now.hour * 60 + now.minute

                # Auto-start: assigned trips whose departure has come become 'ready'
                ready = (
                    db.query(Trip)
                    .filter(
                        Trip.trip_date == today,
                        Trip.status == "assigned",
                        Trip.scheduled_start <= minutes_to_hhmm(now_min + 10),
                    )
                    .all()
                )
                for t in ready:
                    if t.scheduled_start <= minutes_to_hhmm(now_min):
                        t.status = "ready"
                db.commit()
            finally:
                db.close()
        except Exception:
            pass


def utcnow_now():
    from .models import utcnow

    return utcnow()


def minutes_to_hhmm(m: int) -> str:
    return f"{(m // 60) % 24:02d}:{m % 60:02d}"


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "campus-transit", "time": utcnow_now().isoformat() + "Z"}


# ---- Routers ----
API_PREFIX = "/api"
for r in (
    auth.router, buses.router, drivers.router, routes.router, trips.router,
    student.router, admin.router, notifications.router, alerts.router,
    analytics.router, audit.router, settings_router.router,
):
    app.include_router(r, prefix=API_PREFIX)
app.include_router(ws_router, prefix=API_PREFIX)

# ---- Static frontend serving (production mode) ----
from pathlib import Path

_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if _dist.exists():
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="frontend")
