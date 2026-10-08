import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export interface LatLngT {
  lat: number;
  lng: number;
}

function busIcon(heading: number, fillColor: string, emergency: boolean) {
  return L.divIcon({
    className: "",
    html: `<div style="transform:rotate(${heading}deg);transition:transform .8s linear;">
      <svg width="38" height="38" viewBox="0 0 38 38">
        <polygon points="19,3 30,30 19,24 8,30" fill="${emergency ? "#dc2626" : fillColor}" stroke="white" stroke-width="2"/>
      </svg></div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

export function RouteMap({
  geometry, pickup, bus, otherBuses, color = "#2563eb", emergency = false, height = "420px", follow = false, className = "",
}: {
  geometry: [number, number][];
  pickup?: (LatLngT & { label?: string }) | null;
  bus?: { lat: number; lng: number; heading: number } | null;
  otherBuses?: { lat: number; lng: number; heading: number; label?: string }[];
  color?: string;
  emergency?: boolean;
  height?: string;
  follow?: boolean;
  className?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const routeLine = useRef<L.Polyline | null>(null);
  const pickupMarker = useRef<L.Marker | null>(null);
  const busMarker = useRef<L.Marker | null>(null);
  const otherMarkers = useRef<Map<string, L.Marker>>(new Map());

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: true, attributionControl: false });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const pts = (geometry || []).map((p) => L.latLng(p[0], p[1]));
    if (routeLine.current) routeLine.current.remove();
    if (pts.length >= 2) {
      routeLine.current = L.polyline(pts, { color, weight: 5, opacity: 0.85 }).addTo(m);
      if (!(m as any)._fitted) {
        m.fitBounds(routeLine.current.getBounds().pad(0.15));
        (m as any)._fitted = true;
      }
    }
  }, [geometry, color]);

  useEffect(() => {
    const marker = busMarker.current;
    return () => {
      marker?.remove();
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!bus || bus.lat == null) {
      busMarker.current?.remove();
      busMarker.current = null;
      return;
    }
    if (!busMarker.current) {
      busMarker.current = L.marker([bus.lat, bus.lng], { icon: busIcon(bus.heading || 0, color, emergency) }).addTo(m);
      if (follow) m.setView([bus.lat, bus.lng], Math.max(m.getZoom(), 15));
    } else {
      busMarker.current.setLatLng([bus.lat, bus.lng]);
      busMarker.current.setIcon(busIcon(bus.heading || 0, color, emergency));
    }
  }, [bus?.lat, bus?.lng, bus?.heading, emergency, color, follow]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    pickupMarker.current?.remove();
    pickupMarker.current = null;
    if (pickup && pickup.lat != null) {
      pickupMarker.current = L.marker([pickup.lat, pickup.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="display:flex;flex-direction:column;align-items:center;">
            <div style="background:#16a34a;color:white;font-size:10px;font-weight:700;padding:2px 8px;border-radius:9999px;white-space:nowrap;">📍 ${pickup.label || "Your pickup"}</div>
          </div>`,
          iconSize: [0, 0],
          iconAnchor: [8, 8],
        }),
      }).addTo(m);
    }
  }, [pickup?.lat, pickup?.lng, pickup?.label]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const keep = new Set((otherBuses || []).map((b) => b.label || `${b.lat},${b.lng}`));
    for (const [key, marker] of otherMarkers.current) {
      if (!keep.has(key)) {
        marker.remove();
        otherMarkers.current.delete(key);
      }
    }
    for (const b of otherBuses || []) {
      const key = b.label || `${b.lat},${b.lng}`;
      let mk = otherMarkers.current.get(key);
      if (!mk) {
        mk = L.marker([b.lat, b.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div style="transform:rotate(${b.heading}deg);">
              <svg width="26" height="26" viewBox="0 0 26 26"><polygon points="13,2 20,20 13,16 6,20" fill="#64748b" stroke="white" stroke-width="1.5"/></svg>
            </div>`,
            iconSize: [26, 26],
            iconAnchor: [13, 13],
          }),
        }).addTo(m);
        otherMarkers.current.set(key, mk);
      } else {
        mk.setLatLng([b.lat, b.lng]);
      }
    }
  }, [otherBuses]);

  return <div ref={el} style={{ height }} className={`w-full ${className}`} aria-label="Live bus map" />;
}

export function PickupPickerMap({
  geometry, initial, onPick, color = "#2563eb", height = "380px",
}: {
  geometry: [number, number][];
  initial?: LatLngT | null;
  onPick: (lat: number, lng: number) => void;
  color?: string;
  height?: string;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const pin = useRef<L.Marker | null>(null);
  const line = useRef<L.Polyline | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19 }).addTo(m);
    const pts = (geometry || []).map((p) => L.latLng(p[0], p[1]));
    if (pts.length >= 2) {
      line.current = L.polyline(pts, { color, weight: 5, opacity: 0.85 }).addTo(m);
      m.fitBounds(line.current.getBounds().pad(0.15));
    }
    m.on("click", (e: L.LeafletMouseEvent) => onPick(e.latlng.lat, e.latlng.lng));
    if (initial) {
      pin.current = L.marker([initial.lat, initial.lng]).addTo(m);
    }
    map.current = m;
    return () => {
      m.off("click");
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (pin.current) {
      pin.current.remove();
      pin.current = null;
    }
    if (initial) {
      pin.current = L.marker([initial.lat, initial.lng], {
        icon: L.divIcon({
          className: "",
          html: `<div style="font-size:26px;line-height:26px;">📍</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 26],
        }),
      }).addTo(m);
    }
  }, [initial?.lat, initial?.lng]);

  return <div ref={el} style={{ height }} className="w-full rounded-xl overflow-hidden" aria-label="Pickup selection map" />;
}
