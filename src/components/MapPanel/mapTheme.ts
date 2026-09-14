import { palette } from "../../lib/colors";

function prefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

// Mapbox's light/dark styles are monotone by design; pick to match the OS theme.
export function getMapStyleUrl(): string {
  return prefersDark() ? "mapbox://styles/mapbox/dark-v11" : "mapbox://styles/mapbox/light-v11";
}

// GPX traces use brand-primary; shade flips so the line stays legible on each base map.
export function getGpxLineColor(): string {
  return prefersDark() ? palette.brandPrimary[1] : palette.brandPrimary[4];
}

/** GeoJSON LineString for a track's points, in Mapbox [lng, lat] order. */
export function trackLineString(
  trackPoints: Array<{ lat: number; lng: number }>
): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates: trackPoints.map((p) => [p.lng, p.lat]) },
    properties: {},
  };
}
