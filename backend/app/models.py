from __future__ import annotations

import uuid
from datetime import datetime, timezone
from sqlalchemy import (JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, Index)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    phone: Mapped[str] = mapped_column(String, default="")
    full_name: Mapped[str] = mapped_column(String)
    role: Mapped[str] = mapped_column(String, index=True)  # student | driver | admin
    password_hash: Mapped[str] = mapped_column(String)
    disabled: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    student_profile: Mapped["StudentProfile | None"] = relationship(back_populates="user", uselist=False)
    driver_profile: Mapped["Driver | None"] = relationship(back_populates="user", uselist=False)


class StudentProfile(Base):
    __tablename__ = "student_profiles"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uid("sp"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), unique=True)
    route_id: Mapped[str | None] = mapped_column(ForeignKey("routes.id"), nullable=True)
    # Personal pickup: raw chosen position and its snap projection onto the route
    pickup_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    pickup_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    pickup_label: Mapped[str] = mapped_column(String, default="")
    pickup_route_pos_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    pickup_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    notify_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # approach notification stage per student (0 none,1 far,2 approaching,3 close,4 arriving)
    last_stage: Mapped[int] = mapped_column(Integer, default=0)

    user: Mapped[User] = relationship(back_populates="student_profile")


class Driver(Base):
    __tablename__ = "drivers"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uid("drv"))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), unique=True)
    employee_code: Mapped[str] = mapped_column(String, default="")
    license_no: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(String, default="available")  # offline|available|assigned|on_trip|emergency|unavailable
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    user: Mapped[User] = relationship(back_populates="driver_profile")
    trips: Mapped[list["Trip"]] = relationship(back_populates="driver_rel")


class Bus(Base):
    __tablename__ = "buses"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uid("bus"))
    registration_number: Mapped[str] = mapped_column(String, unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String, default="")
    capacity: Mapped[int] = mapped_column(Integer, default=45)
    vehicle_type: Mapped[str] = mapped_column(String, default="standard")  # standard|mini|ev|accessible
    status: Mapped[str] = mapped_column(String, default="available")  # available|assigned|active|maintenance|unavailable|inactive
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_ev: Mapped[bool] = mapped_column(Boolean, default=False)
    accessible: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str] = mapped_column(Text, default="")

    trips: Mapped[list["Trip"]] = relationship(back_populates="bus_rel")


class Route(Base):
    __tablename__ = "routes"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uid("rt"))
    name: Mapped[str] = mapped_column(String, index=True)
    code: Mapped[str] = mapped_column(String, default="")
    description: Mapped[str] = mapped_column(Text, default="")
    direction: Mapped[str] = mapped_column(String, default="outbound")  # outbound|inbound (one directional geometry per route for v1)
    color: Mapped[str] = mapped_column(String, default="#2563eb")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    geometry: Mapped[list] = mapped_column(JSON, default=list)  # [[lat,lng], ...] along actual road path
    landmarks: Mapped[list] = mapped_column(JSON, default=list)  # [{name,lat,lng}]
    standard_duration_min: Mapped[float] = mapped_column(Float, default=0)  # 0 = unknown
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Trip(Base):
    __tablename__ = "trips"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uid("trip"))
    route_id: Mapped[str] = mapped_column(ForeignKey("routes.id"), index=True)
    bus_id: Mapped[str | None] = mapped_column(ForeignKey("buses.id"), nullable=True, index=True)
    driver_id: Mapped[str | None] = mapped_column(ForeignKey("drivers.id"), nullable=True, index=True)
    trip_date: Mapped[str] = mapped_column(String, index=True)  # YYYY-MM-DD
    scheduled_start: Mapped[str] = mapped_column(String)  # HH:MM
    scheduled_end: Mapped[str] = mapped_column(String, default="")
    actual_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    actual_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String, default="scheduled", index=True)
    # scheduled|assigned|ready|active|delayed|completed|cancelled|interrupted|emergency
    occupancy: Mapped[int] = mapped_column(Integer, default=0)
    delay_min: Mapped[float] = mapped_column(Float, default=0)
    current_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    current_lng: Mapped[float | None] = mapped_column(Float, nullable=True)
    current_speed: Mapped[float] = mapped_column(Float, default=0)
    current_heading: Mapped[float] = mapped_column(Float, default=0)
    current_accuracy: Mapped[float] = mapped_column(Float, default=0)
    route_pos_m: Mapped[float] = mapped_column(Float, default=0)
    progress: Mapped[float] = mapped_column(Float, default=0)  # 0..1 along route
    last_fix_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    source: Mapped[str] = mapped_column(String, default="driver_phone")  # driver_phone | iot_device | demo_sim
    emergency_type: Mapped[str] = mapped_column(String, default="")
    emergency_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    route_rel: Mapped[Route] = relationship()
    bus_rel: Mapped[Bus | None] = relationship()
    driver_rel: Mapped[Driver | None] = relationship()
    locations: Mapped[list["LocationPoint"]] = relationship(back_populates="trip", cascade="all, delete-orphan")
    occupancy_records: Mapped[list["OccupancyRecord"]] = relationship(back_populates="trip", cascade="all, delete-orphan")
    replacement_bus_id: Mapped[str | None] = mapped_column(String, nullable=True)
    original_bus_id: Mapped[str | None] = mapped_column(String, nullable=True)
    original_driver_id: Mapped[str | None] = mapped_column(String, nullable=True)


