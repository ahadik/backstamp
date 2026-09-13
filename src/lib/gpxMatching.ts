import { toUtcSeconds } from "./datetime";
import type { TrackPoint } from "./tauri";
import type { Photo } from "../state/SessionContext";

/**
 * Matching semantics: a photo whose instant falls anywhere inside a single
 * track's time span is always matched, interpolating across recording gaps of
 * any size — a gap means the logger failed to record, not that the subject
 * teleported, and an interpolated line is better than nothing. Tracks are never
 * bridged: separate tracks are separate recordings, and interpolating between
 * one track's end and another's start would fabricate a path no device
 * witnessed. `toleranceSecs` therefore only applies beyond a track's ends.
 */

interface TrackMatch {
  lat: number;
  lng: number;
  /** Seconds from the target to the nearest recorded fix; ranks overlapping tracks. */
  nearestFixSecs: number;
}

function matchWithin(
  points: TrackPoint[],
  targetUtcSecs: number,
  toleranceSecs: number
): TrackMatch | null {
  if (points.length === 0) return null;

  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].timestamp <= targetUtcSecs) lo = mid + 1;
    else hi = mid;
  }
  const after = lo < points.length ? points[lo] : null;
  const before = lo > 0 ? points[lo - 1] : null;

  if (!before && after) {
    const dist = after.timestamp - targetUtcSecs;
    return dist <= toleranceSecs ? { lat: after.lat, lng: after.lng, nearestFixSecs: dist } : null;
  }
  if (before && !after) {
    const dist = targetUtcSecs - before.timestamp;
    return dist <= toleranceSecs ? { lat: before.lat, lng: before.lng, nearestFixSecs: dist } : null;
  }
  if (before && after) {
    const total = after.timestamp - before.timestamp;
    if (total === 0) {
      return { lat: before.lat, lng: before.lng, nearestFixSecs: targetUtcSecs - before.timestamp };
    }
    const t = (targetUtcSecs - before.timestamp) / total;
    return {
      lat: before.lat + t * (after.lat - before.lat),
      lng: before.lng + t * (after.lng - before.lng),
      nearestFixSecs: Math.min(targetUtcSecs - before.timestamp, after.timestamp - targetUtcSecs),
    };
  }
  return null;
}

/**
 * Find the best lat/lng for a UTC timestamp within a single track's sorted
 * points. Inside the track's span the position is always interpolated, however
 * wide the recording gap; toleranceSecs only limits how far beyond the track's
 * ends a match may reach.
 */
export function matchToTrack(
  points: TrackPoint[],
  targetUtcSecs: number,
  toleranceSecs = 60
): { lat: number; lng: number } | null {
  const match = matchWithin(points, targetUtcSecs, toleranceSecs);
  return match ? { lat: match.lat, lng: match.lng } : null;
}

/**
 * Match against several tracks, each an independently recorded point list.
 * Tracks are tried separately — never concatenated — and when more than one
 * covers the target (e.g. two devices recording at once), the one with a
 * recorded fix nearest in time to the target wins.
 */
export function matchToTracks(
  tracks: TrackPoint[][],
  targetUtcSecs: number,
  toleranceSecs = 60
): { lat: number; lng: number } | null {
  let best: TrackMatch | null = null;
  for (const points of tracks) {
    const match = matchWithin(points, targetUtcSecs, toleranceSecs);
    if (match && (!best || match.nearestFixSecs < best.nearestFixSecs)) {
      best = match;
    }
  }
  return best ? { lat: best.lat, lng: best.lng } : null;
}

/**
 * Count how many photos from a list would match against a set of tracks.
 * Only photos with captureDate, captureTime, and timezone are candidates.
 */
export function countMatches(
  photos: Array<{
    currentMetadata: { captureDate: string | null; captureTime: string | null; timezone: string | null };
  }>,
  tracks: TrackPoint[][],
  toleranceSecs = 60
): { matching: number; total: number } {
  let matching = 0;
  let total = 0;
  for (const photo of photos) {
    const { captureDate, captureTime, timezone } = photo.currentMetadata;
    if (!captureDate || !captureTime || !timezone) continue;
    total++;
    const utcSecs = toUtcSeconds(captureDate, captureTime, timezone);
    if (utcSecs !== null && matchToTracks(tracks, utcSecs, toleranceSecs)) {
      matching++;
    }
  }
  return { matching, total };
}

/**
 * For each photo in `photos` that has date, time, and timezone set,
 * find its matching GPS coordinates and dispatch SET_PENDING.
 * Photos with no timezone or no match are skipped.
 */
export function applyGpxAutoTag(
  photos: Photo[],
  tracks: TrackPoint[][],
  dispatch: (action: { type: "SET_PENDING_BATCH"; updates: Array<{ id: string; changes: { gpsLat: number; gpsLng: number } }> }) => void,
  toleranceSecs = 60
): void {
  const updates: Array<{ id: string; changes: { gpsLat: number; gpsLng: number } }> = [];
  for (const photo of photos) {
    const { captureDate, captureTime, timezone } = photo.currentMetadata;
    if (!captureDate || !captureTime || !timezone) continue;

    const utcSecs = toUtcSeconds(captureDate, captureTime, timezone);
    if (utcSecs === null) continue;
    const match = matchToTracks(tracks, utcSecs, toleranceSecs);
    if (!match) continue;

    updates.push({ id: photo.id, changes: { gpsLat: match.lat, gpsLng: match.lng } });
  }
  if (updates.length > 0) {
    dispatch({ type: "SET_PENDING_BATCH", updates });
  }
}

/** Per-track sorted point lists for the matchers, from session GPX files. */
export function tracksFrom(gpxFiles: Array<{ trackPoints: TrackPoint[] }>): TrackPoint[][] {
  return gpxFiles.map((g) => [...g.trackPoints].sort((a, b) => a.timestamp - b.timestamp));
}
