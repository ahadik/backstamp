import { getUtcOffset } from "./timezone";
import type { Photo } from "../state/SessionContext";
import type { ApplyPayload } from "./tauri";

export function buildApplyPayload(photos: Photo[]): ApplyPayload {
  const changes: ApplyPayload["changes"] = {};
  for (const photo of photos) {
    if (!photo.pendingChanges) continue;
    const p = photo.pendingChanges;

    const hasPendingDate = "captureDate" in p;
    const hasPendingTime = "captureTime" in p;

    // Rust needs both date and time to write DateTimeOriginal. When only one is
    // being changed, supplement the other from currentMetadata so neither is lost.
    const supplement: { captureDate?: string | null; captureTime?: string | null } = {};
    if (hasPendingTime && !hasPendingDate && photo.currentMetadata.captureDate !== null) {
      supplement.captureDate = photo.currentMetadata.captureDate;
    }
    if (hasPendingDate && !hasPendingTime) {
      supplement.captureTime = photo.currentMetadata.captureTime;
    }

    const effectiveDateStr = hasPendingDate ? p.captureDate : (supplement.captureDate ?? null);
    const effectiveTimezone = ("timezone" in p ? p.timezone : null) ?? photo.currentMetadata.timezone;
    const utcOffset =
      effectiveTimezone && effectiveDateStr
        ? getUtcOffset(effectiveTimezone, new Date(effectiveDateStr))
        : null;

    changes[photo.id] = { ...p, ...supplement, utcOffset };
  }
  return { changes };
}