class LocationPoint(Base):
    __tablename__ = "location_points"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id"), index=True)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    speed: Mapped[float] = mapped_column(Float, default=0)  # m/s
    heading: Mapped[float] = mapped_column(Float, default=0)
    accuracy: Mapped[float] = mapped_column(Float, default=0)  # meters
    route_pos_m: Mapped[float] = mapped_column(Float, default=0)
    source: Mapped[str] = mapped_column(String, default="driver_phone")
    device_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    trip: Mapped[Trip] = relationship(back_populates="locations")


class OccupancyRecord(Base):
    __tablename__ = "occupancy_records"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trip_id: Mapped[str] = mapped_column(ForeignKey("trips.id"), index=True)
    count: Mapped[int] = mapped_column(Integer)
    capacity: Mapped[int] = mapped_column(Integer)
    level: Mapped[str] = mapped_column(String, default="low")  # low|medium|high
    recorded_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    trip: Mapped[Trip] = relationship(back_populates="occupancy_records")


class Alert(Base):
    __tablename__ = "alerts"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uid("alr"))
    title: Mapped[str] = mapped_column(String)
    body: Mapped[str] = mapped_column(Text, default="")
    kind: Mapped[str] = mapped_column(String, default="info")  # info|warning|critical|delay|replacement|cancellation|emergency
    scope: Mapped[str] = mapped_column(String, default="all")  # all|route|trip
    route_id: Mapped[str | None] = mapped_column(String, nullable=True)
    trip_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_by: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uid("ntf"))
    user_id: Mapped[str] = mapped_column(String, index=True)
    type: Mapped[str] = mapped_column(String)  # approaching|delay|replacement|cancellation|alert|trip_update|emergency
    title: Mapped[str] = mapped_column(String)
    body: Mapped[str] = mapped_column(Text, default="")
    route_id: Mapped[str | None] = mapped_column(String, nullable=True)
    trip_id: Mapped[str | None] = mapped_column(String, nullable=True)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AssignmentLog(Base):
    """Append-only history of bus/driver assignment changes per trip."""
    __tablename__ = "assignment_logs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uid("asg"))
    trip_id: Mapped[str] = mapped_column(String, index=True)
    change: Mapped[str] = mapped_column(String)  # created|replace_bus|replace_driver|cancel|reactivate
    old_bus_id: Mapped[str | None] = mapped_column(String, nullable=True)
    new_bus_id: Mapped[str | None] = mapped_column(String, nullable=True)
    old_driver_id: Mapped[str | None] = mapped_column(String, nullable=True)
    new_driver_id: Mapped[str | None] = mapped_column(String, nullable=True)
    note: Mapped[str] = mapped_column(Text, default="")
    actor: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uid("aud"))
    actor_id: Mapped[str] = mapped_column(String, default="")
    actor_name: Mapped[str] = mapped_column(String, default="")
    action: Mapped[str] = mapped_column(String, index=True)
    detail: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class SegmentStat(Base):
    """Historical average travel seconds per route per hour-of-day, used by the segment ETA model."""
    __tablename__ = "segment_stats"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uid("seg"))
    route_id: Mapped[str] = mapped_column(String, index=True)
    direction: Mapped[str] = mapped_column(String, default="outbound")
    hour: Mapped[int] = mapped_column(Integer, index=True)
    avg_speed_kmh: Mapped[float] = mapped_column(Float, default=20.0)
    samples: Mapped[int] = mapped_column(Integer, default=0)


class AppSetting(Base):
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String, primary_key=True)
    value: Mapped[str] = mapped_column(String, default="")


class DemoRun(Base):
    __tablename__ = "demo_runs"
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: uid("demo"))
    trip_id: Mapped[str] = mapped_column(String, index=True)
    running: Mapped[bool] = mapped_column(Boolean, default=True)
    speed_kmh: Mapped[float] = mapped_column(Float, default=28)
    progress: Mapped[float] = mapped_column(Float, default=0)  # meters travelled along route
    started_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


Index("ix_trips_route_date", Trip.route_id, Trip.trip_date, Trip.status)
Index("ix_notif_user_read", Notification.user_id, Notification.read)
