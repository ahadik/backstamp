import { describe, it, expect } from "vitest";
import {
  utcOffsetFor,
  toUtcSeconds,
  shiftWallClock,
  dayKeyIn,
  instantFromStoredOffset,
  resolveZoneOffsets,
  distinctCaptureDates,
  zonedInstant,
  formatZoneOffset,
} from "./datetime";

// ── utcOffsetFor ──────────────────────────────────────────────────────────────

describe("utcOffsetFor", () => {
  it("resolves the seasonal offset, not the zone's standard offset", () => {
    // The bug this module exists to fix: Denver is UTC-7 in January but UTC-6
    // in July. A list labelled "UTC-7 US Mountain" is wrong half the year.
    expect(utcOffsetFor("2026-01-15", "12:00:00", "America/Denver")).toBe("-07:00");
    expect(utcOffsetFor("2026-07-03", "12:00:00", "America/Denver")).toBe("-06:00");
  });

  it("keeps Arizona on standard time year round", () => {
    expect(utcOffsetFor("2026-01-15", "12:00:00", "America/Phoenix")).toBe("-07:00");
    expect(utcOffsetFor("2026-07-03", "12:00:00", "America/Phoenix")).toBe("-07:00");
  });

  it("resolves against the capture instant, not midnight of the capture date", () => {
    // 2026-11-01 is the US fall-back date. Before 02:00 local the zone is still
    // MDT; after, it is MST. Resolving at midnight UTC (as the old code did)
    // landed on the previous evening and returned -06:00 for the whole day.
    expect(utcOffsetFor("2026-11-01", "01:00:00", "America/Denver")).toBe("-06:00");
    expect(utcOffsetFor("2026-11-01", "15:00:00", "America/Denver")).toBe("-07:00");
  });

  it("handles the spring-forward transition", () => {
    expect(utcOffsetFor("2026-03-08", "01:00:00", "America/Denver")).toBe("-07:00");
    expect(utcOffsetFor("2026-03-08", "15:00:00", "America/Denver")).toBe("-06:00");
  });

  it("handles European transitions, which fall on different dates", () => {
    // EU switches on the last Sunday in March, three weeks after the US.
    expect(utcOffsetFor("2026-03-15", "12:00:00", "Europe/Paris")).toBe("+01:00");
    expect(utcOffsetFor("2026-04-15", "12:00:00", "Europe/Paris")).toBe("+02:00");
  });

  it("handles southern-hemisphere DST, which runs the other way", () => {
    expect(utcOffsetFor("2026-01-15", "12:00:00", "Australia/Sydney")).toBe("+11:00");
    expect(utcOffsetFor("2026-07-15", "12:00:00", "Australia/Sydney")).toBe("+10:00");
    expect(utcOffsetFor("2026-01-15", "12:00:00", "Australia/Brisbane")).toBe("+10:00");
  });

  it("handles half-hour offsets", () => {
    expect(utcOffsetFor("2026-07-03", "12:00:00", "Asia/Kolkata")).toBe("+05:30");
  });

  it("defaults to midnight when no time is set", () => {
    expect(utcOffsetFor("2026-07-03", null, "America/Denver")).toBe("-06:00");
  });

  it("returns null rather than silently falling back to UTC", () => {
    // The old implementation returned "+00:00" for an unknown zone, which
    // quietly mis-tagged photos instead of surfacing the problem.
    expect(utcOffsetFor("2026-07-03", "12:00:00", "Not/A/Timezone")).toBeNull();
    expect(utcOffsetFor(null, "12:00:00", "America/Denver")).toBeNull();
    expect(utcOffsetFor("2026-07-03", "12:00:00", null)).toBeNull();
  });
});

// ── zonedInstant DST edge cases ───────────────────────────────────────────────

describe("zonedInstant", () => {
  it("resolves the ambiguous fall-back hour to the earlier (DST) offset", () => {
    // 01:30 happens twice on 2026-11-01 in Denver. We take the first.
    const dt = zonedInstant("2026-11-01", "01:30:00", "America/Denver");
    expect(dt?.toFormat("ZZ")).toBe("-06:00");
  });

  it("shifts the nonexistent spring-forward hour rather than failing", () => {
    // 02:30 does not exist on 2026-03-08 in Denver; clocks jump 02:00 -> 03:00.
    const dt = zonedInstant("2026-03-08", "02:30:00", "America/Denver");
    expect(dt).not.toBeNull();
    expect(dt?.toFormat("ZZ")).toBe("-06:00");
  });
});

