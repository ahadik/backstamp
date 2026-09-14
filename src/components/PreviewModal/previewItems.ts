import { filterPhotos, groupPhotosByDay, flatOrderedIds } from "../../state/selectors";
import type { PhotoFilters } from "../../state/selectors";
import type { Photo, GpxFile } from "../../state/SessionContext";

/**
 * Selected photos in the order the grid displays them, so stepping through
 * the preview follows what the user sees rather than click order.
 */
export function selectedPhotosInGridOrder(
  photos: Photo[],
  selectedIds: Set<string>,
  filters: PhotoFilters,
  workingTimezone: string
): Photo[] {
  if (selectedIds.size === 0) return [];
  const visible = filterPhotos(photos, filters, workingTimezone);
  const byId = new Map(visible.map((p) => [p.id, p]));
  return flatOrderedIds(groupPhotosByDay(visible, workingTimezone))
    .filter((id) => selectedIds.has(id))
    .map((id) => byId.get(id)!);
}

export function selectedGpxFiles(gpxFiles: GpxFile[], selectedGpxIds: Set<string>): GpxFile[] {
  if (selectedGpxIds.size === 0) return [];
  return gpxFiles.filter((g) => selectedGpxIds.has(g.id));
}

/** Quick Look-style stepping: stops at either end rather than wrapping. */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

/**
 * Keys the preview must leave alone: a space typed into a field, or a space
 * activating a focused button (e.g. inside a confirmation dialog).
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    tag === "BUTTON" ||
    target.isContentEditable === true
  );
}

export function fileNameOf(filePath: string): string {
  return filePath.split("/").pop() ?? filePath;
}
