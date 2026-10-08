"""Seed the database with realistic demo data: users, buses, drivers, routes,
trips (today + history), GPS trails, occupancy records, delays and segment stats."""
from __future__ import annotations

import math
import random
import sys
from datetime import datetime, timedelta, timezone

from app import geo
from app.db import SessionLocal, engine
from app.models import (
    Alert,
    AssignmentLog,
    AuditLog,
    Bus,
    Driver,
    LocationPoint,
    OccupancyRecord,
    Route,
    SegmentStat,
    StudentProfile,
    Trip,
    User,
    utcnow,
)
from app.security import hash_password

random.seed(42)

BENGALURU_CENTER = (12.9612, 77.6256)  # near CMRIT campus area


def _offset(center, dlat_m: float, dlng_m: float):
    return [center[0] + dlat_m / 110540.0, center[1] + dlng_m / (111320.0 * math.cos(math.radians(center[0])))]


def make_route_geometry(start, bearing_deg: float, length_km: float, wiggle: float = 90.0, step_m: float = 250.0):
    """Build a road-like polyline from start heading `bearing_deg`, with gentle curves."""
    pts = []
    pos = list(start)
    brg = bearing_deg
    steps = int(length_km * 1000 / step_m)
    for i in range(steps):
        pts.append(list(pos))
        brg += random.uniform(-wiggle / 4, wiggle / 4)
        brg = (brg + 360) % 360
        rad = math.radians(brg)
        pos[0] += (step_m * math.cos(rad)) / 110540.0
        pos[1] += (step_m * math.sin(rad)) / (111320.0 * math.cos(math.radians(pos[0])))
    pts.append(list(pos))
    return pts


def landmarks_along(geometry, names):
    out = []
    n = len(names)
    for i, name in enumerate(names):
        idx = int(len(geometry) * (i + 0.5) / n)
        idx = min(idx, len(geometry) - 1)
        out.append({"name": name, "lat": geometry[idx][0], "lng": geometry[idx][1]})
    return out


ROUTES = [
    {
        "name": "KR Puram", "code": "R1", "color": "#2563eb", "duration": 50,
        "start": (13.0090, 77.6760), "bearing": 215, "km": 12.0,
        "landmarks": ["Tin Factory", "KR Puram Bus Stand", "Hoodi Circle", "Mahadevapura", "CMRIT Campus"],
    },
    {
        "name": "Whitefield", "code": "R2", "color": "#16a34a", "duration": 55,
        "start": (12.9698, 77.7500), "bearing": 250, "km": 13.5,
        "landmarks": ["Whitefield Hope Farm", "Prestige Shantiniketan", "Kundalahalli", "Marathahalli Bridge", "CMRIT Campus"],
    },
    {
        "name": "Hebbal", "code": "R3", "color": "#d97706", "duration": 60,
        "start": (13.0358, 77.5970), "bearing": 160, "km": 14.0,
        "landmarks": ["Hebbal Flyover", "Mekhri Circle", "Cantonment", "Ulsoor Lake", "CMRIT Campus"],
    },
    {
        "name": "Banashankari", "code": "R4", "color": "#dc2626", "duration": 65,
        "start": (12.9250, 77.5460), "bearing": 55, "km": 16.0,
        "landmarks": ["Banashankari TTMC", "Jayanagar 4th Block", "South End Circle", "Mission Road", "CMRIT Campus"],
    },
    {
        "name": "Yelahanka", "code": "R5", "color": "#7c3aed", "duration": 55,
        "start": (13.1007, 77.5963), "bearing": 150, "km": 13.0,
        "landmarks": ["Yelahanka Gate", "Jakkur Aerodrome", "Thanisandra", "Nagawara", "CMRIT Campus"],
    },
]

