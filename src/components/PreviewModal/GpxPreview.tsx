import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";
import type { GpxFile } from "../../state/SessionContext";
import { palette } from "../../lib/colors";
import { getMapStyleUrl, getGpxLineColor, trackLineString } from "../MapPanel/mapTheme";
import { fileNameOf } from "./previewItems";
import styles from "./PreviewModal.module.css";

const FIT_OPTIONS = { padding: 60, maxZoom: 14 };

// First route uses the panel's own track color; the rest pick distinct hues
// so overlapping routes can be told apart.
export function routeColor(index: number): string {
  if (index === 0) return getGpxLineColor();
  const extras = [palette.info[3], palette.warning, palette.failure, palette.brandSecondary[3]];
  return extras[(index - 1) % extras.length];
}

function boundsOf(gpxFiles: GpxFile[]): mapboxgl.LngLatBounds | null {
  const bounds = new mapboxgl.LngLatBounds();
  let any = false;
  for (const gpx of gpxFiles) {
    for (const p of gpx.trackPoints ?? []) {
      bounds.extend([p.lng, p.lat]);
      any = true;
    }
  }
  return any ? bounds : null;
}

function addRouteLayers(map: mapboxgl.Map, gpxFiles: GpxFile[]) {
  gpxFiles.forEach((gpx, i) => {
    const id = `preview-gpx-${gpx.id}`;
    map.addSource(id, { type: "geojson", data: trackLineString(gpx.trackPoints ?? []) });
    map.addLayer({
      id,
      type: "line",
      source: id,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": routeColor(i), "line-width": 3, "line-opacity": 0.9 },
    });
  });
}

interface Props {
  gpxFiles: GpxFile[];
  mapboxToken: string | null;
}

/**
 * Large interactive map of the selected routes. The camera starts on the
 * routes' bounds so the first painted frame is already framed; the base map
 * pans and zooms with the usual mouse and trackpad gestures.
 */
export function GpxPreview({ gpxFiles, mapboxToken }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  // The parent remounts this component when the selection changes, so the
  // files are fixed for the life of the map.
  const gpxRef = useRef(gpxFiles);

  useEffect(() => {
    if (!mapboxToken || !containerRef.current) return;
    mapboxgl.accessToken = mapboxToken;
    const bounds = boundsOf(gpxRef.current);
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: getMapStyleUrl(),
      ...(bounds ? { bounds, fitBoundsOptions: FIT_OPTIONS } : { center: [0, 20], zoom: 1 }),
    });
    map.on("style.load", () => {
      addRouteLayers(map, gpxRef.current);
      setReady(true);
    });
    return () => {
      map.remove();
    };
  }, [mapboxToken]);

  return (
    <div className={styles.frame} data-testid="preview-frame">
      <div className={`${styles.stage} ${styles.mapStage}`}>
        {mapboxToken ? (
          <>
            <div ref={containerRef} className={styles.map} data-testid="gpx-preview-map" />
            {!ready && <div className={styles.mapLoading} aria-hidden />}
          </>
        ) : (
          <div className={styles.missing}>
            <span className="text-sm">A Mapbox API key is required to preview routes.</span>
          </div>
        )}
      </div>
      <div className={styles.caption}>
        {gpxFiles.map((gpx, i) => (
          <span key={gpx.id} className={styles.legendItem}>
            <span className={styles.swatch} style={{ background: routeColor(i) }} aria-hidden />
            <span className={styles.name}>{fileNameOf(gpx.filePath)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
