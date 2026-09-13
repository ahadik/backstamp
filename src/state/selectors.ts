import { dayKeyIn, formatDayKey, instantFromStoredOffset } from "../lib/datetime";
import type { Metadata, Photo } from "./SessionContext";

export type DayBlock = {
  dateKey: string;
  label: string;
  photos: Photo[];
};

export function groupPhotosByDay(photos: Photo[], workingTimezone: string): DayBlock[] {
  const map = new Map<string, Photo[]>();

  for (const photo of photos) {
    const dateKey = getDateKey(photo, workingTimezone);
    const bucket = map.get(dateKey) ?? [];
    bucket.push(photo);
    map.set(dateKey, bucket);
  }

  for (const bucket of map.values()) {
    bucket.sort(comparePhotos);
  }

  const keys = [...map.keys()].sort((a, b) => {
    if (a === "no-date") return -1;
    if (b === "no-date") return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  return keys.map((dateKey) => ({
    dateKey,
    label: formatLabel(dateKey),
    photos: map.get(dateKey)!,
  }));
}

export function flatOrderedIds(blocks: DayBlock[]): string[] {
  return blocks.flatMap((b) => b.photos.map((p) => p.id));
}

export function getDateKey(photo: Photo, workingTimezone: string): string {
  const { captureDate, captureTime, utcOffset } = photo.currentMetadata;
  return dayKeyIn(captureDate, captureTime, utcOffset, workingTimezone);
}

function toUTCMillis(photo: Photo): number | null {
  const { captureDate, captureTime, utcOffset } = photo.currentMetadata;
  return instantFromStoredOffset(captureDate, captureTime, utcOffset);
}

function comparePhotos(a: Photo, b: Photo): number {
  const ma = toUTCMillis(a);
  const mb = toUTCMillis(b);
  if (ma !== null && mb !== null) {
    if (ma !== mb) return ma - mb;
    return a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0;
  }
  // Fallback: use date+time string so date contributes to order, not just time
  const sa = toDateTimeString(a);
  const sb = toDateTimeString(b);
  if (sa === null && sb === null) return a.filePath < b.filePath ? -1 : 1;
  if (sa === null) return 1;
  if (sb === null) return -1;
  if (sa !== sb) return sa < sb ? -1 : 1;
  return a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0;
}

function toDateTimeString(photo: Photo): string | null {
  const { captureDate, captureTime } = photo.currentMetadata;
  if (!captureTime) return null;
  return captureDate ? `${captureDate}T${captureTime}` : captureTime;
}

export function formatLabel(dateKey: string): string {
  if (dateKey === "no-date") return "No Date";
  return formatDayKey(dateKey);
}

/**
 * Session-level photo filters. Dates are inclusive day keys ("YYYY-MM-DD") in
 * the working timezone; `cameras` holds camera keys (see cameraKeyOf), with
 * null meaning "no camera filter" — distinct from [] so an emptied checkbox
 * list falls back to showing everything rather than nothing.
 */
export interface PhotoFilters {
  dateAfter: string | null;
  dateBefore: string | null;
  cameras: string[] | null;
}

export const EMPTY_PHOTO_FILTERS: PhotoFilters = {
  dateAfter: null,
  dateBefore: null,
  cameras: null,
};

export function hasActiveFilters(filters: PhotoFilters): boolean {
  return (
    filters.dateAfter !== null ||
    filters.dateBefore !== null ||
    (filters.cameras !== null && filters.cameras.length > 0)
  );
}

// Unit separator keeps make "Canon EOS" + model "R5" distinct from make "Canon" + model "EOS R5".
const CAMERA_KEY_SEP = "\u001f";

/** Key for a photo's camera identity; photos with neither make nor model share NO_CAMERA_KEY. */
export const NO_CAMERA_KEY = CAMERA_KEY_SEP;

export function cameraKeyOf(meta: Metadata): string {
  return `${meta.cameraMake ?? ""}${CAMERA_KEY_SEP}${meta.cameraModel ?? ""}`;
}

export function cameraLabelOf(meta: Metadata): string {
  const parts = [meta.cameraMake, meta.cameraModel].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : "No camera";
}

export interface CameraOption {
  key: string;
  label: string;
  count: number;
}

/**
 * Distinct camera values across the full photo set, sorted by label with
 * "No camera" last — the checkbox list offered by the camera filter panel.
 */
export function cameraOptionsFrom(photos: Photo[]): CameraOption[] {
  const byKey = new Map<string, CameraOption>();
  for (const photo of photos) {
    const key = cameraKeyOf(photo.currentMetadata);
    const existing = byKey.get(key);
    if (existing) existing.count += 1;
    else byKey.set(key, { key, label: cameraLabelOf(photo.currentMetadata), count: 1 });
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.key === NO_CAMERA_KEY) return 1;
    if (b.key === NO_CAMERA_KEY) return -1;
    return a.label.localeCompare(b.label);
  });
}

/** Earliest and latest day keys across the photo set, for date input bounds. */
export function photoDateRange(
  photos: Photo[],
  workingTimezone: string
): { min: string; max: string } | null {
  let min: string | null = null;
  let max: string | null = null;
  for (const photo of photos) {
    const key = getDateKey(photo, workingTimezone);
    if (key === "no-date") continue;
    if (min === null || key < min) min = key;
    if (max === null || key > max) max = key;
  }
  return min !== null && max !== null ? { min, max } : null;
}

/**
 * Photos passing the active filters. Date bounds compare the same working-
 * timezone day key that drives grid grouping, so a filtered day matches its
 * day-block header exactly; photos without a resolvable date are excluded
 * whenever a date bound is set.
 */
export function filterPhotos(
  photos: Photo[],
  filters: PhotoFilters,
  workingTimezone: string
): Photo[] {
  if (!hasActiveFilters(filters)) return photos;
  const cameraSet =
    filters.cameras !== null && filters.cameras.length > 0 ? new Set(filters.cameras) : null;
  return photos.filter((photo) => {
    if (filters.dateAfter !== null || filters.dateBefore !== null) {
      const key = getDateKey(photo, workingTimezone);
      if (key === "no-date") return false;
      if (filters.dateAfter !== null && key < filters.dateAfter) return false;
      if (filters.dateBefore !== null && key > filters.dateBefore) return false;
    }
    if (cameraSet && !cameraSet.has(cameraKeyOf(photo.currentMetadata))) return false;
    return true;
  });
}
