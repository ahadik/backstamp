import { describe, it, expect } from "vitest";
import { matchToTrack, matchToTracks, countMatches } from "./gpxMatching";
import { toUtcSeconds } from "./datetime";
import type { TrackPoint } from "./tauri";

function pts(data: Array<[number, number, number]>): TrackPoint[] {
  return data.map(([timestamp, lat, lng]) => ({ timestamp, lat, lng }));
}

describe("toUtcSeconds", () => {
  it("Pacific Standard Time (UTC-8)", () => {
    // noon PST = 20:00 UTC = 2024-01-15T20:00:00Z
    const result = toUtcSeconds("2024-01-15", "12:00:00", "America/Los_Angeles");
    expect(result).toBe(1705348800);
  });

  it("Pacific Daylight Time (UTC-7)", () => {
    // noon PDT = 19:00 UTC = 2024-07-15T19:00:00Z
    const result = toUtcSeconds("2024-07-15", "12:00:00", "America/Los_Angeles");
    expect(result).toBe(1721070000);
  });

  it("Tokyo (UTC+9, no DST)", () => {
    // 09:00 JST = 00:00 UTC
    const result = toUtcSeconds("2024-03-15", "09:00:00", "Asia/Tokyo");
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

  it("interpolates across a recording gap far wider than the tolerance", () => {
    // A logger that auto-paused mid-track (the Nizina kayak case): the photo
    // falls in a 28-minute hole. Inside a single track we always interpolate.
    const p = pts([[0, 61.0, -142.0], [1680, 61.2, -142.2]]);
    const result = matchToTrack(p, 840, 60);
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(61.1, 6);
    expect(result!.lng).toBeCloseTo(-142.1, 6);
  });

  it("still applies the tolerance beyond the track's ends", () => {
    const p = pts([[100, 37.0, -122.0], [200, 37.1, -122.1]]);
    expect(matchToTrack(p, 30, 60)).toBeNull();
    expect(matchToTrack(p, 55, 60)).toEqual({ lat: 37.0, lng: -122.0 });
    expect(matchToTrack(p, 255, 60)).toEqual({ lat: 37.1, lng: -122.1 });
    expect(matchToTrack(p, 265, 60)).toBeNull();
  });
});

describe("matchToTracks", () => {
  it("never interpolates between separate tracks", () => {
    // Two tracks with a target between them. Flattened, the old code would have
    // interpolated day 1's end to day 2's start — a path no device recorded.
    const day1 = pts([[0, 61.0, -142.0], [100, 61.1, -142.1]]);
    const day2 = pts([[10000, 62.0, -143.0], [10100, 62.1, -143.1]]);
    expect(matchToTracks([day1, day2], 5000, 60)).toBeNull();
  });

  it("interpolates inside whichever track spans the target", () => {
    const day1 = pts([[0, 61.0, -142.0], [1000, 61.2, -142.2]]);
    const day2 = pts([[10000, 62.0, -143.0], [10100, 62.1, -143.1]]);
    const result = matchToTracks([day1, day2], 500, 60);
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(61.1, 6);
  });

  it("prefers the track with the nearest recorded fix when tracks overlap", () => {
    // Two devices recording at once: one has a fix 5s from the target, the
    // other only 400s away. The closer witness wins.
    const sparse = pts([[0, 10.0, 10.0], [800, 11.0, 11.0]]);
    const dense = pts([[395, 20.0, 20.0], [405, 20.1, 20.1]]);
    const result = matchToTracks([sparse, dense], 400, 60);
    expect(result).not.toBeNull();
    expect(result!.lat).toBeCloseTo(20.05, 3);
  });

  it("returns null when no track matches", () => {
    expect(matchToTracks([], 100, 60)).toBeNull();
    expect(matchToTracks([pts([[0, 1.0, 1.0]])], 500, 60)).toBeNull();
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
    const { matching, total } = countMatches(photos, [trackPoints]);
    expect(total).toBe(3);
    expect(matching).toBe(2);
  });

  it("skips photos without timezone", () => {
    const trackPoints = pts([[0, 37.0, -122.0]]);
    const photos = [
      { currentMetadata: { captureDate: "1970-01-01", captureTime: "00:00:00", timezone: null } },
      { currentMetadata: { captureDate: "1970-01-01", captureTime: "00:00:00", timezone: "UTC" } },
    ];
    const { matching, total } = countMatches(photos, [trackPoints]);
    expect(total).toBe(1);
    expect(matching).toBe(1);
  });
});
