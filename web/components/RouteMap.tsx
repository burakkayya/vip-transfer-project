"use client";

// Rezervasyon sayfası rota haritası (Google Maps JavaScript API).
// Rota rayı dili (DESIGN.md): alış = dolu daire, varış = dolu kare, çizgi lake siyah.
// Teklif gelene kadar iki nokta kesikli çizgiyle, teklif gelince backend'in döndürdüğü
// gerçek karayolu rotası (encoded polyline) çizilir. Anahtar yoksa veya reddedilirse
// sayfa bozulmaz: aynı alanda sade bir rota özeti gösterilir.

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { MAPS_BROWSER_KEY, decodePolyline, loadGoogleMaps, onMapsAuthFailure } from "@/lib/googleMaps";

export type MapPoint = { lat: number; lng: number; label: string };

const INK = "#0b0b0c";
const ANTALYA = { lat: 36.8969, lng: 30.7133 };

/** Sakin, düşük doygunluklu zemin: rota ve işaretler öne çıkar. */
const MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#f5f5f3" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#6b6b70" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#ffffff" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ visibility: "on" }, { color: "#e6efe4" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
  { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#ecebe7" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#d6d5d0" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#dbe6ec" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
];

type Drawn = { line?: google.maps.Polyline; markers: google.maps.OverlayView[] };

export default function RouteMap(props: {
  from: MapPoint | null;
  to: MapPoint | null;
  /** Backend'in fiyat teklifindeki rota (encoded polyline). */
  route?: string | null;
  /** "15 km, yaklaşık 23 dk" gibi; teklif gelince gösterilir. */
  meta?: string | null;
}) {
  const t = useTranslations("book");
  const locale = useLocale();
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const drawn = useRef<Drawn>({ markers: [] });
  /** Son çizilen noktalar: harita boyutu değişince (sütun düzeni, döndürme) yeniden sığdırılır. */
  const framed = useRef<{ lat: number; lng: number }[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(MAPS_BROWSER_KEY ? "loading" : "failed");

  // Haritayı bir kez kur.
  useEffect(() => {
    if (!MAPS_BROWSER_KEY) return;
    let alive = true;
    const off = onMapsAuthFailure(() => alive && setStatus("failed"));
    loadGoogleMaps(locale)
      .then(async (maps) => {
        const { Map } = (await maps.importLibrary("maps")) as google.maps.MapsLibrary;
        if (!alive || !el.current || map.current) return;
        map.current = new Map(el.current, {
          center: ANTALYA,
          zoom: 9,
          styles: MAP_STYLE,
          disableDefaultUI: true,
          zoomControl: true,
          keyboardShortcuts: true,
          gestureHandling: "cooperative",
          clickableIcons: false,
          backgroundColor: "#f5f5f3",
        });
        setStatus("ready");
      })
      .catch(() => alive && setStatus("failed"));
    return () => {
      alive = false;
      off();
    };
  }, [locale]);

  // Rota ve işaretleri çiz.
  const { from, to, route } = props;
  useEffect(() => {
    const m = map.current;
    if (status !== "ready" || !m) return;
    const g = window.google.maps;
    drawn.current.line?.setMap(null);
    drawn.current.markers.forEach((o) => o.setMap(null));
    drawn.current = { markers: [] };

    const path = route ? decodePolyline(route) : [];
    const real = path.length > 1;
    const line = real ? path : from && to ? [from, to] : [];
    if (line.length > 1) {
      drawn.current.line = new g.Polyline({
        map: m,
        path: line,
        clickable: false,
        strokeColor: INK,
        strokeOpacity: real ? 1 : 0,
        strokeWeight: real ? 4 : 3,
        // Rota hesaplanmadan önce kesikli çizgi: tahmini bağlantı, gerçek yol değil.
        icons: real
          ? undefined
          : [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, strokeColor: INK, scale: 2 }, offset: "0", repeat: "12px" }],
      });
    }
    if (from) drawn.current.markers.push(pin(g, m, from, "pickup", t("mapPickup")));
    if (to) drawn.current.markers.push(pin(g, m, to, "dropoff", t("mapDropoff")));

    framed.current = line.length > 0 ? line : ([from, to].filter(Boolean) as MapPoint[]);
    frame(m, framed.current);
  }, [status, from, to, route, t]);

  // Kapsayıcı boyutu değişince rota yeniden sığdırılır.
  useEffect(() => {
    const m = map.current;
    const node = el.current;
    if (status !== "ready" || !m || !node || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => frame(m, framed.current));
    });
    ro.observe(node);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [status]);

  const label = from && to ? t("mapLabel", { from: from.label, to: to.label }) : t("mapTitle");

  return (
    <section className={`route-map${status === "failed" ? " is-fallback" : ""}`} aria-label={label}>
      {status !== "failed" && <div ref={el} className="route-map-canvas" />}
      {status === "loading" && <div className="route-map-loading skeleton" aria-hidden="true" />}
      {status === "failed" && (
        <div className="route-map-fallback">
          <div className="route-summary">
            <div><span>{from?.label ?? "—"}</span></div>
            <div><span>{to?.label ?? "—"}</span></div>
          </div>
          <p className="hint">{t("mapUnavailable")}</p>
        </div>
      )}
      {props.meta && status !== "failed" && <p className="route-map-meta">{props.meta}</p>}
    </section>
  );
}

