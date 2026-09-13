import type { Photo, Metadata } from "../state/SessionContext";
import type { DropTarget } from "./useDragDrop";

export interface CameraData {
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  filmVendor: string | null;
  filmType: string | null;
}

/** How a group of fields is sourced on a gap drop. */
export type GapMode = "before" | "interpolate" | "after";

export interface GroupSetting {
  enabled: boolean;
  gapMode: GapMode;
}

/** Per-group inheritance choices. Photo (clone) drops use only `enabled`;
 *  gap drops also use `gapMode`. Camera never interpolates. */
export interface DropSettings {
  timestamp: GroupSetting;
  location: GroupSetting;
  camera: GroupSetting;
}

export type InheritGroup = keyof DropSettings;

export const DEFAULT_DROP_SETTINGS: DropSettings = {
  timestamp: { enabled: true, gapMode: "interpolate" },
  location: { enabled: true, gapMode: "interpolate" },
  camera: { enabled: true, gapMode: "before" },
};

export const GROUP_FIELDS: Record<InheritGroup, (keyof Metadata)[]> = {
  timestamp: ["captureDate", "captureTime", "utcOffset", "timezone"],
  location: ["gpsLat", "gpsLng"],
  camera: ["cameraMake", "cameraModel", "lens", "filmVendor", "filmType"],
};

/** Parses a persisted settings JSON string, falling back to defaults for
 *  anything missing or malformed. */
export function parseDropSettings(raw: string | null | undefined): DropSettings {
  const result: DropSettings = {
    timestamp: { ...DEFAULT_DROP_SETTINGS.timestamp },
    location: { ...DEFAULT_DROP_SETTINGS.location },
    camera: { ...DEFAULT_DROP_SETTINGS.camera },
  };
  if (!raw) return result;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<InheritGroup, Partial<GroupSetting>>>;
    for (const group of ["timestamp", "location", "camera"] as InheritGroup[]) {
      const g = parsed[group];
      if (!g || typeof g !== "object") continue;
      if (typeof g.enabled === "boolean") result[group].enabled = g.enabled;
      if (g.gapMode === "before" || g.gapMode === "after") {
        result[group].gapMode = g.gapMode;
      } else if (g.gapMode === "interpolate" && group !== "camera") {
        result[group].gapMode = "interpolate";
      }
    }
  } catch {
    // Malformed JSON — keep defaults
  }
  return result;
}

export function hasGroupData(photo: Photo | null, group: InheritGroup): boolean {
  if (!photo) return false;
  const m = photo.currentMetadata;
  if (group === "timestamp") return m.captureDate !== null || m.captureTime !== null;
  if (group === "location") return m.gpsLat !== null && m.gpsLng !== null;
  return extractCameraData(photo) !== null;
}

function copyGroupFields(source: Photo, group: InheritGroup, into: Partial<Metadata>) {
  const m = source.currentMetadata;
  for (const field of GROUP_FIELDS[group]) {
    if (m[field] !== null) {
      (into as Record<string, unknown>)[field] = m[field];
    }
  }
}

/** Resolves which neighbor an "adopt before/after" choice actually reads from:
 *  the chosen side, falling back to the other side when the chosen neighbor is
 *  missing or has no data for the group. Choosing an empty side would set
 *  nothing; falling back preserves the "inherit whatever is available" behavior
 *  and matches the preview shown in the drop dialog. */
function adoptSource(
  mode: "before" | "after",
  before: Photo | null,
  after: Photo | null,
  group: InheritGroup,
): Photo | null {
  const primary = mode === "before" ? before : after;
  const secondary = mode === "before" ? after : before;
  if (hasGroupData(primary, group)) return primary;
  if (hasGroupData(secondary, group)) return secondary;
  return null;
}

