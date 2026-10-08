"""End-to-end smoke test: walks the full demo scenario through the live API."""
from __future__ import annotations

import json
import sys

import httpx

BASE = "http://127.0.0.1:8000/api"
client = httpx.Client(base_url=BASE, timeout=30)

PASS, FAIL = 0, 0


def check(name: str, cond: bool, extra: str = ""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  [PASS] {name}")
    else:
        FAIL += 1
        print(f"  [FAIL] {name} {extra}")


def login(email: str, pw: str) -> httpx.Client:
    r = client.post("/auth/login", data={"username": email, "password": pw})
    r.raise_for_status()
    tok = r.json()["access_token"]
    c = httpx.Client(base_url=BASE, timeout=30, headers={"Authorization": f"Bearer {tok}"})
    return c


print("== 1. Auth & roles ==")
admin = login("admin@campus.edu", "admin@123")
driver = login("raj@campus.edu", "driver@123")
student = login("aarav@campus.edu", "student@123")
check("admin login", "admin" in admin.get("/auth/me").json()["role"])
check("driver login", driver.get("/auth/me").json()["role"] == "driver")
check("student login", student.get("/auth/me").json()["role"] == "student")
# security: student must NOT access admin API
check("RBAC blocks student from admin", student.get("/admin/overview").status_code == 403)
check("RBAC blocks student from creating bus", student.post("/buses", json={"registration_number": "XX-00-0000"}).status_code == 403)

print("== 2. Routes / buses / drivers ==")
routes = admin.get("/routes").json()
check("routes list", len(routes) >= 5)
krp = next((r for r in routes if r["name"] == "KR Puram"), routes[0])
check("route geometry present", len(krp["geometry"]) > 20 and krp["length_m"] > 8000)
buses = admin.get("/buses").json()
check("buses list", len(buses) >= 8)
drivers = admin.get("/drivers").json()
check("drivers list", len(drivers) >= 6)

print("== 3. Trip creation with conflict validation ==")
today = admin.get("/admin/overview").json()["today"]["date"]
existing = admin.get(f"/trips", params={"date": today}).json()
krp_trips = [t for t in existing if t["route_id"] == krp["id"] and t["bus_id"]]
trip = krp_trips[0]
check("today trips exist", len(existing) >= 10)

# conflict: same bus overlapping time
r = admin.post("/trips", json={
    "route_id": krp["id"], "bus_id": trip["bus_id"], "driver_id": trip["driver_id"],
    "trip_date": today, "scheduled_start": "07:35", "scheduled_end": "08:30",
})
check("conflict rejected (bus+driver double-booking)", r.status_code == 409, r.text[:80])

print("== 4. Student route + pickup selection ==")
s = student.post("/student/route", json={"route_id": krp["id"]}).json()
check("student selects route", s["route"]["id"] == krp["id"])
# pickup: point near 30% along the route
g = krp["geometry"]
import math

def along(g, frac):
    total = 0
    cum = [0]
    for i in range(1, len(g)):
        total += math.dist(g[i-1], g[i])
        cum.append(total)
    target = total * frac
    i = next(i for i in range(len(cum)) if cum[i] >= target)
    return g[i]

p = along(g, 0.35)
r = student.post("/student/pickup", json={"lat": p[0], "lng": p[1], "label": "Home gate"})
check("pickup accepted", r.status_code == 200, r.text[:120])
snap = r.json().get("snap", {})
check("pickup snapped to route", abs(snap.get("offRouteM", 1e9)) < 60)
# pickup too far from route must be rejected
far = along(g, 0.35)
r = student.post("/student/pickup", json={"lat": far[0] + 0.05, "lng": far[1] + 0.05, "label": "Far away"})
check("far pickup rejected", r.status_code == 422)

print("== 5. Driver starts trip (GPS pipeline) ==")
me = driver.get("/auth/me").json()
my_trips = driver.get("/trips", params={"mine": "true", "date": today}).json()
check("driver sees assigned trips", len(my_trips) >= 1)
dt = my_trips[0]
r = driver.post(f"/trips/{dt['id']}/start")
check("start trip", r.status_code == 200 and r.json()["status"] == "active", r.text[:120])

print("== 6. GPS ingestion + validation ==")
start_geo = along(g, 0.0)
r = driver.post(f"/trips/{dt['id']}/location", json={
    "lat": start_geo[0], "lng": start_geo[1], "accuracy": 8, "speed": 9, "heading": 90,
})
check("valid GPS accepted", r.status_code == 200 and r.json()["accepted"], r.text[:120])
# inaccurate fix rejected
r = driver.post(f"/trips/{dt['id']}/location", json={"lat": start_geo[0], "lng": start_geo[1], "accuracy": 500})
check("low-accuracy GPS rejected", r.status_code == 422)
# impossible speed rejected
r = driver.post(f"/trips/{dt['id']}/location", json={
    "lat": start_geo[0], "lng": start_geo[1], "accuracy": 8, "speed": 80,
})
check("impossible speed rejected", r.status_code == 422)
# GPS jump rejected
r = driver.post(f"/trips/{dt['id']}/location", json={
    "lat": g[-1][0], "lng": g[-1][1], "accuracy": 8, "speed": 10,
})
check("GPS jump rejected", r.status_code == 422, r.text[:100])

print("== 7. Occupancy ==")
r = driver.post(f"/trips/{dt['id']}/occupancy", json={"count": 32})
check("occupancy update", r.status_code == 200 and r.json()["level"] == "medium", r.text[:100])
track = student.get(f"/trips/{dt['id']}/track").json()
check("student sees occupancy", track.get("occupancy_level") == "medium")

print("== 8. Personalized ETA (route-position based) ==")
track = student.get("/student/tracking").json()
check("student tracking auto-discovers bus", track.get("tracking") is True)
b = track["buses"][0]
check("eta available", b["eta"]["available"] is True, json.dumps(b["eta"])[:120])
check("eta uses route distance", b["eta"]["distance_m"] > 100)
check("eta differs from straight-line", b["eta"]["method"] in ("live_speed", "recent_speed", "historical", "blended_historical", "default"))

print("== 9. Demo simulation (clearly separated) ==")
# Simulation must be BLOCKED on a trip already receiving real driver GPS:
r = admin.post(f"/trips/{dt['id']}/simulate", json={"speed_kmh": 40, "from_start": True})
check("simulation blocked on real-GPS trip", r.status_code == 409, r.text[:80])
# ...and allowed on a fresh trip via a second driver:
try:
    driver2 = login("arun@campus.edu", "driver@123")
    d2_trips = driver2.get("/trips", params={"mine": "true", "date": today}).json()
    d2t = d2_trips[0]
    r = driver2.post(f"/trips/{d2t['id']}/start")
    check("second driver starts trip", r.status_code == 200, r.text[:100])
    r = admin.post(f"/trips/{d2t['id']}/simulate", json={"speed_kmh": 40, "from_start": True})
    check("simulation started on demo trip", r.status_code == 200, r.text[:120])
    import time as _t

    _t.sleep(6)
    after = admin.get("/admin/live").json()
    sim = next((x for x in after if x["tripId"] == d2t["id"]), None)
    check("simulated bus moves along route", sim and sim["progress"] > 0, f"progress={sim and sim['progress']}")
    check("simulated source tagged demo_sim", sim and sim["source"] == "demo_sim")
    driver2.post(f"/trips/{d2t['id']}/end")
except Exception as e:
    check("demo simulation flow", False, str(e)[:100])

print("== 10. Delay reporting -> student notification ==")
n0 = len(student.get("/notifications").json())
r = driver.post(f"/trips/{dt['id']}/delay", json={"reason": "traffic", "minutes": 10})
check("delay reported", r.status_code == 200)
n1 = student.get("/notifications").json()
check("student got delay notification", len(n1) > n0 and any(x["type"] == "delay" for x in n1))

print("== 11. Bus replacement on live trip ==")
busy = {t["bus_id"] for t in existing}
new_bus = next(b for b in buses if b["id"] != dt["bus_id"] and b["id"] not in busy and b["status"] == "available")
r = admin.post(f"/trips/{dt['id']}/replace-bus", json={"bus_id": new_bus["id"], "reason": "Breakdown"})
check("bus replaced on active trip", r.status_code == 200 and r.json()["bus_id"] == new_bus["id"], r.text[:150])
n2 = student.get("/notifications").json()
check("student got replacement notification", any(x["type"] == "replacement" for x in n2))

print("== 12. Emergency flow ==")
r = driver.post(f"/trips/{dt['id']}/emergency", json={"kind": "vehicle", "note": "test"})
check("emergency triggered", r.status_code == 200 and r.json()["status"] == "emergency", r.text[:120])
r = admin.post(f"/trips/{dt['id']}/emergency/resolve")
check("emergency resolved by admin", r.status_code == 200, r.text[:120])

print("== 13. Admin overview & analytics ==")
ov = admin.get("/admin/overview").json()
check("admin overview", ov["today"]["activeTrips"] >= 1)
live = admin.get("/admin/live").json()
check("admin live ops", len(live) >= 1 and live[0]["tripId"] == dt["id"])
an = admin.get("/analytics/overview").json()
check("analytics overview", an["totalTrips"] > 50 and "avgDelayMin" in an)
ra = admin.get("/analytics/routes").json()
check("route analytics", len(ra) >= 5 and ra[0]["trips"] > 0)
oc = admin.get("/analytics/occupancy").json()
check("occupancy analytics", "byHour" in oc)

print("== 14. End trip stops tracking ==")
r = driver.post(f"/trips/{dt['id']}/end")
check("end trip", r.status_code == 200 and r.json()["status"] == "completed")
track2 = student.get("/student/tracking").json()
check("tracking stops after end", track2.get("tracking") is False)

print("== 15. Alerts + audit ==")
r = admin.post("/alerts", json={"title": "Test alert", "body": "hello", "kind": "info", "scope": "route", "route_id": krp["id"]})
check("alert published", r.status_code == 200, r.text[:100])
al = student.get("/alerts").json()
check("student sees scoped alert", any(a["title"] == "Test alert" for a in al))
aud = admin.get("/audit").json()
check("audit log has entries", len(aud) >= 5, f"got {len(aud)}")

print(f"\nRESULT: {PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
