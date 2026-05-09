import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useRef, useEffect, useCallback, useState } from "react";
import { useSession } from "../../state/SessionContext";
import { useUI } from "../../state/UIContext";
import type { Photo, GpxFile } from "../../state/SessionContext";
import styles from "./MapPanel.module.css";

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
      "circle-color": "#007AFF",
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
    paint: { "text-color": "#ffffff" },
  });

  map.addLayer({
    id: "unclustered-point",
    type: "circle",
    source: "photos",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": "#007AFF",
      "circle-radius": 6,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#ffffff",
    },
  });
}

function getExistingGpxIds(map: mapboxgl.Map): string[] {
  const style = map.getStyle();
  if (!style?.sources) return [];
  return Object.keys(style.sources)
    .filter((k) => k.startsWith("gpx-"))
    .map((k) => k.replace("gpx-", ""));
}

function syncGpxLayers(map: mapboxgl.Map, gpxFiles: GpxFile[]) {
  const currentIds = new Set(gpxFiles.map((g) => g.id));
  for (const id of getExistingGpxIds(map)) {
    if (!currentIds.has(id)) {
      map.removeLayer(`gpx-line-${id}`);
      map.removeSource(`gpx-${id}`);
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
      map.addLayer({
        id: `gpx-line-${gpx.id}`,
        type: "line",
        source: sourceId,
        paint: {
          "line-color": "#FF9F0A",
          "line-width": 2,
          "line-opacity": 0.8,
        },
      });
    }
  }
}

export function MapPanel() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const { state: session } = useSession();
  const { state: ui, dispatch: uiDispatch } = useUI();
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    if (!ui.mapboxToken || !mapContainer.current || map.current) return;
    setMapError(null);
    mapboxgl.accessToken = ui.mapboxToken;
    try {
      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: "mapbox://styles/mapbox/dark-v11",
        zoom: 1,
        center: [0, 20],
      });
    } catch (err) {
      setMapError(err instanceof Error ? err.message : String(err));
      return;
    }
    map.current.on("load", () => {
      setupSources(map.current!);
    });
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [ui.mapboxToken]);

  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return;
    const source = map.current.getSource("photos") as mapboxgl.GeoJSONSource;
    if (!source) return;
    source.setData(buildPhotoGeoJSON(session.photos));
  }, [session.photos]);

  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return;
    syncGpxLayers(map.current, session.gpxFiles);
  }, [session.gpxFiles]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      const startY = e.clientY;
      const startHeight = ui.mapPanelHeight;
      const onMove = (ev: MouseEvent) => {
        const delta = startY - ev.clientY;
        uiDispatch({ type: "SET_MAP_PANEL_HEIGHT", height: startHeight + delta });
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [ui.mapPanelHeight, uiDispatch]
  );

  if (!ui.mapboxToken || mapError) {
    return (
      <div
        className={styles.panel}
        style={{ ["--panel-height" as string]: `${ui.mapPanelHeight}px` }}
      >
        <div className={styles.dragHandle} onMouseDown={handleDragStart} />
        <div className={styles.tokenPrompt}>
          {mapError
            ? `Map error: ${mapError}`
            : "Add a Mapbox token in Settings to enable the map."}
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.panel}
      style={{ ["--panel-height" as string]: `${ui.mapPanelHeight}px` }}
    >
      <div className={styles.dragHandle} onMouseDown={handleDragStart} />
      <div ref={mapContainer} className={styles.map} />
    </div>
  );
}
