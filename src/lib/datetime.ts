import { DateTime } from "luxon";

/**
 * The single place in the app that knows how timezones work.
 *
 * Photos carry a wall-clock date + time (what the camera showed) plus an IANA
 * zone name. The UTC offset is always *derived* from those three at the moment
 * it's needed — never stored as the source of truth, because a zone's offset
 * depends on the instant (DST). `utcOffset` in the DB is a frozen snapshot of
 * that derivation, written to EXIF; it is not authoritative.
 *
 * Nothing outside this module should construct a Date from photo metadata.
 */

/** Used when a photo has a date but no time set. */
const DEFAULT_TIME = "00:00:00";

/**
 * Build the instant for a wall-clock date + time interpreted in `zone`.
 *
 * DST edge cases follow luxon's defaults, which match how cameras behave:
 * - Ambiguous times (the repeated hour at fall-back) resolve to the *earlier*
 *   offset, i.e. still-DST. A camera that reads 01:30 twice recorded the first.
 * - Nonexistent times (the skipped hour at spring-forward) shift forward to the
 *   post-transition offset rather than becoming invalid.
 *
 * Returns null if the inputs don't parse or the zone is unknown.
 */
export function zonedInstant(
  date: string | null,
  time: string | null,
  zone: string | null
): DateTime | null {
  if (!date || !zone) return null;
  const dt = DateTime.fromISO(`${date}T${time ?? DEFAULT_TIME}`, { zone });
  return dt.isValid ? dt : null;
}

/**
 * The UTC offset ("-06:00") that applies to this photo, resolved at its actual
 * capture instant rather than at an arbitrary reference point in the day.
 */
export function utcOffsetFor(
  date: string | null,
  time: string | null,
  zone: string | null
): string | null {
  const dt = zonedInstant(date, time, zone);
  return dt ? dt.toFormat("ZZ") : null;
}

/** Unix epoch seconds for a wall-clock date + time in `zone`. */
export function toUtcSeconds(
  date: string | null,
  time: string | null,
  zone: string | null
): number | null {
  const dt = zonedInstant(date, time, zone);
  return dt ? Math.round(dt.toSeconds()) : null;
}

/** Milliseconds for a stored date + time + frozen offset, as written to EXIF. */
export function instantFromStoredOffset(
  date: string | null,
  time: string | null,
  utcOffset: string | null
): number | null {
  if (!date || !time || !utcOffset) return null;
  const dt = DateTime.fromISO(`${date}T${time}${utcOffset}`, { setZone: true });
  return dt.isValid ? dt.toMillis() : null;
}

/**
 * Shift a wall-clock time by whole hours *within its zone*, so crossing a DST
 * boundary moves by one wall-clock hour rather than a naive 3600 seconds.
 * Day rollover falls out of the zone arithmetic instead of being hand-rolled.
 */
export function shiftWallClock(
  date: string,
  time: string,
  zone: string | null,
  hours: number
): { date: string; time: string } | null {
  // With no zone we still want the increment to work; UTC gives DST-free
  // arithmetic with correct day rollover, which is the best available answer.
  const dt = zonedInstant(date, time, zone ?? "UTC");
  if (!dt) return null;
  const shifted = dt.plus({ hours });
  return { date: shifted.toFormat("yyyy-MM-dd"), time: shifted.toFormat("HH:mm:ss") };
}

/**
 * Which day a photo lands in when viewed through the working timezone.
 * Falls back to the raw capture date when the photo has no resolvable instant.
 */
export function dayKeyIn(
  date: string | null,
  time: string | null,
  utcOffset: string | null,
  workingZone: string
): string {
  if (!date) return "no-date";
  const millis = instantFromStoredOffset(date, time, utcOffset);
  if (millis === null) return date;
  const inZone = DateTime.fromMillis(millis, { zone: workingZone });
  return inZone.isValid ? inZone.toFormat("yyyy-MM-dd") : date;
}

/** Human date-block heading, e.g. "Friday, July 3, 2026". */
export function formatDayKey(dateKey: string): string {
  const dt = DateTime.fromISO(dateKey);
  return dt.isValid ? dt.toFormat("cccc, LLLL d, yyyy") : dateKey;
}

export type ZoneOffsetLabel = {
  /**
   * Zone abbreviation for the instant, e.g. "MDT" — or null for zones where
   * ICU has no real abbreviation and just echoes the offset ("GMT+9").
   */
  abbr: string | null;
  /** Offset for display, e.g. "UTC−6" or "UTC+5:30". */
  offset: string;
};

/** "MDT UTC−6", or just "UTC+9" where the zone has no distinct abbreviation. */
export function formatZoneOffset(label: ZoneOffsetLabel): string {
  return label.abbr ? `${label.abbr} ${label.offset}` : label.offset;
}

/** Render an offset in minutes as "UTC−6" / "UTC+5:30" (true minus sign). */
function formatOffsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "−" : "+";
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const mins = abs % 60;
  return mins === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${String(mins).padStart(2, "0")}`;
}

/**
 * Resolve display offsets for a set of zones against the dates currently in
 * play (typically the capture dates of the selected photos).
 *
 * A zone only gets a label when every supplied date resolves to the *same*
 * offset in that zone. If the selection straddles a DST transition — or has no
 * dates at all — the zone maps to null and callers show a bare name. Showing
 * "UTC−7" for a selection that is half MST and half MDT would be a lie for one
 * half of it, and there is no honest single number to print.
 */
export function resolveZoneOffsets(
  zones: string[],
  dates: Array<{ date: string; time: string | null }>
): Map<string, ZoneOffsetLabel | null> {
  const result = new Map<string, ZoneOffsetLabel | null>();
  if (dates.length === 0) {
    for (const zone of zones) result.set(zone, null);
    return result;
  }

  for (const zone of zones) {
    let label: ZoneOffsetLabel | null = null;
    let consistent = true;

    for (const { date, time } of dates) {
      const dt = zonedInstant(date, time, zone);
      if (!dt) {
        consistent = false;
        break;
      }
      const abbr = dt.offsetNameShort ?? "";
      const current: ZoneOffsetLabel = {
        // ICU falls back to "GMT+9" for zones without a real abbreviation;
        // that would just duplicate the offset we already render.
        abbr: /^(GMT|UTC)/.test(abbr) ? null : abbr,
        offset: formatOffsetLabel(dt.offset),
      };
      if (label === null) {
        label = current;
      } else if (label.offset !== current.offset || label.abbr !== current.abbr) {
        consistent = false;
        break;
      }
    }

    result.set(zone, consistent ? label : null);
  }

  return result;
}

/**
 * Today's local date, for resolving offsets on controls with no photo attached
 * (the global working timezone). Means the same zone can legitimately read
 * UTC−6 there and UTC−7 in the inspector when viewing a winter photo.
 */
export function todayDate(): { date: string; time: string | null } {
  return { date: DateTime.now().toFormat("yyyy-MM-dd"), time: null };
}

/** Distinct date+time pairs across photos, for feeding `resolveZoneOffsets`. */
export function distinctCaptureDates(
  photos: Array<{ currentMetadata: { captureDate: string | null; captureTime: string | null } }>
): Array<{ date: string; time: string | null }> {
  const seen = new Map<string, { date: string; time: string | null }>();
  for (const photo of photos) {
    const { captureDate, captureTime } = photo.currentMetadata;
    if (!captureDate) continue;
    const key = `${captureDate}T${captureTime ?? ""}`;
    if (!seen.has(key)) seen.set(key, { date: captureDate, time: captureTime });
  }
  return [...seen.values()];
}
