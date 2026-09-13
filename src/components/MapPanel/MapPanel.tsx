import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useRef, useEffect, useCallback, useState } from "react";
import { useSession } from "../../state/SessionContext";
import { useUI } from "../../state/UIContext";
import type { Photo, GpxFile, Metadata } from "../../state/SessionContext";
import styles from "./MapPanel.module.css";
import { palette, colors } from "../../lib/colors";
import { planScrubApply, scrubConfirmMessage } from "../../lib/trackScrub";
import type { ScrubSnap, ScrubPlan } from "../../lib/trackScrub";
import { attachGpxScrub, setupScrubLayer, type ScrubDeps } from "./gpxScrub";
import { ConfirmDialog } from "../common/ConfirmDialog/ConfirmDialog";
import { tauriCommands } from "../../lib/tauri";
import { reportError } from "../../lib/errors";

// Contiguous US bounds: west, south, east, north
const US_BOUNDS: [number, number, number, number] = [-125, 24, -66, 50];

// Zoomed-out globe view used on first load and after the session is cleared.
const GLOBE_VIEW: { center: [number, number]; zoom: number } = {
  center: [0, 20],
  zoom: 1,
};

// Mapbox's light/dark styles are monotone by design; pick to match the OS theme.
function getMapStyleUrl(): string {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "mapbox://styles/mapbox/dark-v11"
    : "mapbox://styles/mapbox/light-v11";
}

// GPX traces use brand-primary; shade flips so the line stays legible on each base map.
function getGpxLineColor(): string {
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? palette.brandPrimary[1]
    : palette.brandPrimary[4];
}

function fitToPhotos(map: mapboxgl.Map, photos: Photo[]) {
  const withCoords = photos.filter(
    (p) => p.currentMetadata.gpsLat != null && p.currentMetadata.gpsLng != null
  );

  if (withCoords.length === 0) {
    map.fitBounds(US_BOUNDS, { padding: 20, animate: true });
    return;
  }

  if (withCoords.length === 1) {
    map.flyTo({
      center: [withCoords[0].currentMetadata.gpsLng!, withCoords[0].currentMetadata.gpsLat!],
      zoom: 10,
    });
    return;
  }

  const bounds = new mapboxgl.LngLatBounds();
  for (const p of withCoords) {
    bounds.extend([p.currentMetadata.gpsLng!, p.currentMetadata.gpsLat!]);
  }
  map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
}

export function buildPhotoGeoJSON(photos: Photo[]): GeoJSON.FeatureCollection {
  const features = photos
    .filter((p) => p.currentMetadata.gpsLat != null && p.currentMetadata.gpsLng != null)
    .map((p) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [p.currentMetadata.gpsLng!, p.currentMetadata.gpsLat!],
      },
      properties: { id: p.id },
    }));
  return { type: "FeatureCollection", features };
}

function fitToGpxTrack(map: mapboxgl.Map, gpx: GpxFile) {
  const pts = gpx.trackPoints ?? [];
  if (pts.length === 0) return;
  const bounds = new mapboxgl.LngLatBounds();
  for (const p of pts) bounds.extend([p.lng, p.lat]);
  map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
}

// Grayscale terrain relief so mountains and coastlines read on the flat
// monotone base styles. Colors come from the neutral ramp per theme.
function setupHillshade(map: mapboxgl.Map) {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  map.addSource("mapbox-dem", {
    type: "raster-dem",
    url: "mapbox://mapbox.mapbox-terrain-dem-v1",
    tileSize: 512,
    maxzoom: 14,
  });
  // Slot the relief beneath water/roads/labels; light-v11 and dark-v11 both
  // have these layers, but fall back gracefully if a style rename drops one.
  const beforeId = ["land-structure-polygon", "waterway", "water"].find((id) =>
    map.getLayer(id)
  );
  map.addLayer(
    {
      id: "hillshade",
      type: "hillshade",
      source: "mapbox-dem",
      paint: {
        "hillshade-exaggeration": dark ? 0.4 : 0.25,
        "hillshade-shadow-color": dark ? palette.surfaceNeutral[7] : palette.surfaceNeutral[4],
        "hillshade-highlight-color": dark ? palette.surfaceNeutral[6] : palette.white,
      },
    },
    beforeId
  );
}

