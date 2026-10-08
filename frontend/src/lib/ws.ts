import { getToken } from "./api";

type Handler = (topic: string, payload: any) => void;

/**
 * Live event socket with auto-reconnect + exponential backoff.
 * Subscribes to the given topics once per connection.
 */
export class LiveSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private topics: string[];
  private retry = 0;
  private closed = false;
  private timer: number | null = null;

  constructor(topics: string[] = []) {
    this.topics = topics;
  }

  connect() {
    if (this.closed) return;
    const token = getToken();
    if (!token) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const t = encodeURIComponent(this.topics.join(","));
    this.ws = new WebSocket(`${proto}://${location.host}/api/ws?token=${token}&topics=${t}`);
    this.ws.onopen = () => {
      this.retry = 0;
    };
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.topic && msg.topic !== "heartbeat" && msg.topic !== "pong") {
          this.handlers.forEach((h) => h(msg.topic, msg.payload));
        }
      } catch {
        /* ignore */
      }
    };
    this.ws.onclose = () => {
      if (this.closed) return;
      const delay = Math.min(1000 * 2 ** this.retry, 15000);
      this.retry += 1;
      this.timer = window.setTimeout(() => this.connect(), delay);
    };
    this.ws.onerror = () => this.ws?.close();
  }

  on(h: Handler) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  close() {
    this.closed = true;
    if (this.timer) window.clearTimeout(this.timer);
    this.ws?.close();
  }
}
