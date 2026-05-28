import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useRef, useEffect, useCallback, useState } from "react";
import { useSession } from "../../state/SessionContext";
import { useUI } from "../../state/UIContext";
import type { Photo, GpxFile } from "../../state/SessionContext";
import styles from "./MapPanel.module.css";
import { palette, colors } from "../../lib/colors";

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

interface MapPanelProps {
  onOpenSettings: () => void;
}

function isSecretMapboxToken(token: string | null): boolean {
  return !!token && /^sk\./i.test(token.trim());
}

export function MapPanel({ onOpenSettings }: MapPanelProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const { state: session } = useSession();
  const { state: ui, dispatch: uiDispatch } = useUI();
  const [mapError, setMapError] = useState<string | null>(null);
  const [resizing, setResizing] = useState(false);
  const isResizingRef = useRef(false);
  const failedTokenRef = useRef<string | null>(null);
  const gpxLayerIds = useRef(new Set<string>());
  const hadDataRef = useRef(false);

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
    // Resize canvas whenever the container changes size, but not during drag
    // (the map re-renders once on mouseup instead of on every pixel of drag)
    const ro = new ResizeObserver(() => {
      if (!isResizingRef.current) map.current?.resize();
    });
    ro.observe(mapContainer.current);

    // style.load fires on initial style load AND after every setStyle, so it's
    // the right place to (re-)attach custom sources and layers — switching themes
    // wipes everything added by setupSources/syncGpxLayers.
    let didInitialFit = false;
    map.current.on("style.load", () => {
      map.current!.resize();
      setupSources(map.current!);
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
    const hasCoords = focusPhotos.some(
      (p) => p.currentMetadata.gpsLat != null && p.currentMetadata.gpsLng != null
    );
    if (!hasCoords) return;
    fitToPhotos(map.current, focusPhotos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return;
    const source = map.current.getSource("photos") as mapboxgl.GeoJSONSource;
    if (!source) return;
    source.setData(buildPhotoGeoJSON(session.photos));
  }, [session.photos]);

  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return;
    syncGpxLayers(map.current, session.gpxFiles, gpxLayerIds.current);
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
    if (wasCleared && map.current?.isStyleLoaded()) {
      map.current.flyTo({ center: GLOBE_VIEW.center, zoom: GLOBE_VIEW.zoom });
    }
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
    </div>
  );
}