function setupSources(map: mapboxgl.Map) {
  map.addSource("photos", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 50,
  });

  map.addLayer({
    id: "clusters",
    type: "circle",
    source: "photos",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": colors.accent,
      "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 30, 28],
      "circle-opacity": 0.85,
    },
  });

  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "photos",
    filter: ["has", "point_count"],
    layout: {
      "text-field": "{point_count_abbreviated}",
      "text-size": 12,
      "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
    },
    paint: { "text-color": palette.white },
  });

  map.addLayer({
    id: "unclustered-point",
    type: "circle",
    source: "photos",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": colors.accent,
      "circle-radius": 6,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": palette.white,
    },
  });
}

function syncGpxLayers(map: mapboxgl.Map, gpxFiles: GpxFile[], trackedIds: Set<string>) {
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
    const coords = (gpx.trackPoints ?? []).map((p) => [p.lng, p.lat]);
    const geojson: GeoJSON.Feature = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: coords },
      properties: {},
    };
    if (map.getSource(sourceId)) {
      (map.getSource(sourceId) as mapboxgl.GeoJSONSource).setData(geojson);
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

// Scrub edits differ per photo (timezones vary); persist in groups of
// identical payloads so the common case stays a single backend call.
function persistScrubUpdates(updates: Array<{ id: string; changes: Partial<Metadata> }>) {
  const groups = new Map<string, { ids: string[]; changes: Partial<Metadata> }>();
  for (const u of updates) {
    const key = JSON.stringify(u.changes);
    const group = groups.get(key);
    if (group) group.ids.push(u.id);
    else groups.set(key, { ids: [u.id], changes: u.changes });
  }
  for (const group of groups.values()) {
    const fields = Object.entries(group.changes).map(([field, value]) => ({
      field,
      value: value == null ? null : String(value),
    }));
    tauriCommands
      .setPendingChanges(group.ids, fields)
      .catch((err) => reportError("Failed to save track point edits", err));
  }
}

interface MapPanelProps {
  onOpenSettings: () => void;
}

function isSecretMapboxToken(token: string | null): boolean {
  return !!token && /^sk\./i.test(token.trim());
}

export function MapPanel({ onOpenSettings }: MapPanelProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const { state: session, dispatch: sessionDispatch } = useSession();
  const { state: ui, dispatch: uiDispatch } = useUI();
  const [mapError, setMapError] = useState<string | null>(null);
  const [resizing, setResizing] = useState(false);
  const [scrubConfirm, setScrubConfirm] = useState<ScrubPlan | null>(null);
  const isResizingRef = useRef(false);
  const failedTokenRef = useRef<string | null>(null);
  const gpxLayerIds = useRef(new Set<string>());
  const hadDataRef = useRef(false);
  // Scrub clicks change selected photos' coordinates, which would trigger the
  // re-fit effect and yank the camera mid-hover; a short window suppresses it.
  const suppressFitUntilRef = useRef(0);

  const tokenIsSecret = isSecretMapboxToken(ui.mapboxToken);

  const hasSelection = session.selectedIds.size > 0;
  const focusPhotos = hasSelection
    ? session.photos.filter((p) => session.selectedIds.has(p.id))
    : session.photos;

  // Stable key that changes only when the set of pins to fit actually changes
  const fitKey =
    (hasSelection ? [...session.selectedIds].sort().join(",") : "*") +
    "|" +
    focusPhotos
      .filter((p) => p.currentMetadata.gpsLat != null)
      .map((p) => `${p.id}:${p.currentMetadata.gpsLat},${p.currentMetadata.gpsLng}`)
      .join("|");

  // Refs so the async "load" handler sees current data without stale closures
  const focusPhotosRef = useRef<Photo[]>(focusPhotos);
  focusPhotosRef.current = focusPhotos;
  const allPhotosRef = useRef<Photo[]>(session.photos);
  allPhotosRef.current = session.photos;
  const gpxFilesRef = useRef<GpxFile[]>(session.gpxFiles);
  gpxFilesRef.current = session.gpxFiles;

  const applyScrub = (updates: ScrubPlan["updates"]) => {
    suppressFitUntilRef.current = Date.now() + 1000;
    sessionDispatch({ type: "SET_PENDING_BATCH", updates });
    persistScrubUpdates(updates);
  };

  const handleScrubPick = (snap: ScrubSnap) => {
    const selected = session.photos.filter((p) => session.selectedIds.has(p.id));
    if (selected.length === 0) return;
    const gpx = session.gpxFiles.find((g) => g.id === snap.gpxId);
    const plan = planScrubApply(selected, snap, gpx?.timezone ?? null);
    if (plan.confirm) setScrubConfirm(plan);
    else applyScrub(plan.updates);
  };

  // Handlers attach once at map creation and read these through the ref, so
  // they always see the current selection and GPX files.
  const scrubDepsRef = useRef<ScrubDeps>({ enabled: false, gpxFiles: [], onPick: () => {} });
  scrubDepsRef.current = {
    enabled: hasSelection,
    gpxFiles: session.gpxFiles,
    onPick: handleScrubPick,
  };

  useEffect(() => {
    if (!ui.mapboxToken || tokenIsSecret) return;
    // If there's a stale error from a previous (bad) token, clear it so the map
    // container re-renders. The effect will fire again once mapError becomes null.
    if (mapError) {
      if (ui.mapboxToken !== failedTokenRef.current) setMapError(null);
      return;
    }
    if (!mapContainer.current || map.current) return;
    mapboxgl.accessToken = ui.mapboxToken;
    try {
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: getMapStyleUrl(),
        zoom: GLOBE_VIEW.zoom,
        center: GLOBE_VIEW.center,
      });
    } catch (err) {
      failedTokenRef.current = ui.mapboxToken;
      setMapError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (import.meta.env.DEV) {
      // Handle for driving the map from automation during development.
      (window as unknown as Record<string, unknown>).__backstampMap = map.current;
    }
    // Resize canvas whenever the container changes size, but not during drag
    // (the map re-renders once on mouseup instead of on every pixel of drag)
    const ro = new ResizeObserver(() => {
      if (!isResizingRef.current) map.current?.resize();
    });
    ro.observe(mapContainer.current);

    const detachScrub = attachGpxScrub(map.current, scrubDepsRef);

    // style.load fires on initial style load AND after every setStyle, so it's
    // the right place to (re-)attach custom sources and layers — switching themes
    // wipes everything added by setupSources/syncGpxLayers.
    let didInitialFit = false;
    map.current.on("style.load", () => {
      map.current!.resize();
      setupHillshade(map.current!);
      setupSources(map.current!);
      setupScrubLayer(map.current!);
      (map.current!.getSource("photos") as mapboxgl.GeoJSONSource).setData(
        buildPhotoGeoJSON(allPhotosRef.current)
      );
      // setStyle removed the old gpx layers; reset the tracking set so syncGpxLayers re-adds them.
      gpxLayerIds.current.clear();
      syncGpxLayers(map.current!, gpxFilesRef.current, gpxLayerIds.current);
      if (!didInitialFit) {
        fitToPhotos(map.current!, focusPhotosRef.current);
        didInitialFit = true;
      }
    });

    // Swap the base style when the OS color scheme flips.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onSchemeChange = () => map.current?.setStyle(getMapStyleUrl());
    mq.addEventListener("change", onSchemeChange);

    return () => {
      mq.removeEventListener("change", onSchemeChange);
      ro.disconnect();
      detachScrub();
      map.current?.remove();
      map.current = null;
      gpxLayerIds.current.clear();
    };
  // mapError in deps so the effect re-runs after we clear a stale error
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.mapboxToken, mapError]);

  // Re-fit whenever selection or pin coordinates change, but only while something is selected
  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return;
    if (!hasSelection) return;
    if (Date.now() < suppressFitUntilRef.current) return;
    const hasCoords = focusPhotos.some(
      (p) => p.currentMetadata.gpsLat != null && p.currentMetadata.gpsLng != null
    );
    if (!hasCoords) return;
    fitToPhotos(map.current, focusPhotos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  // isStyleLoaded() is false whenever the map is mid-render (e.g. tiles still
  // streaming after a pan/zoom), not just before the initial style load. These
  // sync effects only re-run when session data changes, so a dropped sync would
  // never be retried — defer to the next "idle" instead of bailing. The deferred
  // callbacks read from refs so they always sync the latest data.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const sync = () => {
      const source = m.getSource("photos") as mapboxgl.GeoJSONSource | undefined;
      if (source) source.setData(buildPhotoGeoJSON(allPhotosRef.current));
    };
    if (m.isStyleLoaded()) sync();
    else m.once("idle", sync);
  }, [session.photos]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const sync = () => syncGpxLayers(m, gpxFilesRef.current, gpxLayerIds.current);
    if (m.isStyleLoaded()) sync();
    else m.once("idle", sync);
  }, [session.gpxFiles]);

  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return;
    if (!session.selectedGpxId) return;
    const gpx = session.gpxFiles.find((g) => g.id === session.selectedGpxId);
    if (gpx) fitToGpxTrack(map.current, gpx);
  }, [session.selectedGpxId, session.gpxFiles]);

  // Reset to the globe view when the session is cleared (data → empty transition).
  useEffect(() => {
    const hasData = session.photos.length > 0 || session.gpxFiles.length > 0;
    const wasCleared = hadDataRef.current && !hasData;
    hadDataRef.current = hasData;
    const m = map.current;
    if (!wasCleared || !m) return;
    const flyHome = () => m.flyTo({ center: GLOBE_VIEW.center, zoom: GLOBE_VIEW.zoom });
    if (m.isStyleLoaded()) flyHome();
    else m.once("idle", flyHome);
  }, [session.photos.length, session.gpxFiles.length]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      isResizingRef.current = true;
      setResizing(true);
      const startY = e.clientY;
      const startHeight = ui.mapPanelHeight;
      const onMove = (ev: MouseEvent) => {
        const delta = startY - ev.clientY;
        uiDispatch({ type: "SET_MAP_PANEL_HEIGHT", height: startHeight + delta });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        isResizingRef.current = false;
        setResizing(false);
        map.current?.resize();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [ui.mapPanelHeight, uiDispatch]
  );

  if (!ui.mapboxToken || mapError || tokenIsSecret) {
    return (
      <div
        className={styles.panel}
        style={{ ["--panel-height" as string]: `${ui.mapPanelHeight}px` }}
      >
        <div className={styles.tokenPrompt}>
          <p>
            {tokenIsSecret
              ? "The saved Mapbox token is a secret token (sk.…). The map needs a public token that starts with pk.… — create one in your Mapbox account dashboard."
              : mapError
                ? `Map error: ${mapError}`
                : "A Mapbox API key is required to enable the map."}
          </p>
          <button className="btn btn-low btn-secondary" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
        <div className={styles.resizeZone} onMouseDown={handleDragStart} />
      </div>
    );
  }

  return (
    <div
      className={styles.panel}
      style={{ ["--panel-height" as string]: `${ui.mapPanelHeight}px` }}
    >
      <div ref={mapContainer} className={styles.map} />
      {resizing && <div className={styles.resizeOverlay} />}
      <div className={styles.resizeZone} onMouseDown={handleDragStart} />
      {scrubConfirm?.confirm && (
        <ConfirmDialog
          title="Set from GPX Track"
          message={scrubConfirmMessage(scrubConfirm.confirm)}
          confirmLabel="Set"
          onConfirm={() => {
            applyScrub(scrubConfirm.updates);
            setScrubConfirm(null);
          }}
          onCancel={() => setScrubConfirm(null)}
        />
      )}
    </div>
  );
}