function frame(m: google.maps.Map, pts: { lat: number; lng: number }[]) {
  if (pts.length === 1) {
    m.setCenter(pts[0]);
    m.setZoom(13);
  } else if (pts.length > 1) {
    const b = new window.google.maps.LatLngBounds();
    pts.forEach((p) => b.extend(p));
    // Kenar payı harita boyutuyla orantılı: dar haritada rota gereksiz küçülmesin, işaret etiketleri sığsın.
    const { clientWidth: w, clientHeight: h } = m.getDiv();
    const x = Math.round(Math.min(56, Math.max(24, w * 0.1)));
    const y = Math.round(Math.min(64, Math.max(28, h * 0.14)));
    m.fitBounds(b, { top: y + 24, right: x, bottom: y, left: x });
  }
}

/** HTML işaret: daire (alış) veya kare (varış) ve yanında etiket kapsülü. */
function pin(g: typeof google.maps, m: google.maps.Map, p: MapPoint, kind: "pickup" | "dropoff", prefix: string) {
  class Pin extends g.OverlayView {
    div: HTMLDivElement | null = null;
    onAdd() {
      const d = document.createElement("div");
      d.className = `route-pin ${kind}`;
      const dot = document.createElement("span");
      dot.className = "route-pin-dot";
      const chip = document.createElement("span");
      chip.className = "route-pin-chip";
      const pre = document.createElement("span");
      pre.className = "route-pin-pre";
      pre.textContent = prefix;
      const name = document.createElement("span");
      name.className = "route-pin-name";
      name.textContent = p.label;
      chip.append(pre, name);
      d.append(dot, chip);
      d.setAttribute("aria-hidden", "true");
      this.div = d;
      this.getPanes()?.overlayMouseTarget.appendChild(d);
    }
    draw() {
      const proj = this.getProjection();
      const at = new g.LatLng(p.lat, p.lng);
      const pos = proj?.fromLatLngToDivPixel(at);
      if (!pos || !this.div) return;
      this.div.style.left = `${pos.x}px`;
      this.div.style.top = `${pos.y}px`;
      // Nokta haritanın sağ yarısındaysa etiket sola açılır (kenardan taşmasın).
      const box = proj?.fromLatLngToContainerPixel(at);
      const width = m.getDiv().clientWidth;
      this.div.classList.toggle("flip", Boolean(box && width && box.x > width / 2));
    }
    onRemove() {
      this.div?.remove();
      this.div = null;
    }
  }
  const o = new Pin();
  o.setMap(m);
  return o;
}