// ── toUtcSeconds ──────────────────────────────────────────────────────────────

describe("toUtcSeconds", () => {
  it("converts wall clock in a zone to epoch seconds", () => {
    expect(toUtcSeconds("2024-01-15", "12:00:00", "America/Los_Angeles")).toBe(1705348800);
    expect(toUtcSeconds("2024-07-15", "12:00:00", "America/Los_Angeles")).toBe(1721070000);
  });

  it("returns null for an unusable zone", () => {
    expect(toUtcSeconds("2024-01-15", "12:00:00", "Not/A/Timezone")).toBeNull();
  });
});

// ── shiftWallClock ────────────────────────────────────────────────────────────

describe("shiftWallClock", () => {
  it("rolls over to the next day", () => {
    expect(shiftWallClock("2026-11-01", "23:30:00", "America/Denver", 1)).toEqual({
      date: "2026-11-02",
      time: "00:30:00",
    });
  });

  it("rolls back to the previous day", () => {
    expect(shiftWallClock("2026-11-02", "00:30:00", "America/Denver", -1)).toEqual({
      date: "2026-11-01",
      time: "23:30:00",
    });
  });

  it("rolls the day over in the photo's zone, not the machine's", () => {
    // The previous implementation parsed the date as machine-local and read it
    // back via toISOString (UTC), so the day increment silently vanished for
    // anyone whose OS timezone was east of UTC. Doing the arithmetic in the
    // photo's own zone makes the machine's timezone irrelevant.
    expect(shiftWallClock("2026-11-01", "23:00:00", "Asia/Tokyo", 2)).toEqual({
      date: "2026-11-02",
      time: "01:00:00",
    });
    expect(shiftWallClock("2026-11-02", "01:00:00", "Pacific/Auckland", -2)).toEqual({
      date: "2026-11-01",
      time: "23:00:00",
    });
  });

  it("moves by wall-clock hours across a DST boundary", () => {
    // 01:30 MDT + 1h lands on 01:30 MST — the same wall-clock hour repeats.
    // A naive +3600s would print 02:30 and skip an hour of real time.
    expect(shiftWallClock("2026-11-01", "01:30:00", "America/Denver", 1)).toEqual({
      date: "2026-11-01",
      time: "01:30:00",
    });
  });

  it("skips the nonexistent hour at spring forward", () => {
    expect(shiftWallClock("2026-03-08", "01:30:00", "America/Denver", 1)).toEqual({
      date: "2026-03-08",
      time: "03:30:00",
    });
  });

  it("still works for photos with no timezone set", () => {
    expect(shiftWallClock("2026-06-15", "23:00:00", null, 2)).toEqual({
      date: "2026-06-16",
      time: "01:00:00",
    });
  });
});

// ── dayKeyIn ──────────────────────────────────────────────────────────────────

describe("dayKeyIn", () => {
  it("buckets by the working timezone", () => {
    // 23:00 in Tokyo is still the 14th in New York.
    expect(dayKeyIn("2024-03-15", "09:00:00", "+09:00", "America/New_York")).toBe("2024-03-14");
    expect(dayKeyIn("2024-03-15", "09:00:00", "+09:00", "Asia/Tokyo")).toBe("2024-03-15");
  });

  it("falls back to the raw capture date without a usable instant", () => {
    expect(dayKeyIn("2024-03-15", null, "+09:00", "America/New_York")).toBe("2024-03-15");
    expect(dayKeyIn("2024-03-15", "09:00:00", null, "America/New_York")).toBe("2024-03-15");
    expect(dayKeyIn("2024-03-15", "09:00:00", "+09:00", "Not/A/Timezone")).toBe("2024-03-15");
  });

  it("reports no-date when there is no capture date", () => {
    expect(dayKeyIn(null, "09:00:00", "+09:00", "UTC")).toBe("no-date");
  });
});

