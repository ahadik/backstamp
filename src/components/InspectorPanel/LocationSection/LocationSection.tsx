import { useState, useEffect, useRef, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import { useSession } from "../../../state/SessionContext";
import { useUI } from "../../../state/UIContext";
import { deriveFieldValue } from "../../../lib/inspectorUtils";
import { ConfirmDialog } from "../../common/ConfirmDialog/ConfirmDialog";
import { tauriCommands } from "../../../lib/tauri";
import type { Photo } from "../../../state/SessionContext";
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
  const { dispatch } = useSession();
  const { state: uiState } = useUI();
  const mapboxToken = uiState.mapboxToken;

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<GeocodingFeature[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [resolvedTz, setResolvedTz] = useState<string | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [multiConfirm, setMultiConfirm] = useState<{
    lat: number;
    lng: number;
    count: number;
  } | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const maybeDispatchCoordsRef = useRef<(lat: number, lng: number) => void>(null!);

  const selectedIds = selectedPhotos.map((p) => p.id);
  const gpsLat = deriveFieldValue(selectedPhotos, (m) => m.gpsLat);
  const gpsLng = deriveFieldValue(selectedPhotos, (m) => m.gpsLng);
  const timezone = deriveFieldValue(selectedPhotos, (m) => m.timezone);

  const hasCoords =
    gpsLat !== null &&
    gpsLat !== "multiple" &&
    gpsLng !== null &&
    gpsLng !== "multiple";
  const multipleCoords = gpsLat === "multiple" || gpsLng === "multiple";
  const isEmpty = selectedPhotos.length === 0;
  const showMap = !isEmpty && !multipleCoords;

  function dispatchCoords(lat: number, lng: number) {
    dispatch({
      type: "SET_PENDING",
      ids: selectedIds,
      changes: { gpsLat: lat, gpsLng: lng },
    });
    tauriCommands.resolveTimezone(lat, lng).then(setResolvedTz).catch(console.error);
  }

  function maybeDispatchCoords(lat: number, lng: number) {
    if (gpsLat === "multiple" || gpsLng === "multiple") {
      const count = selectedPhotos.filter((p) => p.currentMetadata.gpsLat !== null).length;
      setMultiConfirm({ lat, lng, count: Math.max(count, 1) });
    } else {
      dispatchCoords(lat, lng);
    }
  }
  maybeDispatchCoordsRef.current = maybeDispatchCoords;

  // Initialise map — only when the container is actually in the DOM (showMap=true)
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
        center: hasCoords
          ? [gpsLng as number, gpsLat as number]
          : [0, 20],
      });
    } catch (err) {
      setMapError(err instanceof Error ? err.message : String(err));
      return;
    }
    mapRef.current = map;

    // Click on map to set location
    map.on("click", (e) => {
      const { lat, lng } = e.lngLat;
      maybeDispatchCoordsRef.current(lat, lng);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapboxToken, showMap]);

  // Update marker when coords change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
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
        maybeDispatchCoordsRef.current(pos.lat, pos.lng);
      });
      markerRef.current = marker;
    }
    map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 10) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gpsLat, gpsLng]);

  const fetchSuggestions = useCallback(
    async (query: string) => {
      if (!query.trim() || !mapboxToken) {
        setSuggestions([]);
        return;
      }
      try {
        const url = new URL(
          "https://api.mapbox.com/search/geocode/v6/forward"
        );
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

  async function handleSuggestionSelect(feature: GeocodingFeature) {
    setSuggestionsOpen(false);
    setSearchQuery(feature.properties.full_address);
    const [lng, lat] = feature.geometry.coordinates;
    maybeDispatchCoords(lat, lng);
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
        ) : multipleCoords ? (
          <p className={styles.empty}>Multiple locations</p>
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

            <p className={styles.coords}>
              {hasCoords
                ? `${(gpsLat as number).toFixed(4)}°${(gpsLat as number) >= 0 ? "N" : "S"} ${Math.abs(gpsLng as number).toFixed(4)}°${(gpsLng as number) >= 0 ? "E" : "W"}`
                : "Not set"}
            </p>

            {tzMismatch && (
              <p className={styles.tzWarning}>
                ⚠ Location suggests <strong>{resolvedTz}</strong> but timezone is set to{" "}
                <strong>{timezone as string}</strong>.
              </p>
            )}
          </>
        )}
      </div>

      {multiConfirm && (
        <ConfirmDialog
          title="Overwrite Multiple Locations?"
          message={
            <>
              You are about to overwrite <strong>{multiConfirm.count}</strong> different locations.
              Continue?
            </>
          }
          confirmLabel="Overwrite"
          onConfirm={() => {
            dispatchCoords(multiConfirm.lat, multiConfirm.lng);
            setMultiConfirm(null);
          }}
          onCancel={() => setMultiConfirm(null)}
        />
      )}
    </div>
  );
}
