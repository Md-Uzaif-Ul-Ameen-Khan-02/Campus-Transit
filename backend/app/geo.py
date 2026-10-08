from __future__ import annotations

import math

R_EARTH_M = 6371000.0


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in meters."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_EARTH_M * math.asin(math.sqrt(a))


def bearing_deg(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Initial bearing from point 1 to point 2, degrees clockwise from north [0,360)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lng2 - lng1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def cumulative_distances(geometry: list[list[float]]) -> list[float]:
    """Cumulative along-route distance (meters) for each vertex of the polyline."""
    cum = [0.0]
    for i in range(1, len(geometry)):
        cum.append(cum[-1] + haversine_m(geometry[i - 1][0], geometry[i - 1][1], geometry[i][0], geometry[i][1]))
    return cum


def route_length_m(geometry: list[list[float]]) -> float:
    if not geometry or len(geometry) < 2:
        return 0.0
    return cumulative_distances(geometry)[-1]


def project_point_to_route(
    lat: float, lng: float, geometry: list[list[float]]
) -> tuple[float, float, float, int]:
    """Project a coordinate onto the route polyline.

    Returns (route_pos_m, snap_lat, snap_lng, off_route_distance_m).
    """
    if not geometry:
        return 0.0, lat, lng, 0.0
    if len(geometry) == 1:
        return 0.0, geometry[0][0], geometry[0][1], haversine_m(lat, lng, geometry[0][0], geometry[0][1])

    cum = cumulative_distances(geometry)
    best = (0.0, geometry[0][0], geometry[0][1], float("inf"))
    for i in range(len(geometry) - 1):
        lat_a, lng_a = geometry[i][0], geometry[i][1]
        lat_b, lng_b = geometry[i + 1][0], geometry[i + 1][1]
        seg_len = cum[i + 1] - cum[i]
        if seg_len <= 0:
            continue
        # Local equirectangular projection around segment midpoint (accurate at campus scale)
        mid_lat = (lat_a + lat_b) / 2
        kx = math.cos(math.radians(mid_lat)) * 111320.0  # meters per degree longitude
        ky = 110540.0  # meters per degree latitude
        bxm, bym = (lng_b - lng_a) * kx, (lat_b - lat_a) * ky
        pxm, pym = (lng - lng_a) * kx, (lat - lat_a) * ky
        seg_sq = bxm * bxm + bym * bym
        t = max(0.0, min(1.0, (pxm * bxm + pym * bym) / seg_sq))
        cxm, cym = t * bxm, t * bym
        dist = math.hypot(pxm - cxm, pym - cym)
        if dist < best[3]:
            snap_lat = lat_a + t * (lat_b - lat_a)
            snap_lng = lng_a + t * (lng_b - lng_a)
            best = (cum[i] + t * seg_len, snap_lat, snap_lng, dist)
    return best[0], best[1], best[2], best[3]


def point_along_route(geometry: list[list[float]], pos_m: float) -> tuple[float, float, float]:
    """Coordinate + heading at a given along-route distance (meters). Returns (lat, lng, heading)."""
    if not geometry:
        return 0.0, 0.0, 0.0
    if len(geometry) == 1:
        return geometry[0][0], geometry[0][1], 0.0
    cum = cumulative_distances(geometry)
    total = cum[-1]
    pos = max(0.0, min(pos_m, total))
    for i in range(len(geometry) - 1):
        if cum[i + 1] >= pos:
            seg_len = cum[i + 1] - cum[i]
            t = 0.0 if seg_len <= 0 else (pos - cum[i]) / seg_len
            lat = geometry[i][0] + t * (geometry[i + 1][0] - geometry[i][0])
            lng = geometry[i][1] + t * (geometry[i + 1][1] - geometry[i][1])
            heading = bearing_deg(geometry[i][0], geometry[i][1], geometry[i + 1][0], geometry[i + 1][1])
            return lat, lng, heading
    last = geometry[-1]
    prev = geometry[-2]
    return last[0], last[1], bearing_deg(prev[0], prev[1], last[0], last[1])
