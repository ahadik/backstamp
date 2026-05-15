import type { Photo, Metadata } from "../state/SessionContext";
import type { DropTarget } from "./useDragDrop";

export interface CameraData {
  cameraMake: string | null;
  cameraModel: string | null;
  lens: string | null;
  filmVendor: string | null;
  filmType: string | null;
}

export interface CameraConflict {
  draggingIds: string[];
  /** Camera data from the neighbor before the gap. null means "no camera data set". */
  optionBefore: CameraData | null;
  /** Camera data from the neighbor after the gap. null means "no camera data set". */
  optionAfter: CameraData | null;
}

export interface InheritanceResult {
  /** Per-photo metadata changes — always contains timestamp and GPS assignments.
   *  Camera fields are ONLY included here when there is no conflict. */
  changes: Map<string, Partial<Metadata>>;
  /** Present only for gap drops when the two neighbors have different camera data. */
  cameraConflict: CameraConflict | null;
}

export function computeInheritance(
  draggingPhotos: Photo[],
  target: DropTarget,
  targetPhoto: Photo | null,
  neighborBefore: Photo | null,
  neighborAfter: Photo | null,
): InheritanceResult {
  const changes = new Map<string, Partial<Metadata>>();

  if (target.kind === "photo") {
    if (!targetPhoto) return { changes, cameraConflict: null };
    const masterMeta = targetPhoto.currentMetadata;
    const fields: (keyof Metadata)[] = [
      "captureDate", "captureTime", "gpsLat", "gpsLng",
      "cameraMake", "cameraModel", "lens", "filmVendor", "filmType",
    ];
    const photoChanges = Object.fromEntries(
      fields
        .filter((f) => masterMeta[f] !== null)
        .map((f) => [f, masterMeta[f]])
    ) as Partial<Metadata>;
    for (const p of draggingPhotos) changes.set(p.id, photoChanges);
    return { changes, cameraConflict: null };
  }

  // gap drop
  const { gap } = target;

  if (gap.dayKey === "no-date") {
    for (const p of draggingPhotos) {
      changes.set(p.id, { captureDate: null, captureTime: null });
    }
    return { changes, cameraConflict: null };
  }

  // Resolve camera data: detect conflicts or pick the available neighbor's data
  const cameraA = extractCameraData(neighborBefore);
  const cameraB = extractCameraData(neighborAfter);
  let mergedCamera: CameraData | null = null;
  let hasCameraConflict = false;

  if (cameraDataEqual(cameraA, cameraB)) {
    mergedCamera = cameraA; // both null → no change; both equal → inherit
  } else if (cameraA === null) {
    mergedCamera = cameraB; // only after-neighbor has data → inherit it
  } else if (cameraB === null) {
    mergedCamera = cameraA; // only before-neighbor has data → inherit it
  } else {
    hasCameraConflict = true; // both have data but differ → conflict
  }

  const cameraFields: (keyof CameraData)[] = [
    "cameraMake", "cameraModel", "lens", "filmVendor", "filmType",
  ];

  const tz = resolveTimezone(neighborBefore, neighborAfter);

  for (let i = 0; i < draggingPhotos.length; i++) {
    const p = draggingPhotos[i];
    const t = interpolateTimestamp(
      neighborBefore,
      neighborAfter,
      i,
      draggingPhotos.length,
      gap.dayKey,
    );
    const gps = interpolateGps(neighborBefore, neighborAfter, i, draggingPhotos.length);
    const photoChanges: Partial<Metadata> = {
      captureDate: t.captureDate,
      captureTime: t.captureTime,
      ...gps,
    };
    if (tz !== null) photoChanges.timezone = tz;
    if (!hasCameraConflict && mergedCamera !== null) {
      for (const field of cameraFields) {
        if (mergedCamera[field] != null) {
          (photoChanges as Record<string, unknown>)[field] = mergedCamera[field];
        }
      }
    }
    changes.set(p.id, photoChanges);
  }

  if (hasCameraConflict) {
    return {
      changes,
      cameraConflict: {
        draggingIds: draggingPhotos.map((p) => p.id),
        optionBefore: cameraA,
        optionAfter: cameraB,
      },
    };
  }

  return { changes, cameraConflict: null };
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

export function cameraDataEqual(a: CameraData | null, b: CameraData | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return (
    a.cameraMake === b.cameraMake &&
    a.cameraModel === b.cameraModel &&
    a.lens === b.lens &&
    a.filmVendor === b.filmVendor &&
    a.filmType === b.filmType
  );
}

function resolveTimezone(before: Photo | null, after: Photo | null): string | null {
  return before?.currentMetadata.timezone ?? after?.currentMetadata.timezone ?? null;
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
      captureDate: dayKey,
      captureTime: afterTime ? subtractMinutes(afterTime, total - index) : null,
    };
  }

  if (before && !after) {
    // gap at end of block: use last photo's time plus 1 min per dragged photo
    const beforeTime = before.currentMetadata.captureTime;
    return {
      captureDate: dayKey,
      captureTime: beforeTime ? addMinutes(beforeTime, index + 1) : null,
    };
  }

  // gap between two dated photos: interpolate
  const bt = before!.currentMetadata.captureTime;
  const at = after!.currentMetadata.captureTime;
  if (!bt || !at) {
    return { captureDate: dayKey, captureTime: bt ?? at ?? null };
  }

  const bSec = timeToSeconds(bt);
  const aSec = timeToSeconds(at);
  const t = (index + 1) / (total + 1);
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
