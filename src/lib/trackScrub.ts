import { wallClockFromUtcSeconds } from "./datetime";
import type { TrackPoint } from "./tauri";
import type { Photo, Metadata } from "../state/SessionContext";

/**
 * The GPX track scrubber: hover near a rendered track, snap to the nearest
 * point *on* the line, and click to stamp the selected photos with that
 * position and its interpolated capture time.
 *
 * This module is the pure half — geometry, timestamp interpolation, and the
 * change-set/confirmation planning. Map wiring lives in
 * components/MapPanel/gpxScrub.ts.
 *
 * Where gpxMatching goes time → location, this goes location → time: the
 * timestamp at a snapped position is interpolated between the bracketing
 * track points exactly as gpxMatching interpolates position between
 * bracketing timestamps.
 */

/**
 * A pick position on the map: snapped onto a GPX track (gpxId set, with its
 * interpolated instant) or a free drop anywhere else (gpxId null, no time).
 */
export interface ScrubSnap {
  gpxId: string | null;
  lat: number;
  lng: number;
  /** Interpolated UTC epoch seconds, or null when the track carries no usable times. */
  timestampUtcSecs: number | null;
}

interface NearestPoint {
  lat: number;
  lng: number;
  timestampUtcSecs: number | null;
  /** Squared distance from the cursor in latitude-scaled degrees; ranks candidates. */
  dist2: number;
}

/**
 * Nearest point on the polyline through `points` (in draw order) to `cursor`.
 *
 * Distances use a local equirectangular frame around the cursor (longitude
 * scaled by cos(lat)), which is plenty accurate at the pixel scales scrubbing
 * cares about. Tracks crossing the antimeridian are not handled.
 */
export function nearestPointOnTrack(
  points: TrackPoint[],
  cursor: { lng: number; lat: number }
): NearestPoint | null {
  if (points.length === 0) return null;

  const cosLat = Math.cos((cursor.lat * Math.PI) / 180);
  // Cursor sits at the origin of the scaled frame.
  const px = (p: TrackPoint) => (p.lng - cursor.lng) * cosLat;
  const py = (p: TrackPoint) => p.lat - cursor.lat;

  const timestampAt = (a: TrackPoint, b: TrackPoint, t: number): number | null =>
    Number.isFinite(a.timestamp) && Number.isFinite(b.timestamp)
      ? Math.round(a.timestamp + t * (b.timestamp - a.timestamp))
      : null;

  if (points.length === 1) {
    const p = points[0];
    const x = px(p);
    const y = py(p);
    return {
      lat: p.lat,
      lng: p.lng,
      timestampUtcSecs: Number.isFinite(p.timestamp) ? p.timestamp : null,
      dist2: x * x + y * y,
    };
  }

  let best: NearestPoint | null = null;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const ax = px(a);
    const ay = py(a);
    const dx = px(b) - ax;
    const dy = py(b) - ay;
    const len2 = dx * dx + dy * dy;
    // Project the origin (cursor) onto the segment, clamped to its ends.
    const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2));
    const sx = ax + t * dx;
    const sy = ay + t * dy;
    const dist2 = sx * sx + sy * sy;
    if (!best || dist2 < best.dist2) {
      best = {
        lat: a.lat + t * (b.lat - a.lat),
        lng: a.lng + t * (b.lng - a.lng),
        timestampUtcSecs: timestampAt(a, b, t),
        dist2,
      };
    }
  }
  return best;
}

/** Nearest snap across several tracks; the closest track wins. */
export function nearestPointOnTracks(
  tracks: Array<{ id: string; points: TrackPoint[] }>,
  cursor: { lng: number; lat: number }
): ScrubSnap | null {
  let best: (NearestPoint & { gpxId: string }) | null = null;
  for (const track of tracks) {
    const near = nearestPointOnTrack(track.points, cursor);
    if (near && (!best || near.dist2 < best.dist2)) {
      best = { ...near, gpxId: track.id };
    }
  }
  return best
    ? { gpxId: best.gpxId, lat: best.lat, lng: best.lng, timestampUtcSecs: best.timestampUtcSecs }
    : null;
}

/**
 * Per-photo pending changes for stamping `snap` onto `photos`. Location is
 * always set; time only when the snap has one. The wall clock is expressed in
 * the photo's own timezone when set, else the GPX file's, else UTC — and the
 * zone plus its frozen offset are written alongside so the stored fields stay
 * mutually consistent (the invariant the inspector maintains).
 */
export function buildScrubChanges(
  photos: Photo[],
  snap: { lat: number; lng: number; timestampUtcSecs: number | null },
  gpxTimezone: string | null
): Array<{ id: string; changes: Partial<Metadata> }> {
  return photos.map((photo) => {
    const changes: Partial<Metadata> = { gpsLat: snap.lat, gpsLng: snap.lng };
    if (snap.timestampUtcSecs != null) {
      const zone = photo.currentMetadata.timezone ?? gpxTimezone ?? "UTC";
      const wall = wallClockFromUtcSeconds(snap.timestampUtcSecs, zone);
      if (wall) {
        changes.captureDate = wall.date;
        changes.captureTime = wall.time;
        changes.timezone = zone;
        changes.utcOffset = wall.utcOffset;
      }
    }
    return { id: photo.id, changes };
  });
}

export interface ScrubConfirm {
  photoCount: number;
  /** Photos whose existing time or location the click would replace. */
  overwriteCount: number;
  setsTime: boolean;
  /** True for a track snap, false for a free drop elsewhere on the map. */
  fromTrack: boolean;
}

export interface ScrubPlan {
  updates: Array<{ id: string; changes: Partial<Metadata> }>;
  /** Null when the edit can apply silently: a single photo with nothing to replace. */
  confirm: ScrubConfirm | null;
}

/**
 * Build the change set for a scrub click and decide whether it needs
 * confirmation: always for more than one photo, and for a single photo
 * whenever a value it already carries would be replaced.
 */
export function planScrubApply(
  photos: Photo[],
  snap: ScrubSnap,
  gpxTimezone: string | null
): ScrubPlan {
  const setsTime = snap.timestampUtcSecs != null;
  const overwriteCount = photos.filter((p) => {
    const m = p.currentMetadata;
    const hasLocation = m.gpsLat != null || m.gpsLng != null;
    const hasTime = m.captureDate != null || m.captureTime != null;
    return hasLocation || (setsTime && hasTime);
  }).length;
  return {
    updates: buildScrubChanges(photos, snap, gpxTimezone),
    confirm:
      photos.length > 1 || overwriteCount > 0
        ? { photoCount: photos.length, overwriteCount, setsTime, fromTrack: snap.gpxId != null }
        : null,
  };
}

export function scrubConfirmMessage(c: ScrubConfirm): string {
  const what = c.setsTime ? "time and location" : "location";
  const target = c.fromTrack ? "this track point" : "this point";
  if (c.photoCount === 1) {
    return `This photo already has a ${
      c.setsTime ? "time or location" : "location"
    } set. Replace it with ${target}?`;
  }
  const base = `Set the ${what} of ${c.photoCount} photos to ${target}?`;
  if (c.overwriteCount === 0) return base;
  const has =
    c.overwriteCount === 1
      ? "1 of them already has"
      : `${c.overwriteCount} of them already have`;
  return `${base} ${has} existing values that will be replaced.`;
}

/** "Jun 12, 2:34:56 PM" in the track's timezone, for the hover tooltip. */
export function formatSnapTime(utcSecs: number, timezone: string | null): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  };
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: timezone ?? "UTC" });
  } catch {
    fmt = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" });
  }
  return fmt.format(utcSecs * 1000);
}
