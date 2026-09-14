import { useEffect, useRef } from "react";
import { useSession } from "../state/SessionContext";
import { tauriCommands } from "../lib/tauri";
import { reportError } from "../lib/errors";

/**
 * Keeps a photo's timezone consistent with its location, whichever control
 * put the location or the date there.
 *
 * A photo that has been edited this session and ends up with coordinates and a
 * date but no zone gets the zone resolved from its coordinates. The reducer
 * then derives the offset from date + time + zone, so the two arrive together.
 * Order does not matter: a date landing on a located photo and a location
 * landing on a dated photo both settle the same way.
 *
 * Pristine imports are left alone — a camera-tagged photo with no zone stays
 * as it came in until the user touches it — and a photo that already carries a
 * zone is never overridden here; a disagreeing location is surfaced as a
 * suggestion in the Location section instead.
 */
export function useTimezoneReconciler() {
  const { state, dispatch } = useSession();
  const photosRef = useRef(state.photos);
  photosRef.current = state.photos;
  // Coordinates that are being resolved, or resolved to nothing (open ocean):
  // neither should be asked about again on every render.
  const inFlight = useRef(new Set<string>());
  const unresolvable = useRef(new Set<string>());

  useEffect(() => {
    for (const photo of state.photos) {
      const m = photo.currentMetadata;
      if (!photo.pendingChanges || m.timezone || !m.captureDate) continue;
      if (m.gpsLat == null || m.gpsLng == null) continue;
      const key = `${photo.id}|${m.gpsLat}|${m.gpsLng}`;
      if (inFlight.current.has(key) || unresolvable.current.has(key)) continue;

      inFlight.current.add(key);
      const { gpsLat, gpsLng } = m;
      tauriCommands
        .resolveTimezone(gpsLat, gpsLng)
        .then((tz) => {
          if (!tz) {
            unresolvable.current.add(key);
            return;
          }
          // The photo may have moved on while we waited: gone, re-located, or
          // given a zone by hand. Only fill a still-empty slot.
          const latest = photosRef.current.find((p) => p.id === photo.id);
          const lm = latest?.currentMetadata;
          if (!lm || lm.timezone || lm.gpsLat !== gpsLat || lm.gpsLng !== gpsLng) return;
          const changes = { timezone: tz };
          dispatch({ type: "SET_PENDING", ids: [photo.id], changes });
          tauriCommands
            .setPendingChanges([photo.id], [{ field: "timezone", value: tz }])
            .catch((err) => reportError("Failed to save timezone edits", err));
        })
        .catch((err) => {
          unresolvable.current.add(key);
          reportError("Failed to resolve a timezone from the photo's location", err);
        })
        .finally(() => inFlight.current.delete(key));
    }
  }, [state.photos, dispatch]);
}