export function computeInheritance(
  draggingPhotos: Photo[],
  target: DropTarget,
  targetPhoto: Photo | null,
  neighborBefore: Photo | null,
  neighborAfter: Photo | null,
  settings: DropSettings = DEFAULT_DROP_SETTINGS,
): Map<string, Partial<Metadata>> {
  const changes = new Map<string, Partial<Metadata>>();

  if (target.kind === "photo") {
    if (!targetPhoto) return changes;
    const photoChanges: Partial<Metadata> = {};
    for (const group of ["timestamp", "location", "camera"] as InheritGroup[]) {
      if (settings[group].enabled) copyGroupFields(targetPhoto, group, photoChanges);
    }
    for (const p of draggingPhotos) changes.set(p.id, photoChanges);
    return changes;
  }

  // gap drop
  const { gap } = target;

  if (gap.dayKey === "no-date") {
    for (const p of draggingPhotos) {
      changes.set(p.id, { captureDate: null, captureTime: null });
    }
    return changes;
  }

  const tz = resolveTimezone(neighborBefore, neighborAfter);
  const resolvedUtcOffset =
    neighborBefore?.currentMetadata.utcOffset ?? neighborAfter?.currentMetadata.utcOffset ?? null;

  // Adopt-mode sources are the same for every dragged photo — resolve once.
  const timestampSource =
    settings.timestamp.gapMode === "interpolate"
      ? null
      : adoptSource(settings.timestamp.gapMode, neighborBefore, neighborAfter, "timestamp");
  const locationSource =
    settings.location.gapMode === "interpolate"
      ? null
      : adoptSource(settings.location.gapMode, neighborBefore, neighborAfter, "location");
  const cameraSource =
    settings.camera.gapMode === "interpolate"
      ? null
      : adoptSource(settings.camera.gapMode, neighborBefore, neighborAfter, "camera");

  for (let i = 0; i < draggingPhotos.length; i++) {
    const p = draggingPhotos[i];
    const photoChanges: Partial<Metadata> = {};

    if (settings.timestamp.enabled) {
      if (settings.timestamp.gapMode === "interpolate") {
        const t = interpolateTimestamp(
          neighborBefore,
          neighborAfter,
          i,
          draggingPhotos.length,
          gap.dayKey,
        );
        photoChanges.captureDate = t.captureDate;
        photoChanges.captureTime = t.captureTime;
        if (tz !== null) photoChanges.timezone = tz;
        if (resolvedUtcOffset !== null) photoChanges.utcOffset = resolvedUtcOffset;
      } else if (timestampSource) {
        copyGroupFields(timestampSource, "timestamp", photoChanges);
      }
    }

    if (settings.location.enabled) {
      if (settings.location.gapMode === "interpolate") {
        Object.assign(
          photoChanges,
          interpolateGps(neighborBefore, neighborAfter, i, draggingPhotos.length),
        );
      } else if (locationSource) {
        copyGroupFields(locationSource, "location", photoChanges);
      }
    }

    if (settings.camera.enabled && cameraSource) {
      copyGroupFields(cameraSource, "camera", photoChanges);
    }

    changes.set(p.id, photoChanges);
  }

  return changes;
}

export function extractCameraData(photo: Photo | null): CameraData | null {
  if (!photo) return null;
  const m = photo.currentMetadata;
  if (
    m.cameraMake == null && m.cameraModel == null && m.lens == null &&
    m.filmVendor == null && m.filmType == null
  ) return null;
  return {
    cameraMake: m.cameraMake,
    cameraModel: m.cameraModel,
    lens: m.lens,
    filmVendor: m.filmVendor,
    filmType: m.filmType,
  };
}

function resolveTimezone(before: Photo | null, after: Photo | null): string | null {
  return before?.currentMetadata.timezone ?? after?.currentMetadata.timezone ?? null;
}

function photoToUTCMillis(photo: Photo): number | null {
  const { captureDate, captureTime, utcOffset } = photo.currentMetadata;
  if (!captureDate || !captureTime || !utcOffset) return null;
  try {
    const d = new Date(`${captureDate}T${captureTime}${utcOffset}`);
    return isNaN(d.getTime()) ? null : d.getTime();
  } catch {
    return null;
  }
}

function parseOffsetMinutes(utcOffset: string): number | null {
  const m = utcOffset.match(/^([+-])(\d{2}):(\d{2})$/);
  if (!m) return null;
  const sign = m[1] === "+" ? 1 : -1;
  return sign * (parseInt(m[2]) * 60 + parseInt(m[3]));
}

