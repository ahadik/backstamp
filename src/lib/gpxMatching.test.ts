import { describe, it, expect } from "vitest";
import { wallClockToUtcSecs, matchToTrack, countMatches } from "./gpxMatching";
import type { TrackPoint } from "./tauri";

function pts(data: Array<[number, number, number]>): TrackPoint[] {
  return data.map(([timestamp, lat, lng]) => ({ timestamp, lat, lng }));
}

describe("wallClockToUtcSecs", () => {
  it("Pacific Standard Time (UTC-8)", () => {
    // noon PST = 20:00 UTC = 2024-01-15T20:00:00Z
    const result = wallClockToUtcSecs("2024-01-15", "12:00:00", "America/Los_Angeles");
    expect(result).toBe(1705348800);
  });

  it("Pacific Daylight Time (UTC-7)", () => {
    // noon PDT = 19:00 UTC = 2024-07-15T19:00:00Z
    const result = wallClockToUtcSecs("2024-07-15", "12:00:00", "America/Los_Angeles");
    expect(result).toBe(1721070000);
  });

  it("Tokyo (UTC+9, no DST)", () => {
    // 09:00 JST = 00:00 UTC
    const result = wallClockToUtcSecs("2024-03-15", "09:00:00", "Asia/Tokyo");
    expect(result).toBe(1710460800);
  });
});

describe("matchToTrack", () => {
  it("returns null for empty points", () => {
    expect(matchToTrack([], 50, 60)).toBeNull();
  });

  it("exact match", () => {
    const p = pts([[100, 37.0, -122.0]]);
    expect(matchToTrack(p, 100, 60)).toEqual({ lat: 37.0, lng: -122.0 });
  });

  it("within tolerance", () => {
    const p = pts([[100, 37.0, -122.0]]);
    expect(matchToTrack(p, 145, 60)).toEqual({ lat: 37.0, lng: -122.0 });
  });

  it("outside tolerance returns null", () => {
    const p = pts([[100, 37.0, -122.0]]);
    expect(matchToTrack(p, 200, 60)).toBeNull();
  });

  it("interpolation at midpoint", () => {
    const p = pts([[0, 0.0, 0.0], [100, 10.0, 10.0]]);
    const result = matchToTrack(p, 50, 60);
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(5.0, 3);
    expect(result!.lng).toBeCloseTo(5.0, 3);
  });
});

describe("countMatches", () => {
  it("counts photos with matching timestamps", () => {
    // Use UTC so wall-clock time = UTC time, avoiding tz conversion complexity
    const trackPoints = pts([[0, 37.0, -122.0], [60, 37.1, -122.1]]);
    const photos = [
      { currentMetadata: { captureDate: "1970-01-01", captureTime: "00:00:00", timezone: "UTC" } },
      { currentMetadata: { captureDate: "1970-01-01", captureTime: "00:01:00", timezone: "UTC" } },
      { currentMetadata: { captureDate: "1970-01-01", captureTime: "01:00:00", timezone: "UTC" } },
    ];
    const { matching, total } = countMatches(photos, trackPoints);
    expect(total).toBe(3);
    expect(matching).toBe(2);
  });

  it("skips photos without timezone", () => {
    const trackPoints = pts([[0, 37.0, -122.0]]);
    const photos = [
      { currentMetadata: { captureDate: "1970-01-01", captureTime: "00:00:00", timezone: null } },
      { currentMetadata: { captureDate: "1970-01-01", captureTime: "00:00:00", timezone: "UTC" } },
    ];
    const { matching, total } = countMatches(photos, trackPoints);
    expect(total).toBe(1);
    expect(matching).toBe(1);
  });
});
