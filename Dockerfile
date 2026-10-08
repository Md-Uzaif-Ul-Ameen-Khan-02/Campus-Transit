# Stage 1: build the React frontend with Node
FROM node:22-alpine AS web-build

WORKDIR /build

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend .
RUN npm run build

# Stage 2: backend + built frontend
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv/app

COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install -r backend/requirements.txt && pip install psycopg2-binary==2.9.10

COPY backend/app ./backend/app
COPY backend/seed_data.py backend/smoke_test.py ./backend/

# Built frontend so app.main serves it statically at "/"
COPY --from=web-build /build/dist ./frontend/dist

ENV DATABASE_URL=sqlite:///./campus_transit.db \
    CORS_ORIGINS="*" \
    SEED_DEMO_DATA=1

EXPOSE 8000

WORKDIR /srv/app/backend

CMD ["sh", "-c", "if [ \"$SEED_DEMO_DATA\" = \"1\" ]; then n=0; until python seed_data.py --if-empty || [ $n -ge 24 ]; do n=$((n+1)); echo \"[boot] Waiting for database ($n/24)...\"; sleep 5; done; fi && exec python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
