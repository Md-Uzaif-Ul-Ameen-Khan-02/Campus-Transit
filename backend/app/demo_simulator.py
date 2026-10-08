from __future__ import annotations

import math
import random
import threading
import time

from . import geo
from .config import settings
from .db import SessionLocal
from .models import DemoRun, Trip, utcnow


class Simulator:
    """Demo mode: moves virtual buses along real route geometry.

    Simulated fixes are tagged source='demo_sim' end-to-end so demo data can
    never be confused with production driver-phone GPS.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()

    def _tick_all(self, db) -> None:
        from .location_service import ingest_location

        runs = db.query(DemoRun).filter(DemoRun.running == True).all()  # noqa: E712
        for run in runs:
            trip = db.get(Trip, run.trip_id)
            if not trip or trip.status not in ("active", "delayed", "emergency"):
                run.running = False
                db.commit()
                continue
            geometry = trip.route_rel.geometry or []
            if len(geometry) < 2:
                continue
            total = geo.route_length_m(geometry)

            # Varied speed profile: base + sinusoidal traffic waves + jitter
            jitter = random.uniform(-6, 6)
            wave = 8 * math.sin(time.time() / 45 + hash(run.trip_id) % 10)
            speed_kmh = max(6.0, run.speed_kmh + jitter + wave)
            step_m = speed_kmh * 1000 / 3600 * settings.demo_tick_sec

            run.progress += step_m
            if run.progress >= total:
                run.progress = total
                run.running = False
                db.commit()
                continue
            lat, lng, heading = geo.point_along_route(geometry, run.progress)
            accuracy = random.uniform(4, 12)
            speed_ms = speed_kmh / 3.6
            ingest_location(
                db,
                trip,
                lat=lat + random.uniform(-1e-5, 1e-5),
                lng=lng + random.uniform(-1e-5, 1e-5),
                accuracy=accuracy,
                speed=speed_ms,
                heading=heading,
                source="demo_sim",
            )

    def _loop(self) -> None:
        while not self._stop.is_set():
            time.sleep(settings.demo_tick_sec)
            with self._lock:
                db = SessionLocal()
                try:
                    self._tick_all(db)
                except Exception:
                    db.rollback()
                finally:
                    db.close()

    def start(self) -> None:
        with self._lock:
            if self._thread and self._thread.is_alive():
                return
            self._stop.clear()
            self._thread = threading.Thread(target=self._loop, daemon=True, name="demo-simulator")
            self._thread.start()

    def stop_run(self, trip_id: str) -> None:
        db = SessionLocal()
        try:
            for run in db.query(DemoRun).filter(DemoRun.trip_id == trip_id).all():
                run.running = False
            db.commit()
        finally:
            db.close()


simulator = Simulator()
