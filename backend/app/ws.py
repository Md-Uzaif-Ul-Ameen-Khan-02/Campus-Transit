from __future__ import annotations

import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .db import SessionLocal
from .deps import get_ws_user
from .events import bus as event_bus

router = APIRouter()


@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    # Auth via ?token= JWT (secure WS handshake)
    db = SessionLocal()
    try:
        user = get_ws_user(ws, db)
        if not user:
            await ws.close(code=4401)
            return
        await ws.accept()

        topics = [t for t in (ws.query_params.get("topics") or "").split(",") if t]
        if not topics:
            topics = ["*"]
        q = event_bus.subscribe(*topics)

        async def reader():
            try:
                while True:
                    msg = await ws.receive_text()
                    if msg == "ping":
                        await ws.send_text('{"topic":"pong"}')
            except Exception:
                pass

        read_task = asyncio.create_task(reader())
        try:
            while True:
                try:
                    data = await asyncio.wait_for(q.get(), timeout=25)
                    await ws.send_text(data)
                except asyncio.TimeoutError:
                    await ws.send_text('{"topic":"heartbeat"}')
        except WebSocketDisconnect:
            pass
        finally:
            read_task.cancel()
            event_bus.unsubscribe(q, *topics)
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await ws.close(code=1011)
        except Exception:
            pass
    finally:
        db.close()
