import type { Photo } from "./SessionContext";

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
  if (!captureDate) return "no-date";
  if (!utcOffset || !captureTime) return captureDate;
  try {
    const date = new Date(`${captureDate}T${captureTime}${utcOffset}`);
    if (isNaN(date.getTime())) return captureDate;
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: workingTimezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return captureDate;
  }
}

function comparePhotos(a: Photo, b: Photo): number {
  const ta = a.currentMetadata.captureTime;
  const tb = b.currentMetadata.captureTime;
  if (ta === null && tb === null) return a.filePath < b.filePath ? -1 : 1;
  if (ta === null) return 1;
  if (tb === null) return -1;
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0;
}

export function formatLabel(dateKey: string): string {
  if (dateKey === "no-date") return "No Date";
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
