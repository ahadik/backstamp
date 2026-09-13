import { describe, it, expect } from "vitest";
import {
  nearestPointOnTrack,
  nearestPointOnTracks,
  buildScrubChanges,
  planScrubApply,
  scrubConfirmMessage,
  formatSnapTime,
  type ScrubSnap,
} from "./trackScrub";
import { initialMetadata } from "../state/SessionContext";
import type { Photo, Metadata } from "../state/SessionContext";
import type { TrackPoint } from "./tauri";

function pts(data: Array<[number, number, number]>): TrackPoint[] {
  return data.map(([timestamp, lat, lng]) => ({ timestamp, lat, lng }));
}

function photo(id: string, meta: Partial<Metadata> = {}): Photo {
  return {
    id,
    filePath: `/${id}.jpg`,
    fileStatus: "ok",
    thumbnail: { small: "", large: "" },
    originalMetadata: { ...initialMetadata },
    currentMetadata: { ...initialMetadata, ...meta },
    pendingChanges: null,
  };
}

describe("nearestPointOnTrack", () => {
  it("returns null for empty points", () => {
    expect(nearestPointOnTrack([], { lng: 0, lat: 0 })).toBeNull();
  });

  it("snaps to a single point with its timestamp", () => {
    const p = pts([[100, 37.0, -122.0]]);
    const near = nearestPointOnTrack(p, { lng: -122.1, lat: 37.0 })!;
    expect(near.lat).toBe(37.0);
    expect(near.lng).toBe(-122.0);
    expect(near.timestampUtcSecs).toBe(100);
  });

  it("interpolates position and timestamp along a segment", () => {
    // Horizontal segment along the equator; cursor above the midpoint.
    const p = pts([
      [1000, 0, 0],
      [2000, 0, 1],
    ]);
    const near = nearestPointOnTrack(p, { lng: 0.5, lat: 0.1 })!;
    expect(near.lng).toBeCloseTo(0.5, 6);
    expect(near.lat).toBeCloseTo(0, 6);
    expect(near.timestampUtcSecs).toBe(1500);
  });

  it("clamps to a segment endpoint when the cursor is beyond it", () => {
    const p = pts([
      [1000, 0, 0],
      [2000, 0, 1],
    ]);
    const near = nearestPointOnTrack(p, { lng: -0.5, lat: 0 })!;
    expect(near.lng).toBe(0);
    expect(near.lat).toBe(0);
    expect(near.timestampUtcSecs).toBe(1000);
  });

  it("picks the nearest of several segments", () => {
    // An L-shaped track; the cursor sits close to the second leg.
    const p = pts([
      [0, 0, 0],
      [100, 0, 1],
      [200, 1, 1],
    ]);
    const near = nearestPointOnTrack(p, { lng: 1.01, lat: 0.5 })!;
    expect(near.lng).toBeCloseTo(1, 6);
    expect(near.lat).toBeCloseTo(0.5, 6);
    expect(near.timestampUtcSecs).toBe(150);
  });

  it("handles duplicate consecutive points (zero-length segment)", () => {
    const p = pts([
      [1000, 0, 0],
      [2000, 0, 0],
    ]);
    const near = nearestPointOnTrack(p, { lng: 0.1, lat: 0 })!;
    expect(near.lng).toBe(0);
    expect(near.timestampUtcSecs).toBe(1000);
  });

  it("degrades to location-only when timestamps are not finite", () => {
    const p: TrackPoint[] = [
      { timestamp: NaN, lat: 0, lng: 0 },
      { timestamp: NaN, lat: 0, lng: 1 },
    ];
    const near = nearestPointOnTrack(p, { lng: 0.5, lat: 0 })!;
    expect(near.lng).toBeCloseTo(0.5, 6);
    expect(near.timestampUtcSecs).toBeNull();
  });
});

describe("nearestPointOnTracks", () => {
  it("returns null when no track has points", () => {
    expect(nearestPointOnTracks([{ id: "g1", points: [] }], { lng: 0, lat: 0 })).toBeNull();
  });

  it("picks the closest track and reports its id", () => {
    const far = { id: "far", points: pts([[0, 5, 5]]) };
    const near = {
      id: "near",
      points: pts([
        [1000, 0, 0],
        [2000, 0, 1],
      ]),
    };
    const snap = nearestPointOnTracks([far, near], { lng: 0.5, lat: 0.01 })!;
    expect(snap.gpxId).toBe("near");
    expect(snap.lng).toBeCloseTo(0.5, 6);
    expect(snap.timestampUtcSecs).toBe(1500);
  });
});

