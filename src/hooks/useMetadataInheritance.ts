import type { Photo, Metadata } from "../state/SessionContext";
import type { DropTarget } from "./useDragDrop";

export function computeInheritance(
  draggingPhotos: Photo[],
  target: DropTarget,
  targetPhoto: Photo | null,
  neighborBefore: Photo | null,
  neighborAfter: Photo | null,
): Map<string, Partial<Metadata>> {
  const result = new Map<string, Partial<Metadata>>();

  if (target.kind === "photo") {
    if (!targetPhoto) return result;
    const changes: Partial<Metadata> = {
      captureDate: targetPhoto.currentMetadata.captureDate,
      captureTime: targetPhoto.currentMetadata.captureTime,
      gpsLat: targetPhoto.currentMetadata.gpsLat,
      gpsLng: targetPhoto.currentMetadata.gpsLng,
      cameraMake: targetPhoto.currentMetadata.cameraMake,
      cameraModel: targetPhoto.currentMetadata.cameraModel,
      lens: targetPhoto.currentMetadata.lens,
      filmVendor: targetPhoto.currentMetadata.filmVendor,
      filmType: targetPhoto.currentMetadata.filmType,
    };
    for (const p of draggingPhotos) result.set(p.id, changes);
    return result;
  }

  // gap drop
  const { gap } = target;

  if (gap.dayKey === "no-date") {
    for (const p of draggingPhotos) {
      result.set(p.id, { captureDate: null, captureTime: null });
    }
    return result;
  }

  const closerNeighbor = pickCloserNeighbor(neighborBefore, neighborAfter);

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
    const changes: Partial<Metadata> = {
      captureDate: t.captureDate,
      captureTime: t.captureTime,
      cameraMake: closerNeighbor?.currentMetadata.cameraMake ?? null,
      cameraModel: closerNeighbor?.currentMetadata.cameraModel ?? null,
      lens: closerNeighbor?.currentMetadata.lens ?? null,
      filmVendor: closerNeighbor?.currentMetadata.filmVendor ?? null,
      filmType: closerNeighbor?.currentMetadata.filmType ?? null,
      ...gps,
    };
    result.set(p.id, changes);
  }

  return result;
}

function pickCloserNeighbor(
  before: Photo | null,
  after: Photo | null,
): Photo | null {
  if (!before) return after;
  if (!after) return before;
  return before;
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

  const neighbor =
    before?.currentMetadata.gpsLat !== null ? before : after;
  if (!neighbor) return {};
  return {
    gpsLat: neighbor.currentMetadata.gpsLat,
    gpsLng: neighbor.currentMetadata.gpsLng,
  };
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
