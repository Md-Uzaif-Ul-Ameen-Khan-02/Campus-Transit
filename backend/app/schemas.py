from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, EmailStr, Field


# ---------- Auth ----------
class RegisterIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=80)
    email: EmailStr
    phone: str = ""
    password: str = Field(min_length=6, max_length=128)
    role: str = "student"  # student | driver (admin cannot self-register)
    employee_code: str = ""


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    full_name: str
    user_id: str


# ---------- Buses ----------
class BusIn(BaseModel):
    registration_number: str = Field(min_length=4, max_length=20)
    display_name: str = ""
    capacity: int = Field(default=45, ge=1, le=200)
    vehicle_type: str = "standard"
    status: str = "available"
    active: bool = True
    is_ev: bool = False
    accessible: bool = False
    notes: str = ""


class BusOut(BaseModel):
    id: str
    registration_number: str
    display_name: str
    capacity: int
    vehicle_type: str
    status: str
    active: bool
    is_ev: bool
    accessible: bool
    notes: str

    class Config:
        from_attributes = True


# ---------- Drivers ----------
class DriverIn(BaseModel):
    full_name: str
    phone: str = ""
    email: EmailStr
    password: str = ""
    employee_code: str = ""
    license_no: str = ""
    active: bool = True
    status: str = "available"


class DriverOut(BaseModel):
    id: str
    full_name: str
    phone: str
    email: str
    employee_code: str
    license_no: str
    status: str
    active: bool

    class Config:
        from_attributes = True


# ---------- Routes ----------
class Landmark(BaseModel):
    name: str
    lat: float
    lng: float


class RouteIn(BaseModel):
    name: str
    code: str = ""
    description: str = ""
    direction: str = "outbound"
    color: str = "#2563eb"
    active: bool = True
    geometry: list[list[float]] = []
    landmarks: list[Landmark] = []
    standard_duration_min: float = 0


class RouteOut(BaseModel):
    id: str
    name: str
    code: str
    description: str
    direction: str
    color: str
    active: bool
    geometry: list
    landmarks: list
    standard_duration_min: float
    length_m: float = 0
    student_count: int = 0

    class Config:
        from_attributes = True


# ---------- Trips ----------
class TripIn(BaseModel):
    route_id: str
    bus_id: str | None = None
    driver_id: str | None = None
    trip_date: str  # YYYY-MM-DD
    scheduled_start: str  # HH:MM
    scheduled_end: str = ""
    status: str = "assigned"  # scheduled | assigned


class TripOut(BaseModel):
    id: str
    route_id: str
    bus_id: str | None
    driver_id: str | None
    trip_date: str
    scheduled_start: str
    scheduled_end: str
    status: str
    occupancy: int
    delay_min: float
    source: str
    current_lat: float | None
    current_lng: float | None
    route_name: str = ""
    route_color: str = ""
    bus_reg: str = ""
    bus_name: str = ""
    driver_name: str = ""
    capacity: int = 0
    last_fix_at: datetime | None = None

    class Config:
        from_attributes = True


class ReplaceBusIn(BaseModel):
    bus_id: str
    reason: str = ""


class ReplaceDriverIn(BaseModel):
    driver_id: str
    reason: str = ""


# ---------- Location ingestion ----------
class LocationIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy: float = 0  # meters
    speed: float = 0  # m/s
    heading: float = 0  # degrees
    device_time: datetime | None = None
    source: str = "driver_phone"  # driver_phone | iot_device


class OccupancyIn(BaseModel):
    count: int = Field(ge=0, le=200)


class OccupancyOut(BaseModel):
    count: int
    capacity: int
    level: str


# ---------- Alerts / notifications ----------
class AlertIn(BaseModel):
    title: str
    body: str = ""
    kind: str = "info"
    scope: str = "all"
    route_id: str | None = None
    trip_id: str | None = None


class DelayReportIn(BaseModel):
    reason: str  # traffic | mechanical | road_blockage | weather | other
    minutes: float = 0


class EmergencyIn(BaseModel):
    kind: str  # medical | vehicle | accident | security | other
    note: str = ""


class PickupIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    label: str = ""


class RouteSelectionIn(BaseModel):
    route_id: str | None = None


class ProfileOut(BaseModel):
    id: str
    email: str
    full_name: str
    phone: str
    role: str

    class Config:
        from_attributes = True


class SettingsOut(BaseModel):
    location_interval_sec: int
    location_stale_after_sec: int
    location_max_accuracy_m: int
    location_max_speed_kmh: float
    location_max_jump_m: int
    eta_default_speed_kmh: float
    eta_min_speed_kmh: float
    occupancy_low_max_pct: int
    occupancy_high_min_pct: int
    pickup_max_snap_distance_m: int
    demo_tick_sec: float


class SettingsIn(BaseModel):
    location_interval_sec: int | None = Field(default=None, ge=1, le=120)
    location_stale_after_sec: int | None = Field(default=None, ge=5, le=600)
    location_max_accuracy_m: int | None = Field(default=None, ge=10, le=2000)
    location_max_speed_kmh: float | None = Field(default=None, ge=30, le=300)
    location_max_jump_m: int | None = Field(default=None, ge=100, le=20000)
    eta_default_speed_kmh: float | None = Field(default=None, ge=5, le=80)
    eta_min_speed_kmh: float | None = Field(default=None, ge=1, le=30)
    occupancy_low_max_pct: int | None = Field(default=None, ge=5, le=90)
    occupancy_high_min_pct: int | None = Field(default=None, ge=10, le=99)
    pickup_max_snap_distance_m: int | None = Field(default=None, ge=50, le=5000)
    demo_tick_sec: float | None = Field(default=None, ge=0.5, le=15)


class SimulationIn(BaseModel):
    speed_kmh: float = Field(default=28, ge=5, le=80)
    from_start: bool = False
