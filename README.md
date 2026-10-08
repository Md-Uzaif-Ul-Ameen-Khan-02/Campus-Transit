# 🚌 Smart Campus Transportation & Personalized Bus ETA Platform

A production-quality, full-stack campus transit platform where the **driver's smartphone is the GPS tracker** (no hardware needed), students get **personalized ETAs to their own pickup point** (not just "bus reaches campus"), and admins manage **fully dynamic bus/driver/route assignments** with live operations monitoring.

Built to run the complete demo scenario end-to-end: create a route → create a bus + driver → create a trip → student picks a pickup point → driver starts the trip → phone GPS streams live → students watch the bus approach *their* stop with a personal ETA → admin replaces the bus mid-trip → everyone is notified automatically.

---

## Core design principles (never violated)

1. **A bus does NOT permanently belong to a route.** The hierarchy is `Route → Trip → Bus + Driver`; assignments can change every day, between trips, and mid-trip.
2. **Pickup points are not fixed bus stops.** Students choose any point; it is snapped to the nearest position on the route polyline (with a configurable tolerance and validation).
3. **ETA is route-position based**, not straight-line: `remaining distance along route ÷ blended speed` with live + recent + historical speeds, shown as a range (e.g. "5–8 min").
4. **Multiple students on one route get different ETAs.** Each student's pickup has its own route position.
5. **GPS comes from the driver's phone** and only while a trip is active — tracking stops automatically at trip end. The ingestion layer is hardware-agnostic (`driver_phone | iot_device | demo_sim`).
6. **Demo/simulated GPS is clearly separated** — tagged `demo_sim` everywhere, badged in the UI, and blocked from trips that received real driver GPS.
7. **History is preserved**: GPS points, occupancy records, assignment changes and audit logs are append-only.

## Tech stack

| Layer     | Tech                                                        |
|-----------|-------------------------------------------------------------|
| Backend   | Python + FastAPI, SQLAlchemy 2, Pydantic v2, JWT auth       |
| Database  | SQLite by default (`DATABASE_URL` env → PostgreSQL in prod) |
| Real-time | Authenticated WebSockets + in-process pub/sub event bus     |
| Frontend  | React 19 + TypeScript + Vite, Tailwind CSS                  |
| Maps      | Leaflet + OpenStreetMap                                     |
| Charts    | Recharts                                                    |

## Deploy

```bash
cp .env.example .env    # set SECRET_KEY, POSTGRES_PASSWORD, CORS_ORIGINS
docker compose up -d --build
# → http://<server>:8000/  (API + built UI + Postgres, data persisted in a volume)
```

Full guide — Compose, Railway/Render/Fly, and bare-metal systemd + Nginx + HTTPS — in [DEPLOY.md](DEPLOY.md).

## Run it (local dev)

```bash
# 1. Backend
cd backend
python -m pip install -r requirements.txt
python seed_data.py                 # seeds routes, buses, drivers, students, history
python -m uvicorn app.main:app --port 8000

# 2. Frontend (dev)
cd frontend
npm install
npm run dev                         # http://localhost:5173 (proxies /api → :8000)

# Production mode: npm run build → backend automatically serves frontend/dist at :8000
```

### Demo accounts (after seeding)

| Role    | Email              | Password     |
|---------|--------------------|--------------|
| Admin   | admin@campus.edu   | admin@123    |
| Driver  | raj@campus.edu     | driver@123   |
| Driver  | arun@campus.edu    | driver@123   |
| Student | aarav@campus.edu   | student@123  |
| Student | diya@campus.edu    | student@123  |

Seeded data: 5 Bengaluru-area routes (KR Puram, Whitefield, Hebbal, Banashankari, Yelahanka) with 12–16 km road-like geometry, 8 buses, 6 drivers, 8 students with pickups along routes, **70 historical trips with ~10k GPS points** (feeds the segment/historical ETA model), occupancy records, delays and segment statistics.

### One-minute demo walkthrough

1. **Admin** → *Trips* → create a trip for a route with any bus + driver (conflicts rejected automatically).
2. **Student** (aarav) → *My Route* → pick a route → drop a pin on the map → it snaps to the route → saved.
3. **Driver** (raj) → press **START TRIP** → grant location permission → GPS streams (4 s cadence).
4. **Student** → home shows the live bus, distance along route, **personal ETA range**, occupancy; map updates in real time. Approach notifications fire at 10/3/1-minute thresholds.
5. **Admin** → *Live Ops* → click the trip → **Replace bus** (or driver) → students get an in-app notification and tracking continues seamlessly.
6. **Admin** → *Live Ops* → **Start demo simulation** for any active trip that has no real GPS — a virtual bus drives the route (badged `DEMO SIMULATION`).
7. **Driver** → report delay / trigger emergency → students notified, admin sees prominent emergency banner → admin can resolve.

### Tests

```bash
cd backend
python smoke_test.py    # 48 end-to-end checks against a freshly seeded, running server
```

Covers: RBAC, conflict validation, pickup snapping + rejection, GPS validation (accuracy / speed / jumps), occupancy → student view, personalized ETA, simulation separation rules, delay → notification, live bus replacement, emergency trigger/resolve, analytics, audit, alerts, trip lifecycle.

## Architecture

```
Driver phone (GPS)  ─┐
IoT device (future) ─┼─→  /trips/{id}/location  →  validation  →  route projection  →  Trip state
Demo simulator      ─┘                                    │                        (route_pos_m, progress)
                                                          ↓
                                             WebSocket fan-out (event bus)
                                    ┌──────────────────────┼──────────────────────┐
                                    ↓                      ↓                      ↓
                              Student map            Admin live map        Approach notifs
                              + personalized ETA     + replacement/emrg    (per-student stages)

ETA engine:  live speed ⊕ recent fixes ⊕ historical per-hour segment stats  →  min–max range
```

Key modules: `app/geo.py` (polyline projection), `app/eta.py` (ETA v1+v2), `app/location_service.py` (ingestion, validation, notifications), `app/demo_simulator.py` (background sim), `app/events.py` (pub/sub), `app/ws.py` (authenticated sockets).

## Security & privacy

- Role-based access control on every route (student/driver/admin), JWT bearer auth, secure WS handshake (`?token=`).
- Drivers can only touch their own assigned trips; students cannot mutate operations data.
- GPS accepted only for active trips, only from the assigned driver, with accuracy/speed/jump validation.
- Rate limiting on auth endpoints; audit log of all admin actions.
- Location history retained for analytics; driver location is never exposed outside active trips.

## Configuration

Runtime-tunable in **Admin → Settings** (persisted, no restart): GPS interval, stale window, accuracy/speed/jump limits, ETA speeds, occupancy bands, pickup snap tolerance, demo tick.

Environment: `DATABASE_URL` (e.g. `postgresql://user:pass@host/db`), `SECRET_KEY`, `CORS_ORIGINS`.