describe("instantFromStoredOffset", () => {
  it("honours the stored offset rather than the machine timezone", () => {
    expect(instantFromStoredOffset("2024-01-15", "12:00:00", "-08:00")).toBe(1705348800000);
  });

  it("returns null when any part is missing or unparseable", () => {
    expect(instantFromStoredOffset("2024-01-15", null, "-08:00")).toBeNull();
    expect(instantFromStoredOffset("not-a-date", "12:00:00", "-08:00")).toBeNull();
  });
});

// ── resolveZoneOffsets ────────────────────────────────────────────────────────

describe("resolveZoneOffsets", () => {
  it("labels a zone with the offset for the date in play", () => {
    const summer = resolveZoneOffsets(["America/Denver"], [{ date: "2026-07-03", time: "12:00:00" }]);
    expect(summer.get("America/Denver")).toEqual({ abbr: "MDT", offset: "UTC−6" });

    const winter = resolveZoneOffsets(["America/Denver"], [{ date: "2026-01-15", time: "12:00:00" }]);
    expect(winter.get("America/Denver")).toEqual({ abbr: "MST", offset: "UTC−7" });
  });

  it("formats half-hour offsets", () => {
    const result = resolveZoneOffsets(["Asia/Kolkata"], [{ date: "2026-07-03", time: "12:00:00" }]);
    expect(result.get("Asia/Kolkata")?.offset).toBe("UTC+5:30");
  });

  it("drops the offset when the selection straddles a DST transition", () => {
    const result = resolveZoneOffsets(
      ["America/Denver"],
      [
        { date: "2026-01-15", time: "12:00:00" },
        { date: "2026-07-03", time: "12:00:00" },
      ]
    );
    expect(result.get("America/Denver")).toBeNull();
  });

  it("keeps offsets for zones the straddling selection doesn't affect", () => {
    // Tokyo has one offset all year, so a mixed-season selection is still
    // unambiguous there — hiding it would discard correct information.
    const result = resolveZoneOffsets(
      ["America/Denver", "Asia/Tokyo"],
      [
        { date: "2026-01-15", time: "12:00:00" },
        { date: "2026-07-03", time: "12:00:00" },
      ]
    );
    expect(result.get("America/Denver")).toBeNull();
    expect(result.get("Asia/Tokyo")).toEqual({ abbr: null, offset: "UTC+9" });
  });

  it("keeps the offset for dates on the same side of a transition", () => {
    const result = resolveZoneOffsets(
      ["America/Denver"],
      [
        { date: "2026-07-01", time: "09:00:00" },
        { date: "2026-07-03", time: "18:00:00" },
      ]
    );
    expect(result.get("America/Denver")).toEqual({ abbr: "MDT", offset: "UTC−6" });
  });

  it("returns bare zones when there are no dates to resolve against", () => {
    const result = resolveZoneOffsets(["America/Denver"], []);
    expect(result.get("America/Denver")).toBeNull();
  });

  it("returns bare zones for unknown timezone names", () => {
    const result = resolveZoneOffsets(["Not/A/Timezone"], [{ date: "2026-07-03", time: null }]);
    expect(result.get("Not/A/Timezone")).toBeNull();
  });
});

describe("formatZoneOffset", () => {
  it("pairs a real abbreviation with the offset", () => {
    expect(formatZoneOffset({ abbr: "MDT", offset: "UTC−6" })).toBe("MDT UTC−6");
  });

  it("shows the offset alone when the zone has no abbreviation", () => {
    expect(formatZoneOffset({ abbr: null, offset: "UTC+9" })).toBe("UTC+9");
  });
});

describe("distinctCaptureDates", () => {
  const photo = (captureDate: string | null, captureTime: string | null) => ({
    currentMetadata: { captureDate, captureTime },
  });

  it("dedupes identical date/time pairs and skips undated photos", () => {
    expect(
      distinctCaptureDates([
        photo("2026-07-03", "12:00:00"),
        photo("2026-07-03", "12:00:00"),
        photo("2026-07-04", "12:00:00"),
        photo(null, "12:00:00"),
      ])
    ).toEqual([
      { date: "2026-07-03", time: "12:00:00" },
      { date: "2026-07-04", time: "12:00:00" },
    ]);
  });

  it("treats a missing time as distinct from a set one", () => {
    expect(distinctCaptureDates([photo("2026-07-03", null), photo("2026-07-03", "12:00:00")])).toHaveLength(2);
  });
});