function utcMillisToLocal(
  ms: number,
  utcOffset: string,
): { captureDate: string; captureTime: string } | null {
  const offsetMinutes = parseOffsetMinutes(utcOffset);
  if (offsetMinutes === null) return null;
  const d = new Date(ms + offsetMinutes * 60000);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const sec = String(d.getUTCSeconds()).padStart(2, "0");
  return { captureDate: `${year}-${month}-${day}`, captureTime: `${h}:${min}:${sec}` };
}

function interpolateTimestamp(
  before: Photo | null,
  after: Photo | null,
  index: number,
  total: number,
  dayKey: string,
): { captureDate: string | null; captureTime: string | null } {
  if (!before && !after) return { captureDate: dayKey, captureTime: null };

  if (!before && after) {
    // gap at start of block: use first photo's time minus 1 min per dragged photo
    const afterTime = after.currentMetadata.captureTime;
    return {
      captureDate: after.currentMetadata.captureDate ?? dayKey,
      captureTime: afterTime ? subtractMinutes(afterTime, total - index) : null,
    };
  }

  if (before && !after) {
    // gap at end of block: use last photo's time plus 1 min per dragged photo
    const beforeTime = before.currentMetadata.captureTime;
    return {
      captureDate: before.currentMetadata.captureDate ?? dayKey,
      captureTime: beforeTime ? addMinutes(beforeTime, index + 1) : null,
    };
  }

  // gap between two dated photos: interpolate
  const t = (index + 1) / (total + 1);

  // Interpolate in UTC to correctly handle photos whose local times span midnight
  // (e.g., before=22:00 PST Jan 14, after=02:00 PST Jan 15 — same India-time day block)
  const bMs = photoToUTCMillis(before!);
  const aMs = photoToUTCMillis(after!);
  const utcOffset = before!.currentMetadata.utcOffset ?? after!.currentMetadata.utcOffset;
  if (bMs !== null && aMs !== null && utcOffset) {
    const local = utcMillisToLocal(bMs + Math.round((aMs - bMs) * t), utcOffset);
    if (local) return local;
  }

  // Fallback: naive same-day time interpolation (used when utcOffset is absent)
  const bt = before!.currentMetadata.captureTime;
  const at = after!.currentMetadata.captureTime;
  if (!bt || !at) {
    return { captureDate: dayKey, captureTime: bt ?? at ?? null };
  }

  const bSec = timeToSeconds(bt);
  const aSec = timeToSeconds(at);
  const interpolated = bSec + Math.round((aSec - bSec) * t);
  return {
    captureDate: dayKey,
    captureTime: secondsToTime(interpolated),
  };
}

function interpolateGps(
  before: Photo | null,
  after: Photo | null,
  index: number,
  total: number,
): Partial<Metadata> {
  const bLat = before?.currentMetadata.gpsLat ?? null;
  const bLng = before?.currentMetadata.gpsLng ?? null;
  const aLat = after?.currentMetadata.gpsLat ?? null;
  const aLng = after?.currentMetadata.gpsLng ?? null;

  if (bLat !== null && bLng !== null && aLat !== null && aLng !== null) {
    // Linear interpolation is accurate for distances < 100 km
    const t = (index + 1) / (total + 1);
    return {
      gpsLat: bLat + (aLat - bLat) * t,
      gpsLng: bLng + (aLng - bLng) * t,
    };
  }
  if (bLat !== null && bLng !== null) return { gpsLat: bLat, gpsLng: bLng };
  if (aLat !== null && aLng !== null) return { gpsLat: aLat, gpsLng: aLng };
  return {};
}

function timeToSeconds(t: string): number {
  const [h, m, s] = t.split(":").map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

function secondsToTime(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return [h, m, ss].map((n) => String(n).padStart(2, "0")).join(":");
}

function addMinutes(time: string, mins: number): string {
  return secondsToTime(timeToSeconds(time) + mins * 60);
}

function subtractMinutes(time: string, mins: number): string {
  return secondsToTime(timeToSeconds(time) - mins * 60);
}
