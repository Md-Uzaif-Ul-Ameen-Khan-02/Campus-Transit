from __future__ import annotations

import asyncio
import json
import time
from collections import defaultdict

# Central in-process pub/sub for real-time events (WebSocket fan-out).
# Event types: trip.started, trip.ended, bus.location.updated, bus.occupancy.updated,
# trip.delayed, trip.replaced, trip.cancelled, emergency.triggered, emergency.resolved,
# alert.published, notifications.new

class EventBus:
    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue]] = defaultdict(set)
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self, *topics: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        for t in topics:
            self._subs[t].add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue, *topics: str) -> None:
        for t in topics:
            self._subs[t].discard(q)

    def publish(self, topic: str, payload: dict) -> None:
        """Thread-safe publish; safe to call from sync request handlers."""
        data = json.dumps({"topic": topic, "payload": payload, "ts": time.time()}, default=str)
        for q in list(self._subs.get(topic, set())) + list(self._subs.get("*", set())):
            try:
                if self._loop and self._loop.is_running():
                    self._loop.call_soon_threadsafe(q.put_nowait, data)
                else:
                    q.put_nowait(data)
            except Exception:
                pass


bus = EventBus()