describe("buildScrubChanges", () => {
  const snap = { lat: 37.5, lng: -122.5, timestampUtcSecs: 1705348800 }; // 2024-01-15T20:00:00Z

  it("uses the photo's own timezone when set", () => {
    const [u] = buildScrubChanges([photo("p1", { timezone: "Asia/Tokyo" })], snap, "America/Los_Angeles");
    expect(u.changes).toEqual({
      gpsLat: 37.5,
      gpsLng: -122.5,
      captureDate: "2024-01-16",
      captureTime: "05:00:00",
      timezone: "Asia/Tokyo",
      utcOffset: "+09:00",
    });
  });

  it("falls back to the GPX timezone, then UTC", () => {
    const [viaGpx] = buildScrubChanges([photo("p1")], snap, "America/Los_Angeles");
    expect(viaGpx.changes.captureDate).toBe("2024-01-15");
    expect(viaGpx.changes.captureTime).toBe("12:00:00");
    expect(viaGpx.changes.timezone).toBe("America/Los_Angeles");
    expect(viaGpx.changes.utcOffset).toBe("-08:00");

    const [viaUtc] = buildScrubChanges([photo("p1")], snap, null);
    expect(viaUtc.changes.captureTime).toBe("20:00:00");
    expect(viaUtc.changes.timezone).toBe("UTC");
    expect(viaUtc.changes.utcOffset).toBe("+00:00");
  });

  it("sets location only when the snap has no timestamp", () => {
    const [u] = buildScrubChanges([photo("p1")], { ...snap, timestampUtcSecs: null }, "UTC");
    expect(u.changes).toEqual({ gpsLat: 37.5, gpsLng: -122.5 });
  });

  it("resolves the timezone per photo across a mixed selection", () => {
    const updates = buildScrubChanges(
      [photo("p1", { timezone: "Asia/Tokyo" }), photo("p2")],
      snap,
      "America/Los_Angeles"
    );
    expect(updates[0].changes.timezone).toBe("Asia/Tokyo");
    expect(updates[1].changes.timezone).toBe("America/Los_Angeles");
  });
});

describe("planScrubApply", () => {
  const snap: ScrubSnap = { gpxId: "g1", lat: 1, lng: 2, timestampUtcSecs: 1000 };

  it("applies silently for one photo with nothing to replace", () => {
    const plan = planScrubApply([photo("p1")], snap, null);
    expect(plan.confirm).toBeNull();
    expect(plan.updates).toHaveLength(1);
  });

  it("confirms for one photo with an existing time", () => {
    const plan = planScrubApply([photo("p1", { captureDate: "2024-01-01" })], snap, null);
    expect(plan.confirm).toEqual({ photoCount: 1, overwriteCount: 1, setsTime: true });
  });

  it("confirms for one photo with an existing location", () => {
    const plan = planScrubApply([photo("p1", { gpsLat: 5, gpsLng: 6 })], snap, null);
    expect(plan.confirm?.overwriteCount).toBe(1);
  });

  it("always confirms for more than one photo", () => {
    const plan = planScrubApply([photo("p1"), photo("p2")], snap, null);
    expect(plan.confirm).toEqual({ photoCount: 2, overwriteCount: 0, setsTime: true });
  });

  it("ignores existing time when the snap sets location only", () => {
    const locationOnly: ScrubSnap = { ...snap, timestampUtcSecs: null };
    const plan = planScrubApply([photo("p1", { captureDate: "2024-01-01" })], locationOnly, null);
    expect(plan.confirm).toBeNull();
  });
});

describe("scrubConfirmMessage", () => {
  it("single photo overwrite", () => {
    expect(scrubConfirmMessage({ photoCount: 1, overwriteCount: 1, setsTime: true })).toBe(
      "This photo already has a time or location set. Replace it with this track point?"
    );
  });

  it("multiple photos, no overwrites", () => {
    expect(scrubConfirmMessage({ photoCount: 3, overwriteCount: 0, setsTime: true })).toBe(
      "Set the time and location of 3 photos to this track point?"
    );
  });

  it("multiple photos with overwrites", () => {
    expect(scrubConfirmMessage({ photoCount: 3, overwriteCount: 2, setsTime: true })).toBe(
      "Set the time and location of 3 photos to this track point? 2 of them already have existing values that will be replaced."
    );
  });

  it("location-only wording", () => {
    expect(scrubConfirmMessage({ photoCount: 2, overwriteCount: 1, setsTime: false })).toBe(
      "Set the location of 2 photos to this track point? 1 of them already has existing values that will be replaced."
    );
  });
});

describe("formatSnapTime", () => {
  it("formats in the given zone", () => {
    // 2024-01-15T20:00:00Z = noon PST
    expect(formatSnapTime(1705348800, "America/Los_Angeles")).toMatch(/Jan 15.*12:00:00 PM/);
  });

  it("falls back to UTC for null or invalid zones", () => {
    expect(formatSnapTime(1705348800, null)).toMatch(/8:00:00 PM/);
    expect(formatSnapTime(1705348800, "Not/AZone")).toMatch(/8:00:00 PM/);
  });
});
