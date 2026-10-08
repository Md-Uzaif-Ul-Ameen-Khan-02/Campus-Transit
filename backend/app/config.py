from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Campus Transit Platform"
    secret_key: str = "dev-secret-change-me-in-production"
    access_token_expire_minutes: int = 60 * 12
    database_url: str = "sqlite:///./campus_transit.db"
    cors_origins: str = "*"

    # Live tracking defaults (overridable at runtime via /admin/settings)
    location_interval_sec: int = 4
    location_stale_after_sec: int = 25
    location_max_accuracy_m: int = 150
    location_max_speed_kmh: float = 130.0
    location_max_jump_m: int = 3000
    demo_tick_sec: float = 2.0

    # ETA defaults
    eta_default_speed_kmh: float = 22.0
    eta_min_speed_kmh: float = 7.0
    eta_low_factor: float = 0.85
    eta_high_factor: float = 1.30

    # Pickup snapping
    pickup_max_snap_distance_m: int = 800

    # Occupancy thresholds (% of capacity)
    occupancy_low_max_pct: int = 40
    occupancy_high_min_pct: int = 76


settings = Settings()
