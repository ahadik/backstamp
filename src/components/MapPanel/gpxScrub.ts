import type { Map as MapboxMap, GeoJSONSource, MapMouseEvent } from "mapbox-gl";
import {
  nearestPointOnTracks,
  formatSnapTime,
  type ScrubSnap,
} from "../../lib/trackScrub";
import type { GpxFile } from "../../state/SessionContext";
import { palette } from "../../lib/colors";
import styles from "./MapPanel.module.css";

/**
 * Map wiring for the GPX track scrubber: a snap indicator that slides along a
 * rendered track while the cursor is near it, with a time tooltip, and a click
 * that hands the snapped point to the owner. The geometry and planning logic
 * live in lib/trackScrub.ts.
 */

export const SCRUB_SOURCE_ID = "gpx-scrub";
export const SCRUB_LAYER_ID = "gpx-scrub-point";

/** How close (screen px) the cursor must be to a track for the indicator to show. */
const SNAP_RADIUS_PX = 20;

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Everything the handlers need, read through a ref so they never go stale. */
export interface ScrubDeps {
  enabled: boolean;
  gpxFiles: GpxFile[];
  onPick: (snap: ScrubSnap) => void;
}

/** Indicator source + layer; call from style.load like the other custom layers. */
export function setupScrubLayer(map: MapboxMap) {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  map.addSource(SCRUB_SOURCE_ID, { type: "geojson", data: EMPTY });
  map.addLayer({
    id: SCRUB_LAYER_ID,
    type: "circle",
    source: SCRUB_SOURCE_ID,
    paint: {
      // Same hue as the track line per theme; the white ring makes it read as a handle.
      "circle-color": dark ? palette.brandPrimary[1] : palette.brandPrimary[4],
      "circle-radius": 7,
      "circle-stroke-width": 2,
      "circle-stroke-color": palette.white,
    },
  });
}

/** Attach hover/click handlers and the tooltip; returns a detach function. */
export function attachGpxScrub(
  map: MapboxMap,
  depsRef: { readonly current: ScrubDeps }
): () => void {
  const tooltip = document.createElement("div");
  tooltip.className = styles.scrubTooltip;
  tooltip.style.display = "none";
  map.getContainer().appendChild(tooltip);

  let snap: ScrubSnap | null = null;
  let visible = false;
  let rafId: number | null = null;
  let lastPoint: { x: number; y: number } | null = null;

  function hide() {
    snap = null;
    if (!visible) return;
    visible = false;
    tooltip.style.display = "none";
    (map.getSource(SCRUB_SOURCE_ID) as GeoJSONSource | undefined)?.setData(EMPTY);
    map.getCanvas().style.cursor = "";
  }

  // The circle layer moves with the map for free; the DOM tooltip must follow.
  function placeTooltip() {
    if (!snap) return;
    const px = map.project([snap.lng, snap.lat]);
    tooltip.style.transform =
      `translate(${Math.round(px.x)}px, ${Math.round(px.y)}px) ` +
      "translate(-50%, -100%) translateY(-14px)";
  }

  function update(point: { x: number; y: number }) {
    const deps = depsRef.current;
    if (!deps.enabled || deps.gpxFiles.length === 0) return hide();

    const layerIds = deps.gpxFiles
      .map((g) => `gpx-line-${g.id}`)
      .filter((id) => map.getLayer(id));
    if (layerIds.length === 0) return hide();

    // Cheap early exit: only run the nearest-point math on tracks whose
    // rendered line actually passes near the cursor.
    const r = SNAP_RADIUS_PX;
    const features = map.queryRenderedFeatures(
      [
        [point.x - r, point.y - r],
        [point.x + r, point.y + r],
      ],
      { layers: layerIds }
    );
    if (features.length === 0) return hide();

    const nearIds = new Set(features.map((f) => f.layer!.id.replace(/^gpx-line-/, "")));
    const tracks = deps.gpxFiles
      .filter((g) => nearIds.has(g.id))
      .map((g) => ({ id: g.id, points: g.trackPoints }));
    const cursor = map.unproject([point.x, point.y]);
    const next = nearestPointOnTracks(tracks, { lng: cursor.lng, lat: cursor.lat });
    if (!next) return hide();

    // Uniform circular threshold in screen px, zoom-independent.
    const px = map.project([next.lng, next.lat]);
    const dx = px.x - point.x;
    const dy = px.y - point.y;
    if (dx * dx + dy * dy > SNAP_RADIUS_PX * SNAP_RADIUS_PX) return hide();

    snap = next;
    visible = true;
    (map.getSource(SCRUB_SOURCE_ID) as GeoJSONSource | undefined)?.setData({
      type: "Feature",
      geometry: { type: "Point", coordinates: [next.lng, next.lat] },
      properties: {},
    });
    const gpx = deps.gpxFiles.find((g) => g.id === next.gpxId);
    tooltip.textContent =
      next.timestampUtcSecs != null
        ? formatSnapTime(next.timestampUtcSecs, gpx?.timezone ?? null)
        : "Location only";
    tooltip.style.display = "";
    placeTooltip();
    map.getCanvas().style.cursor = "pointer";
  }

  const onMouseMove = (e: MapMouseEvent) => {
    lastPoint = e.point;
    if (rafId == null) {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (lastPoint) update(lastPoint);
      });
    }
  };
  const onMouseOut = () => {
    lastPoint = null;
    hide();
  };
  const onMove = () => placeTooltip();
  const onClick = () => {
    if (snap && depsRef.current.enabled) depsRef.current.onPick(snap);
  };

  map.on("mousemove", onMouseMove);
  map.on("mouseout", onMouseOut);
  map.on("move", onMove);
  map.on("click", onClick);

  return () => {
    map.off("mousemove", onMouseMove);
    map.off("mouseout", onMouseOut);
    map.off("move", onMove);
    map.off("click", onClick);
    if (rafId != null) cancelAnimationFrame(rafId);
    tooltip.remove();
  };
}
