import type { TrackPoint } from "./tauri";
import type { Photo } from "../state/SessionContext";

/**
 * Convert a wall-clock date + time string interpreted in a given IANA timezone
 * to a Unix epoch in seconds (UTC).
 *
 * Uses the Intl offset trick: treat the input as UTC to get a candidate,
 * determine the TZ offset at that candidate, and subtract.
 */
export function wallClockToUtcSecs(
  date: string, // "YYYY-MM-DD"
  time: string, // "HH:MM:SS"
  timezone: string
): number {
  const candidateMs = new Date(`${date}T${time}Z`).getTime();

  const fmt = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(candidateMs)).reduce<Record<string, string>>(
    (acc, p) => { acc[p.type] = p.value; return acc; },
    {}
  );
  const localAtCandidateMs = new Date(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`
  ).getTime();

  const offsetMs = localAtCandidateMs - candidateMs;
  return Math.round((candidateMs - offsetMs) / 1000);
}

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
    const utcSecs = wallClockToUtcSecs(captureDate, captureTime, timezone);
    if (matchToTrack(allTrackPoints, utcSecs, toleranceSecs)) {
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
  dispatch: (action: { type: "SET_PENDING"; ids: string[]; changes: { gpsLat: number; gpsLng: number } }) => void,
  toleranceSecs = 60
): void {
  for (const photo of photos) {
    const { captureDate, captureTime, timezone } = photo.currentMetadata;
    if (!captureDate || !captureTime || !timezone) continue;

    const utcSecs = wallClockToUtcSecs(captureDate, captureTime, timezone);
    const match = matchToTrack(trackPoints, utcSecs, toleranceSecs);
    if (!match) continue;

    dispatch({
      type: "SET_PENDING",
      ids: [photo.id],
      changes: { gpsLat: match.lat, gpsLng: match.lng },
    });
  }
}
