import { utcOffsetFor } from "./datetime";
import type { Photo } from "../state/SessionContext";
import type { ApplyPayload } from "./tauri";

export function buildApplyPayload(photos: Photo[]): ApplyPayload {
  const changes: ApplyPayload["changes"] = {};
  for (const photo of photos) {
    if (!photo.pendingChanges) continue;
    const p = photo.pendingChanges;

    const hasPendingDate = "captureDate" in p;
    const hasPendingTime = "captureTime" in p;
    const hasPendingTimezone = "timezone" in p;

    // Rust needs both date and time to write DateTimeOriginal. When only one is
    // being changed, supplement the other from currentMetadata so neither is lost.
    const supplement: { captureDate?: string | null; captureTime?: string | null } = {};
    if (hasPendingTime && !hasPendingDate && photo.currentMetadata.captureDate !== null) {
      supplement.captureDate = photo.currentMetadata.captureDate;
    }
    if (hasPendingDate && !hasPendingTime) {
      supplement.captureTime = photo.currentMetadata.captureTime;
    }

    // Resolve the offset against the full capture instant, not just the date:
    // on a DST transition day the offset differs before and after the switch.
    const effectiveDate = hasPendingDate
      ? (p.captureDate ?? null)
      : (supplement.captureDate ?? photo.currentMetadata.captureDate);
    const effectiveTime = hasPendingTime
      ? (p.captureTime ?? null)
      : (supplement.captureTime ?? photo.currentMetadata.captureTime);
    const effectiveTimezone = (hasPendingTimezone ? p.timezone : null) ?? photo.currentMetadata.timezone;

    const utcOffset = utcOffsetFor(effectiveDate, effectiveTime, effectiveTimezone);

    const utcOffsetChanged = hasPendingDate || hasPendingTime || hasPendingTimezone;
    changes[photo.id] = { ...p, ...supplement, ...(utcOffsetChanged ? { utcOffset } : {}) };
  }
  return { changes };
}