BUSES = [
    {"reg": "KA-01-1234", "name": "Bus 102", "cap": 45, "type": "standard"},
    {"reg": "KA-01-5678", "name": "Bus 108", "cap": 45, "type": "standard"},
    {"reg": "KA-05-9012", "name": "Bus 115", "cap": 52, "type": "standard"},
    {"reg": "KA-03-3456", "name": "Bus 121", "cap": 32, "type": "mini"},
    {"reg": "KA-01-7890", "name": "Bus 134", "cap": 45, "type": "standard", "ev": True},
    {"reg": "KA-41-2468", "name": "Bus 142", "cap": 52, "type": "standard"},
    {"reg": "KA-02-1357", "name": "Bus 155", "cap": 28, "type": "mini", "accessible": True},
    {"reg": "KA-01-8642", "name": "Bus 160", "cap": 45, "type": "standard"},
]

DRIVERS = [
    ("Rajesh Kumar", "raj@campus.edu", "EMP-101", "KA0520110001234"),
    ("Arun Prasad", "arun@campus.edu", "EMP-102", "KA0320120005678"),
    ("Suresh Babu", "suresh@campus.edu", "EMP-103", "KA0520130009012"),
    ("Manjunath S", "manju@campus.edu", "EMP-104", "KA0320140003456"),
    ("Prakash Rao", "prakash@campus.edu", "EMP-105", "KA0120150007890"),
    ("Girish Naik", "girish@campus.edu", "EMP-106", "KA4120150024680"),
]

STUDENTS = [
    ("Aarav Sharma", "aarav@campus.edu"),
    ("Diya Patel", "diya@campus.edu"),
    ("Rohan Gupta", "rohan@campus.edu"),
    ("Ishita Rao", "ishita@campus.edu"),
    ("Kabir Singh", "kabir@campus.edu"),
    ("Ananya Iyer", "ananya@campus.edu"),
    ("Vivaan Reddy", "vivaan@campus.edu"),
    ("Meera Nair", "meera@campus.edu"),
]


def _seed_if_empty() -> int:
    """Deployment mode: only seed a completely fresh database; never touch existing data."""
    import app.models as m

    db = SessionLocal()
    try:
        m.Base.metadata.create_all(engine)
        has_data = db.query(m.User).first() is not None
    finally:
        db.close()
    if has_data:
        print("[seed] Database already has data — skipping demo seed (--if-empty).")
        return 0
    main()
    return 0


