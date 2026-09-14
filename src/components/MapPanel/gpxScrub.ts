import type { Map as MapboxMap, GeoJSONSource, MapMouseEvent } from "mapbox-gl";
import {
  nearestPointOnTracks,
  formatSnapTime,
  type ScrubSnap,
} from "../../lib/trackScrub";
import type { GpxFile } from "../../state/SessionContext";
import { palette } from "../../lib/colors";
import { getGpxLineColor, trackLineString } from "./mapTheme";
import styles from "./MapPanel.module.css";

/**
 * Map wiring for the location picker: while photos are selected, a small
 * drop indicator follows the cursor anywhere on the map, and near a rendered
 * GPX track it snaps onto the line and grows, with a time tooltip. A click
 * hands the picked point (snapped or free) to the owner. The geometry and
 * planning logic live in lib/trackScrub.ts.
 */

export const SCRUB_SOURCE_ID = "gpx-scrub";
export const SCRUB_LAYER_ID = "gpx-scrub-point";

/** How close (screen px) the cursor must be to a track for the snap to engage. */
const SNAP_RADIUS_PX = 20;

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** Everything the handlers need, read through a ref so they never go stale. */
export interface ScrubDeps {
  enabled: boolean;
  gpxFiles: GpxFile[];
  onPick: (snap: ScrubSnap) => void;
}

/** Add or update one line source+layer per GPX file; remove layers for files gone. */
export function syncGpxLayers(map: MapboxMap, gpxFiles: GpxFile[], trackedIds: Set<string>) {
  const currentIds = new Set(gpxFiles.map((g) => g.id));
  for (const id of [...trackedIds]) {
    if (!currentIds.has(id)) {
      if (map.getLayer(`gpx-line-${id}`)) map.removeLayer(`gpx-line-${id}`);
      if (map.getSource(`gpx-${id}`)) map.removeSource(`gpx-${id}`);
      trackedIds.delete(id);
    }
  }
  for (const gpx of gpxFiles) {
    const sourceId = `gpx-${gpx.id}`;
    const geojson = trackLineString(gpx.trackPoints ?? []);

    if (map.getSource(sourceId)) {
      (map.getSource(sourceId) as GeoJSONSource).setData(geojson);
    } else {
      map.addSource(sourceId, { type: "geojson", data: geojson });
      const beforeId = map.getLayer("clusters") ? "clusters" : undefined;
      map.addLayer(
        {
          id: `gpx-line-${gpx.id}`,
          type: "line",
          source: sourceId,
          paint: {
            "line-color": getGpxLineColor(),
            "line-width": 2,
            "line-opacity": 0.8,
          },
        },
        beforeId,
      );
      trackedIds.add(gpx.id);
    }
  }
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
      // Same hue as the track line per theme; the white ring makes it read as
      // a handle. The free-drop indicator is a smaller version of the same dot.
      "circle-color": dark ? palette.brandPrimary[1] : palette.brandPrimary[4],
      "circle-radius": ["case", ["boolean", ["get", "snapped"], false], 7, 4],
      "circle-stroke-width": ["case", ["boolean", ["get", "snapped"], false], 2, 1.5],
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
    if (!snap || tooltip.style.display === "none") return;
    const px = map.project([snap.lng, snap.lat]);
    tooltip.style.transform =
      `translate(${Math.round(px.x)}px, ${Math.round(px.y)}px) ` +
      "translate(-50%, -100%) translateY(-14px)";
  }

  /** Nearest track snap within SNAP_RADIUS_PX of the cursor, or null. */
  function trySnap(point: { x: number; y: number }, gpxFiles: GpxFile[]): ScrubSnap | null {
    const layerIds = gpxFiles
      .map((g) => `gpx-line-${g.id}`)
      .filter((id) => map.getLayer(id));
    if (layerIds.length === 0) return null;

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
    if (features.length === 0) return null;

    const nearIds = new Set(features.map((f) => f.layer!.id.replace(/^gpx-line-/, "")));
    const tracks = gpxFiles
      .filter((g) => nearIds.has(g.id))
      .map((g) => ({ id: g.id, points: g.trackPoints }));
    const cursor = map.unproject([point.x, point.y]);
    const next = nearestPointOnTracks(tracks, { lng: cursor.lng, lat: cursor.lat });
    if (!next) return null;

    // Uniform circular threshold in screen px, zoom-independent.
    const px = map.project([next.lng, next.lat]);
    const dx = px.x - point.x;
    const dy = px.y - point.y;
    return dx * dx + dy * dy <= SNAP_RADIUS_PX * SNAP_RADIUS_PX ? next : null;
  }

  function update(point: { x: number; y: number }) {
    const deps = depsRef.current;
    if (!deps.enabled) return hide();

    let next = trySnap(point, deps.gpxFiles);
    if (!next) {
      // Free drop: the indicator sits exactly under the cursor.
      const cursor = map.unproject([point.x, point.y]);
      next = { gpxId: null, lat: cursor.lat, lng: cursor.lng, timestampUtcSecs: null };
    }

    snap = next;
    visible = true;
    (map.getSource(SCRUB_SOURCE_ID) as GeoJSONSource | undefined)?.setData({
      type: "Feature",
      geometry: { type: "Point", coordinates: [next.lng, next.lat] },
      properties: { snapped: next.gpxId != null },
    });
    if (next.gpxId != null) {
      const gpx = deps.gpxFiles.find((g) => g.id === next.gpxId);
      tooltip.textContent =
        next.timestampUtcSecs != null
          ? formatSnapTime(next.timestampUtcSecs, gpx?.timezone ?? null)
          : "Location only";
      tooltip.style.display = "";
      placeTooltip();
      map.getCanvas().style.cursor = "pointer";
    } else {
      tooltip.style.display = "none";
      map.getCanvas().style.cursor = "crosshair";
    }
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
