import { useState, useEffect, useRef, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import { useSession } from "../../../state/SessionContext";
import { useUI } from "../../../state/UIContext";
import { deriveFieldValue } from "../../../lib/inspectorUtils";
import { tauriCommands } from "../../../lib/tauri";
import { wallClockToUtcSecs, countMatches, applyGpxAutoTag } from "../../../lib/gpxMatching";
import { ConfirmDialog } from "../../common/ConfirmDialog/ConfirmDialog";
import type { Photo } from "../../../state/SessionContext";
import type { TrackPoint } from "../../../lib/tauri";
import styles from "./LocationSection.module.css";

const DEBOUNCE_MS = 300;

interface GeocodingFeature {
  properties: { full_address: string };
  geometry: { coordinates: [number, number] };
}

interface LocationSectionProps {
  selectedPhotos: Photo[];
  onOpenSettings: () => void;
}

export function LocationSection({ selectedPhotos, onOpenSettings }: LocationSectionProps) {
  const { state: session, dispatch } = useSession();
  const { state: uiState } = useUI();
  const mapboxToken = uiState.mapboxToken;

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const multiMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodingFeature[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [resolvedTz, setResolvedTz] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [gpxLocateDialog, setGpxLocateDialog] = useState<{
    matchCount: number;
    totalCount: number;
    allPoints: TrackPoint[];
  } | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const dispatchCoordsRef = useRef<(lat: number, lng: number) => void>(null!);

  const selectedIds = selectedPhotos.map((p) => p.id);
  const selectedIdsKey = selectedIds.join(",");
  const gpsLat = deriveFieldValue(selectedPhotos, (m) => m.gpsLat);
  const gpsLng = deriveFieldValue(selectedPhotos, (m) => m.gpsLng);
  const timezone = deriveFieldValue(selectedPhotos, (m) => m.timezone);

  const allTrackPoints = session.gpxFiles.flatMap((g) => g.trackPoints);
  const timezones = new Set(
    selectedPhotos
      .map((p) => p.currentMetadata.timezone)
      .filter((tz): tz is string => tz != null)
  );
  const gpxBoundsMin = allTrackPoints.length > 0 ? Math.min(...allTrackPoints.map((p) => p.timestamp)) : null;
  const gpxBoundsMax = allTrackPoints.length > 0 ? Math.max(...allTrackPoints.map((p) => p.timestamp)) : null;
  const anyPhotoOverlapsGpx =
    gpxBoundsMin !== null &&
    gpxBoundsMax !== null &&
    selectedPhotos.some((photo) => {
      const { captureDate, captureTime, timezone } = photo.currentMetadata;
      if (!captureDate || !captureTime || !timezone) return false;
      const utcSecs = wallClockToUtcSecs(captureDate, captureTime, timezone);
      return utcSecs >= gpxBoundsMin && utcSecs <= gpxBoundsMax;
    });

  const gpxButtonEnabled =
    anyPhotoOverlapsGpx &&
    timezones.size === 1 &&
    selectedPhotos.every((p) => p.currentMetadata.timezone != null);

  const hasCoords =
    gpsLat !== null &&
    gpsLat !== "multiple" &&
    gpsLng !== null &&
    gpsLng !== "multiple";
  const multipleCoords = gpsLat === "multiple" || gpsLng === "multiple";
  const isEmpty = selectedPhotos.length === 0;
  const showMap = !isEmpty;

  function dispatchCoords(lat: number, lng: number) {
    dispatch({
      type: "SET_PENDING",
      ids: selectedIds,
      changes: { gpsLat: lat, gpsLng: lng },
    });
    tauriCommands.resolveTimezone(lat, lng).then(setResolvedTz).catch(console.error);
  }
  dispatchCoordsRef.current = dispatchCoords;

  // Reset search state when selection changes
  useEffect(() => {
    setSearchQuery("");
    setSuggestions([]);
    setSuggestionsOpen(false);
    setResolvedTz(null);
  }, [selectedIdsKey]);

  // Initialise map when photos are selected
  useEffect(() => {
    if (!mapboxToken || !showMap || !mapContainerRef.current || mapRef.current) return;

    setMapError(null);
    mapboxgl.accessToken = mapboxToken;
    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        zoom: hasCoords ? 12 : 1,
        center: hasCoords ? [gpsLng as number, gpsLat as number] : [0, 20],
      });
    } catch (err) {
      setMapError(err instanceof Error ? err.message : String(err));
      return;
    }
    mapRef.current = map;

    // Clicking anywhere places/moves the single pin and snaps all selected photos
    map.on("click", (e) => {
      const { lat, lng } = e.lngLat;
      dispatchCoordsRef.current(lat, lng);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      multiMarkersRef.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapboxToken, showMap]);

  // Sync markers whenever coords or selection changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (multipleCoords) {
      // Multi-pin mode: one non-draggable pin per photo that has coords
      markerRef.current?.remove();
      markerRef.current = null;

      const selectedPhotoIds = new Set(selectedPhotos.map((p) => p.id));
      for (const [id, marker] of multiMarkersRef.current) {
        if (!selectedPhotoIds.has(id)) {
          marker.remove();
          multiMarkersRef.current.delete(id);
        }
      }

      const bounds = new mapboxgl.LngLatBounds();
      let hasAnyCoords = false;

      for (const photo of selectedPhotos) {
        const { gpsLat: lat, gpsLng: lng } = photo.currentMetadata;
        if (lat == null || lng == null) {
          multiMarkersRef.current.get(photo.id)?.remove();
          multiMarkersRef.current.delete(photo.id);
          continue;
        }
        if (multiMarkersRef.current.has(photo.id)) {
          multiMarkersRef.current.get(photo.id)!.setLngLat([lng, lat]);
        } else {
          const marker = new mapboxgl.Marker({ color: "#007AFF" })
            .setLngLat([lng, lat])
            .addTo(map);
          multiMarkersRef.current.set(photo.id, marker);
        }
        bounds.extend([lng, lat]);
        hasAnyCoords = true;
      }

      if (hasAnyCoords) {
        map.fitBounds(bounds, { padding: 40, maxZoom: 14 });
      }
    } else {
      // Single-pin mode: one draggable marker
      for (const marker of multiMarkersRef.current.values()) marker.remove();
      multiMarkersRef.current.clear();

      if (!hasCoords) {
        markerRef.current?.remove();
        markerRef.current = null;
        return;
      }

      const lat = gpsLat as number;
      const lng = gpsLng as number;
      if (markerRef.current) {
        markerRef.current.setLngLat([lng, lat]);
      } else {
        const marker = new mapboxgl.Marker({ draggable: true })
          .setLngLat([lng, lat])
          .addTo(map);
        marker.on("dragend", () => {
          const pos = marker.getLngLat();
          dispatchCoordsRef.current(pos.lat, pos.lng);
        });
        markerRef.current = marker;
      }
      map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 10) });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsLat, gpsLng, multipleCoords, selectedIdsKey]);

  const fetchSuggestions = useCallback(
    async (query: string) => {
      if (!query.trim() || !mapboxToken) {
        setSuggestions([]);
        return;
      }
      try {
        const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
        url.searchParams.set("q", query);
        url.searchParams.set("access_token", mapboxToken);
        url.searchParams.set("limit", "5");
        url.searchParams.set("autocomplete", "true");
        const resp = await fetch(url.toString());
        const data = await resp.json();
        setSuggestions(data.features ?? []);
        setSuggestionsOpen(true);
      } catch {
        setSuggestions([]);
      }
    },
    [mapboxToken]
  );

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setSearchQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(q), DEBOUNCE_MS);
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && suggestions.length > 0) {
      handleSuggestionSelect(suggestions[0]);
    }
  }

  function handleSuggestionSelect(feature: GeocodingFeature) {
    setSuggestionsOpen(false);
    setSearchQuery(feature.properties.full_address);
    const [lng, lat] = feature.geometry.coordinates;
    dispatchCoords(lat, lng);
  }

  // Close suggestions on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSuggestionsOpen(false);
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, []);

  const tzMismatch =
    resolvedTz &&
    timezone &&
    timezone !== "multiple" &&
    resolvedTz !== timezone;

  if (!mapboxToken || mapError) {
    return (
      <div className={styles.section}>
        <div className="section-label">Location</div>
        <div className={`inspector-card ${styles.card}`}>
          <p className={styles.noKey}>
            {mapError
              ? "Invalid Mapbox token — use a public token (pk.*) in Settings."
              : "A Mapbox API key is required for location features."}
          </p>
          <button className="btn btn-primary" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.section}>
      <div className="section-label">Location</div>
      <div className={`inspector-card ${styles.card}`}>
        {isEmpty ? (
          <p className={styles.empty}>No photos selected</p>
        ) : (
          <>
            <div ref={searchRef} className={styles.searchWrapper}>
              <input
                type="text"
                className={`input ${styles.searchInput}`}
                placeholder="Search location…"
                value={searchQuery}
                onChange={handleSearchChange}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => suggestions.length > 0 && setSuggestionsOpen(true)}
              />
              {suggestionsOpen && suggestions.length > 0 && (
                <div className={styles.suggestions}>
                  {suggestions.map((f, i) => (
                    <button
                      key={i}
                      className={styles.suggestion}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        handleSuggestionSelect(f);
                      }}
                    >
                      {f.properties.full_address}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div ref={mapContainerRef} className={styles.map} />

            {multipleCoords ? (
              <p className={styles.coords}>Multiple locations — click map or search to set one</p>
            ) : (
              <p className={styles.coords}>
                {hasCoords
                  ? `${(gpsLat as number).toFixed(4)}°${(gpsLat as number) >= 0 ? "N" : "S"} ${Math.abs(gpsLng as number).toFixed(4)}°${(gpsLng as number) >= 0 ? "E" : "W"}`
                  : "Not set"}
              </p>
            )}

            {tzMismatch && (
              <p className={styles.tzWarning}>
                ⚠ Location suggests <strong>{resolvedTz}</strong> but timezone is set to{" "}
                <strong>{timezone as string}</strong>.
              </p>
            )}

            {anyPhotoOverlapsGpx && (
              <div className={styles.gpxLocate}>
                <button
                  className="btn btn-secondary"
                  disabled={!gpxButtonEnabled}
                  title={
                    !gpxButtonEnabled
                      ? "All selected photos must have the same timezone set"
                      : undefined
                  }
                  onClick={() => {
                    const { matching, total } = countMatches(selectedPhotos, allTrackPoints);
                    setGpxLocateDialog({ matchCount: matching, totalCount: total, allPoints: allTrackPoints });
                  }}
                >
                  Locate Photos on GPX
                </button>
              </div>
            )}

            {gpxLocateDialog && (
              <ConfirmDialog
                title="Auto-Tag from GPX?"
                message={`${gpxLocateDialog.matchCount} out of ${gpxLocateDialog.totalCount} selected photo${gpxLocateDialog.totalCount === 1 ? "" : "s"} have timestamps that overlap with imported GPX tracks. Auto-tag their locations?`}
                confirmLabel="Yes"
                cancelLabel="No"
                onConfirm={() => {
                  applyGpxAutoTag(selectedPhotos, gpxLocateDialog.allPoints, dispatch);
                  setGpxLocateDialog(null);
                }}
                onCancel={() => setGpxLocateDialog(null)}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