def main():
    import app.models as m

    # id defaults are lambdas on the mapped class; create with explicit ids to keep predictable seeds
    m.uid = m.uid  # no-op

    db = SessionLocal()
    print("Dropping and creating tables...")
    m.Base.metadata.drop_all(engine)
    m.Base.metadata.create_all(engine)

    # ---------- admin ----------
    admin = User(id="usr_admin1", email="admin@campus.edu", full_name="Transport Admin",
                 role="admin", password_hash=hash_password("admin@123"))
    db.add(admin)

    # ---------- routes ----------
    routes = {}
    for spec in ROUTES:
        g = make_route_geometry(spec["start"], spec["bearing"], spec["km"])
        r = Route(id=f"rt_{spec['code'].lower()}", name=spec["name"], code=spec["code"],
                  description=f"Campus route serving {spec['name']} corridor", direction="outbound",
                  color=spec["color"], active=True, geometry=g,
                  landmarks=landmarks_along(g, spec["landmarks"]),
                  standard_duration_min=spec["duration"])
        db.add(r)
        routes[spec["name"]] = r
    db.flush()

    # ---------- buses & drivers ----------
    buses = []
    for i, b in enumerate(BUSES):
        bus = Bus(id=f"bus_{i+1}", registration_number=b["reg"], display_name=b["name"],
                  capacity=b["cap"], vehicle_type=b["type"], status="available",
                  is_ev=b.get("ev", False), accessible=b.get("accessible", False))
        db.add(bus)
        buses.append(bus)

    drivers = []
    for i, (name, email, emp, lic) in enumerate(DRIVERS):
        u = User(id=f"usr_drv{i+1}", email=email, full_name=name, phone=f"98765432{i:02d}",
                 role="driver", password_hash=hash_password("driver@123"))
        d = Driver(id=f"drv_{i+1}", user_id=u.id, employee_code=emp, license_no=lic,
                   status="available", active=True)
        db.add(u)
        db.add(d)
        drivers.append(d)

    # ---------- students with pickups spread along routes ----------
    today = utcnow().strftime("%Y-%m-%d")
    students = []
    route_names = list(routes.keys())
    for i, (name, email) in enumerate(STUDENTS):
        u = User(id=f"usr_stu{i+1}", email=email, full_name=name, phone=f"99000000{i:02d}",
                 role="student", password_hash=hash_password("student@123"))
        db.add(u)
        db.flush()
        rname = route_names[i % len(route_names)]
        route = routes[rname]
        g = route.geometry
        total = geo.route_length_m(g)
        pos = total * (0.18 + 0.09 * i) % (total * 0.92)
        lat, lng, _ = geo.point_along_route(g, pos)
        sp = StudentProfile(user_id=u.id, route_id=route.id,
                            pickup_lat=lat + random.uniform(-0.0004, 0.0004),
                            pickup_lng=lng + random.uniform(-0.0004, 0.0004),
                            pickup_label=f"{name.split()[0]}'s pickup",
                            pickup_route_pos_m=pos, pickup_verified=True)
        db.add(sp)
        students.append(u)

    db.flush()

    # ---------- historical trips (past 10 days, excluding weekends) ----------
    print("Seeding historical trips, GPS trails, occupancy...")
    hist_count = 0
    for d in range(10, 0, -1):
        day = utcnow() - timedelta(days=d)
        if day.weekday() >= 5:
            continue
        date_str = day.strftime("%Y-%m-%d")
        for ri, rname in enumerate(route_names):
            route = routes[rname]
            g = route.geometry
            total_len = geo.route_length_m(g)
            # two trips per route per day: morning + evening
            for slot, (hh, mm) in enumerate([(7, 30 + ri * 5), (16, 30 + ri * 5)]):
                bus = buses[(ri + d + slot) % len(buses)]
                drv = drivers[(ri + d + slot) % len(drivers)]
                start_dt = day.replace(hour=hh, minute=mm, second=random.randint(0, 59), microsecond=0)
                dur_min = route.standard_duration_min + random.uniform(-8, 18)
                end_dt = start_dt + timedelta(minutes=dur_min)
                trip = Trip(id=f"trip_h{d}_{ri}_{slot}", route_id=route.id, bus_id=bus.id,
                            driver_id=drv.id, trip_date=date_str,
                            scheduled_start=f"{hh:02d}:{mm:02d}",
                            scheduled_end=f"{(hh*60+mm+int(route.standard_duration_min))//60%24:02d}:{(hh*60+mm+int(route.standard_duration_min))%60:02d}",
                            actual_start=start_dt, actual_end=end_dt, status="completed",
                            occupancy=random.randint(18, bus.capacity))
                delay = max(0.0, random.gauss(4, 6))
                trip.delay_min = round(min(delay, 25), 1)
                db.add(trip)

                # GPS trail: ~ every 20s compressed to every ~120m
                pace = total_len / max(dur_min * 60, 1)
                n_points = int(total_len / 120)
                base_hour = hh
                for pi in range(n_points):
                    pos = pi * 120
                    lat, lng, hdg = geo.point_along_route(g, pos)
                    spd = pace * random.uniform(0.7, 1.3)
                    db.add(LocationPoint(trip_id=trip.id, lat=lat, lng=lng, speed=spd,
                                         heading=hdg, accuracy=random.uniform(4, 12),
                                         route_pos_m=pos, source="driver_phone",
                                         created_at=start_dt + timedelta(seconds=pos / pace)))
                hist_count += 1

                # occupancy records sampled during trip
                for sample in range(3):
                    occ = max(0, int(trip.occupancy + random.uniform(-6, 6)))
                    db.add(OccupancyRecord(trip_id=trip.id, count=min(occ, bus.capacity),
                                           capacity=bus.capacity,
                                           level="low" if occ < 0.4 * bus.capacity else ("high" if occ > 0.75 * bus.capacity else "medium"),
                                           recorded_at=start_dt + timedelta(minutes=5 + sample * 10)))

                db.add(AssignmentLog(trip_id=trip.id, change="created", new_bus_id=bus.id,
                                     new_driver_id=drv.id, actor="Transport Admin",
                                     note=f"Seeded trip {date_str} {hh:02d}:{mm:02d}"))

    # ---------- segment stats from history ----------
    print("Computing segment statistics...")
    for rname, route in routes.items():
        g = route.geometry
        total_len = geo.route_length_m(g)
        trips = db.query(Trip).filter(Trip.route_id == route.id, Trip.status == "completed").all()
        for hour in [7, 8, 16, 17, 18]:
            h_trips = [t for t in trips if t.scheduled_start.startswith(f"{hour:02d}:")]
            if not h_trips:
                continue
            speeds = []
            for t in h_trips:
                if t.actual_start and t.actual_end:
                    secs = (t.actual_end - t.actual_start).total_seconds()
                    if secs > 300:
                        speeds.append(total_len / secs * 3.6)
            if speeds:
                db.add(SegmentStat(route_id=route.id, direction=route.direction, hour=hour,
                                   avg_speed_kmh=round(sum(speeds) / len(speeds), 2), samples=len(speeds)))

    # ---------- today's ops ----------
    print("Seeding today's schedule...")
    assignments = [
        ("KR Puram", "07:30", 0, 0), ("Whitefield", "07:35", 1, 1), ("Hebbal", "07:40", 2, 2),
        ("Banashankari", "07:45", 3, 3), ("Yelahanka", "07:50", 4, 4),
        ("KR Puram", "16:30", 2, 1), ("Whitefield", "16:35", 3, 2), ("Hebbal", "16:40", 4, 3),
        ("Banashankari", "16:45", 5, 4), ("Yelahanka", "16:50", 6, 5),
    ]
    today_trips = []
    for i, (rname, start, bi, di) in enumerate(assignments):
        route = routes[rname]
        bus, drv = buses[bi], drivers[di]
        end_min = int(start.split(":")[0]) * 60 + int(start.split(":")[1]) + int(route.standard_duration_min)
        trip = Trip(id=f"trip_t{i}", route_id=route.id, bus_id=bus.id, driver_id=drv.id,
                    trip_date=today, scheduled_start=start,
                    scheduled_end=f"{end_min//60%24:02d}:{end_min%60:02d}",
                    status="assigned")
        db.add(trip)
        db.add(AssignmentLog(trip_id=trip.id, change="created", new_bus_id=bus.id, new_driver_id=drv.id,
                             actor="Transport Admin", note=f"Daily assignment {start}"))
        today_trips.append(trip)
    db.flush()

    # a couple of later trips still 'scheduled' without assignments
    for j, rname in enumerate(["KR Puram", "Hebbal"]):
        route = routes[rname]
        trip = Trip(id=f"trip_tu{j}", route_id=route.id, trip_date=today,
                    scheduled_start=f"{18+j}:30", scheduled_end=f"{19+j}:20", status="scheduled")
        db.add(trip)

    # ---------- sample alerts & audit ----------
    db.add(Alert(title="Welcome to Campus Transit", body="Live bus tracking is now available for all routes.",
                 kind="info", scope="all", created_by="usr_admin1"))
    db.add(Alert(title="Outer Ring Road works", body="Expect minor delays on the Marathahalli stretch this week.",
                 kind="warning", scope="all", created_by="usr_admin1"))
    db.add(AuditLog(actor_id="usr_admin1", actor_name="Transport Admin", action="seed.completed",
                    detail=f"Seeded {hist_count} historical trips, {len(today_trips)} today trips, {len(routes)} routes"))
    db.commit()

    print(f"[OK] Seed complete: {len(routes)} routes, {len(buses)} buses, {len(drivers)} drivers,")
    print(f"  {len(STUDENTS)} students, {hist_count} historical trips, {len(today_trips)} trips today")
    print("  Logins: admin@campus.edu/admin@123 | raj@campus.edu/driver@123 | aarav@campus.edu/student@123")
    db.close()


if __name__ == "__main__":
    if "--if-empty" in sys.argv:
        sys.exit(_seed_if_empty())
    main()
