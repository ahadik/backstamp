import { toUtcSeconds } from "./datetime";
import type { TrackPoint } from "./tauri";
import type { Photo } from "../state/SessionContext";

/**
 * Find the best lat/lng for a UTC timestamp from a sorted list of track points.
 * Returns null if no point is within toleranceSecs.
 * Interpolates when the target falls between two consecutive points.
 */
export function matchToTrack(
  points: TrackPoint[],
  targetUtcSecs: number,
  toleranceSecs = 60
): { lat: number; lng: number } | null {
  if (points.length === 0) return null;

  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].timestamp <= targetUtcSecs) lo = mid + 1;
    else hi = mid;
  }
  const afterIdx = lo;
  const beforeIdx = afterIdx - 1;

  const before = beforeIdx >= 0 ? points[beforeIdx] : null;
  const after = afterIdx < points.length ? points[afterIdx] : null;

  if (!before && after) {
    return Math.abs(after.timestamp - targetUtcSecs) <= toleranceSecs
      ? { lat: after.lat, lng: after.lng }
      : null;
  }
  if (before && !after) {
    return Math.abs(targetUtcSecs - before.timestamp) <= toleranceSecs
      ? { lat: before.lat, lng: before.lng }
      : null;
  }
  if (before && after) {
    const distBefore = Math.abs(targetUtcSecs - before.timestamp);
    const distAfter = Math.abs(after.timestamp - targetUtcSecs);
    if (distBefore > toleranceSecs && distAfter > toleranceSecs) return null;
    const total = after.timestamp - before.timestamp;
    if (total === 0) return { lat: before.lat, lng: before.lng };
    const t = (targetUtcSecs - before.timestamp) / total;
    return {
      lat: before.lat + t * (after.lat - before.lat),
      lng: before.lng + t * (after.lng - before.lng),
    };
  }
  return null;
}

/**
 * Count how many photos from a list would match against a set of track points.
 * Only photos with captureDate, captureTime, and timezone are candidates.
 */
export function countMatches(
  photos: Array<{
    currentMetadata: { captureDate: string | null; captureTime: string | null; timezone: string | null };
  }>,
  allTrackPoints: TrackPoint[],
  toleranceSecs = 60
): { matching: number; total: number } {
  let matching = 0;
  let total = 0;
  for (const photo of photos) {
    const { captureDate, captureTime, timezone } = photo.currentMetadata;
    if (!captureDate || !captureTime || !timezone) continue;
    total++;
    const utcSecs = toUtcSeconds(captureDate, captureTime, timezone);
    if (utcSecs !== null && matchToTrack(allTrackPoints, utcSecs, toleranceSecs)) {
      matching++;
    }
  }
  return { matching, total };
}

/**
 * For each photo in `photos` that has date, time, and timezone set,
 * find its matching GPS coordinates and dispatch SET_PENDING.
 * Photos with no timezone or no match within tolerance are skipped.
 */
export function applyGpxAutoTag(
  photos: Photo[],
  trackPoints: TrackPoint[],
  dispatch: (action: { type: "SET_PENDING_BATCH"; updates: Array<{ id: string; changes: { gpsLat: number; gpsLng: number } }> }) => void,
  toleranceSecs = 60
): void {
  const updates: Array<{ id: string; changes: { gpsLat: number; gpsLng: number } }> = [];
  for (const photo of photos) {
    const { captureDate, captureTime, timezone } = photo.currentMetadata;
    if (!captureDate || !captureTime || !timezone) continue;

    const utcSecs = toUtcSeconds(captureDate, captureTime, timezone);
    if (utcSecs === null) continue;
    const match = matchToTrack(trackPoints, utcSecs, toleranceSecs);
    if (!match) continue;

    updates.push({ id: photo.id, changes: { gpsLat: match.lat, gpsLng: match.lng } });
  }
  if (updates.length > 0) {
    dispatch({ type: "SET_PENDING_BATCH", updates });
  }
}
