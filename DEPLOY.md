# Deployment Guide

Three supported paths, easiest first. Pick one:

| Path | Best for | Effort |
|---|---|---|
| 1. Docker Compose | Any server (campus VM, VPS, cloud) | ~5 min |
| 2. Managed PaaS (Railway / Render / Fly.io) | No server to babysit | ~10 min |
| 3. Bare metal: systemd + Nginx | Existing campus Linux box | ~30 min |

---

## 1. Docker Compose (recommended)

### Prerequisites
- Docker + Docker Compose v2 (`docker compose version`)
- Ports 5432 (internal only) and 8000 (public) available

### One-time setup

```bash
cp .env.example .env
# Edit .env:
#   SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")
#   POSTGRES_PASSWORD=strong-password
#   CORS_ORIGINS=https://your-host-name   # or keep "*" if UI is served by the API itself
#   SEED_DEMO_DATA=1                      # 0 for a clean production DB
```

### Start

```bash
docker compose up -d --build
docker compose logs -f api       # watch for "[OK] Seed complete" then "Uvicorn running"
```

Then open `http://<server>:8000/` — the API serves the built React UI itself; no reverse proxy needed to start.

- Health check: `GET /api/health` → `{"status": "ok"}`
- Demo logins (only when `SEED_DEMO_DATA=1`):
  - admin@campus.edu / admin@123
  - raj@campus.edu / driver@123
  - aarav@campus.edu / student@123

### What the stack runs

- `db` — Postgres 16 with a persistent `pgdata` volume. Data survives restarts.
- `api` — uvicorn serving `/api/*`, `/api/ws` (WebSockets), and the built frontend at `/`.
- On first boot with an empty DB, the container runs `seed_data.py --if-empty`: a **fresh/demoseed** server. On a DB that already has data, it skips and prints `[seed] Database already has data — skipping` — so restarts and rebuilds never wipe your data. Set `SEED_DEMO_DATA=0` to never seed.

### Sim or real driver-phone GPS?

- Real deployments: leave `demo_simulator` and the `/api/trips/{id}/simulate` endpoints available (they're demo/tooling features) but don't use them — business rule blocks fake and real fixes from being mixed on one trip.
- Production with real drivers: drivers open the built UI on their phones (Driver Dashboard), which uses the browser GPS.

### Backups

```bash
docker compose exec db pg_dump -U transit campus_transit > backup_$(date +%F).sql
# restore:
cat backup_2026-10-08.sql | docker compose exec -T db psql -U transit campus_transit
```

### Upgrade

```bash
git pull
docker compose up -d --build     # rebuilds, preserves pgdata volume
```

### Teardown (careful — deletes data)

```bash
docker compose down            # stop, keep data
docker compose down -v         # stop AND delete the Postgres volume
```

---

## 2. Railway / Render / Fly.io

Both need: Postgres + your container. The repo already builds a single container that serves both API and UI, so this is a matter of pointing the provider at it.

1. Create the provider project, add **Postgres** (gives you `DATABASE_URL`).
2. Deploy from the repo root (Railway auto-detects the Dockerfile; on Render choose "Web Service → Docker").
3. Environment variables:
   - `DATABASE_URL` = the provider's Postgres URL (Railway/Render use `postgresql://`; if the URL starts with `postgres://`, SQLAlchemy 2 still accepts it, but `postgresql+psycopg2://` is safest).
   - `SECRET_KEY` — long random string.
   - `CORS_ORIGINS` = your public UI URL (same as the app origin if served by the API).
   - `SEED_DEMO_DATA=1` for a one-time demo, `0` for production.
4. Run a one-off shell job once after the first deploy to seed:
   `python seed_data.py --if-empty` (workdir `/srv/app/backend` in the image).
5. Note PaaS notes: WebSockets need a provider that supports them end-to-end (Railway, Render, and Fly all do).

---

## 3. Bare metal: systemd + Nginx + HTTPS

```bash
# DB (Postgres already installed on campus server)
sudo -u postgres createdb campus_transit
sudo -u postgres psql -c "CREATE USER transit WITH PASSWORD 'your-strong-password';"
sudo -u postgres psql -c "GRANT ALL ON DATABASE campus_transit TO transit;"

# App
cd /opt/campus-transit
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt psycopg2-binary==2.9.10

# Frontend build (NodeJS must be installed on the build machine)
cd frontend && npm ci && npm run build && cd ..

# Environment
cat > backend/.env <<'EOF'
DATABASE_URL=postgresql+psycopg2://transit:your-strong-password@localhost:5432/campus_transit
SECRET_KEY=paste-random-64-hex-chars
CORS_ORIGINS=https://transit.your-domain.edu
SEED_DEMO_DATA=0
EOF

# First run: create tables + (optionally) seed
cd backend && python seed_data.py --if-empty
```

`/etc/systemd/system/campus-transit.service`:

```ini
[Unit]
Description=Campus Transit API
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/campus-transit/backend
EnvironmentFile=/opt/campus-transit/backend/.env
ExecStart=/opt/campus-transit/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 2
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now campus-transit
```

> **`--workers 2` caveat:** live GPS broadcasting uses an **in-process** event bus
> (`app/events.py`). With more than one uvicorn worker, WebSocket clients connected
> to one worker will **not** receive fixes ingested by another. Keep 1 worker, or
> switch the event bus to Postgres LISTEN/NOTIFY or Redis pub/sub before scaling out.
> Demo-seeding must also run exactly once — it's not multi-worker safe.

Nginx:

```nginx
server {
    listen 443 ssl http2;
    server_name transit.your-domain.edu;

    # certificates via certbot --nginx
    ssl_certificate     /etc/letsencrypt/live/transit.your-domain.edu/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/transit.your-domain.edu/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;               # WebSocket upgrade
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;              # long-lived sockets
    }
}
```

HTTPS matters for two hard reasons beyond the obvious: driver GPS (watchPosition)
**requires secure context**, and JWTs are sent as headers on every API call.

```bash
sudo certbot --nginx -d transit.your-domain.edu
```

---

## Post-deploy checks (any path)

```bash
curl -s http://<host>/api/health | jq
# then open the UI, log in as admin, verify:
#   - Live Ops shows buses / DEMO SIM badge (if seeded + demo running)
#   - a student dashboard shows a route + pickup ETA
#   - open the app in two browser tabs and confirm WS updates propagate
```

## Checklist

- [ ] `SECRET_KEY` is a fresh random value (not `dev-secret-change-me-in-production`)
- [ ] `DATABASE_URL` points at Postgres, not SQLite
- [ ] demo data seeded (or not) deliberately
- [ ] HTTPS enabled (required for driver-phone GPS)
- [ ] Postgres volume / pg_dump backup scheduled
- [ ] Firewall: expose only 80/443 (or 8000); keep 5432 internal
