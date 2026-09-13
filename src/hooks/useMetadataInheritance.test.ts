import {
  computeInheritance,
  extractCameraData,
  parseDropSettings,
  DEFAULT_DROP_SETTINGS,
  type DropSettings,
} from "./useMetadataInheritance";
import type { Photo, Metadata } from "../state/SessionContext";

const nullMeta: Metadata = {
  captureDate: null, captureTime: null, utcOffset: null, timezone: null,
  gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null, lens: null, filmVendor: null, filmType: null,
};

function makePhoto(id: string, meta: Partial<Metadata> = {}): Photo {
  return {
    id,
    filePath: `/photos/${id}.jpg`,
    fileStatus: "ok",
    thumbnail: { small: "", large: "" },
    originalMetadata: { ...nullMeta, ...meta },
    currentMetadata: { ...nullMeta, ...meta },
    pendingChanges: null,
  };
}

function settingsWith(overrides: {
  [K in keyof DropSettings]?: Partial<DropSettings[K]>;
}): DropSettings {
  return {
    timestamp: { ...DEFAULT_DROP_SETTINGS.timestamp, ...overrides.timestamp },
    location: { ...DEFAULT_DROP_SETTINGS.location, ...overrides.location },
    camera: { ...DEFAULT_DROP_SETTINGS.camera, ...overrides.camera },
  };
}

describe("computeInheritance — photo drop", () => {
  it("copies all metadata from the target photo to every dragging photo", () => {
    const dragging = [makePhoto("a"), makePhoto("b")];
    const target = makePhoto("t", {
      captureDate: "2024-03-15",
      captureTime: "10:30:00",
      gpsLat: 37.7,
      gpsLng: -122.4,
      cameraMake: "Canon",
      cameraModel: "EOS R5",
      lens: "RF 50mm",
      filmVendor: "Kodak",
      filmType: "Portra 400",
    });
    const changes = computeInheritance(
      dragging,
      { kind: "photo", photoId: "t" },
      target,
      null,
      null,
    );
    expect(changes.size).toBe(2);
    for (const id of ["a", "b"]) {
      expect(changes.get(id)?.captureDate).toBe("2024-03-15");
      expect(changes.get(id)?.captureTime).toBe("10:30:00");
      expect(changes.get(id)?.gpsLat).toBe(37.7);
      expect(changes.get(id)?.cameraMake).toBe("Canon");
      expect(changes.get(id)?.cameraModel).toBe("EOS R5");
      expect(changes.get(id)?.filmVendor).toBe("Kodak");
      expect(changes.get(id)?.filmType).toBe("Portra 400");
    }
  });

  it("preserves dragging photo fields when master has null for those fields", () => {
    const dragging = [makePhoto("a", { cameraMake: "Nikon", cameraModel: "F3", captureDate: "2024-01-01" })];
    const master = makePhoto("t", { captureDate: "2024-03-15", captureTime: "10:30:00" });
    const changes = computeInheritance(
      dragging,
      { kind: "photo", photoId: "t" },
      master,
      null,
      null,
    );
    expect(changes.get("a")?.captureDate).toBe("2024-03-15");
    expect(changes.get("a")?.captureTime).toBe("10:30:00");
    // master has null cameraMake/cameraModel — must be absent from changes so existing values survive
    expect(changes.get("a")?.cameraMake).toBeUndefined();
    expect(changes.get("a")?.cameraModel).toBeUndefined();
  });

  it("preserves dragging photo GPS when master has no location", () => {
    // photo with location but no date, dropped on photo with date but no location
    const dragging = [makePhoto("a", { gpsLat: 37.7, gpsLng: -122.4 })];
    const master = makePhoto("t", { captureDate: "2024-03-15", captureTime: "10:30:00" });
    const changes = computeInheritance(
      dragging,
      { kind: "photo", photoId: "t" },
      master,
      null,
      null,
    );
    expect(changes.get("a")?.captureDate).toBe("2024-03-15");
    // master gpsLat/gpsLng are null — must not appear in changes
    expect(changes.get("a")?.gpsLat).toBeUndefined();
    expect(changes.get("a")?.gpsLng).toBeUndefined();
  });

  it("skips disabled groups entirely", () => {
    const dragging = [makePhoto("a")];
    const target = makePhoto("t", {
      captureDate: "2024-03-15",
      captureTime: "10:30:00",
      gpsLat: 37.7,
      gpsLng: -122.4,
      cameraMake: "Canon",
    });
    const changes = computeInheritance(
      dragging,
      { kind: "photo", photoId: "t" },
      target,
      null,
      null,
      settingsWith({ timestamp: { enabled: false }, camera: { enabled: false } }),
    );
    expect(changes.get("a")?.captureDate).toBeUndefined();
    expect(changes.get("a")?.captureTime).toBeUndefined();
    expect(changes.get("a")?.cameraMake).toBeUndefined();
    expect(changes.get("a")?.gpsLat).toBe(37.7);
    expect(changes.get("a")?.gpsLng).toBe(-122.4);
  });

  it("returns empty map when targetPhoto is null", () => {
    const dragging = [makePhoto("a")];
    const changes = computeInheritance(
      dragging,
      { kind: "photo", photoId: "t" },
      null,
      null,
      null,
    );
    expect(changes.size).toBe(0);
  });
});

describe("computeInheritance — no-date block drop", () => {
  it("clears captureDate and captureTime, leaves other fields unchanged", () => {
    const dragging = [makePhoto("a", { captureDate: "2024-01-01", captureTime: "08:00:00" })];
    const changes = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: null, afterId: null, dayKey: "no-date" } },
      null,
      null,
      null,
    );
    expect(changes.get("a")?.captureDate).toBeNull();
    expect(changes.get("a")?.captureTime).toBeNull();
  });
});

describe("computeInheritance — gap drop with no GPS on neighbors", () => {
  it("preserves dragging photo GPS when neither neighbor has GPS", () => {
    const before = makePhoto("b", { captureDate: "2024-03-15", captureTime: "10:00:00" });
    const after = makePhoto("a", { captureDate: "2024-03-15", captureTime: "12:00:00" });
    const dragging = [makePhoto("x", { gpsLat: 37.7, gpsLng: -122.4 })];
    const changes = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null,
      before,
      after,
    );
    // Neither neighbor has GPS — must not appear in changes so dragging photo's GPS survives
    expect(changes.get("x")?.gpsLat).toBeUndefined();
    expect(changes.get("x")?.gpsLng).toBeUndefined();
  });

  it("preserves dragging photo camera metadata when neighbors have no camera data", () => {
    const before = makePhoto("b", { captureDate: "2024-03-15", captureTime: "10:00:00" });
    const dragging = [makePhoto("x", { cameraMake: "Nikon", cameraModel: "F3" })];
    const changes = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: null, dayKey: "2024-03-15" } },
      null,
      before,
      null,
    );
    expect(changes.get("x")?.cameraMake).toBeUndefined();
    expect(changes.get("x")?.cameraModel).toBeUndefined();
  });
});

describe("computeInheritance — gap drop between two dated photos", () => {
  it("interpolates timestamp linearly for a single photo", () => {
    const before = makePhoto("b", { captureDate: "2024-03-15", captureTime: "10:00:00" });
    const after = makePhoto("a", { captureDate: "2024-03-15", captureTime: "12:00:00" });
    const dragging = [makePhoto("x")];
    const changes = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null,
      before,
      after,
    );
    expect(changes.get("x")?.captureDate).toBe("2024-03-15");
    expect(changes.get("x")?.captureTime).toBe("11:00:00");
  });

  it("interpolates correctly across midnight when photos span two calendar days in their local timezone", () => {
    // before: Jan 14 22:00 PST  → UTC Jan 15 06:00
    // after:  Jan 15 02:00 PST  → UTC Jan 15 10:00
    // Both appear in the same India-time day block (IST Jan 15), but their PST times span midnight.
    // Midpoint UTC = Jan 15 08:00 → PST Jan 15 00:00
    const before = makePhoto("b", { captureDate: "2024-01-14", captureTime: "22:00:00", utcOffset: "-08:00" });
    const after = makePhoto("a", { captureDate: "2024-01-15", captureTime: "02:00:00", utcOffset: "-08:00" });
    const dragging = [makePhoto("x")];
    const changes = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-01-15" } },
      null,
      before,
      after,
    );
    expect(changes.get("x")?.captureDate).toBe("2024-01-15");
    expect(changes.get("x")?.captureTime).toBe("00:00:00");
    expect(changes.get("x")?.utcOffset).toBe("-08:00");
  });

  it("propagates utcOffset from neighbors so getDateKey can group the photo in the correct working-timezone day", () => {
    const before = makePhoto("b", { captureDate: "2024-02-15", captureTime: "21:00:00", utcOffset: "-08:00" });
    const after = makePhoto("a", { captureDate: "2024-02-16", captureTime: "01:00:00", utcOffset: "-08:00" });
    const dragging = [makePhoto("x")];
    const changes = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-02-16" } },
      null,
      before,
      after,
    );
    // Midpoint UTC = Feb 16 05:00 → PST Feb 15 21:00 + 2h = Feb 15 23:00
    expect(changes.get("x")?.captureDate).toBe("2024-02-15");
    expect(changes.get("x")?.captureTime).toBe("23:00:00");
    expect(changes.get("x")?.utcOffset).toBe("-08:00");
  });

  it("interpolates GPS coordinates linearly", () => {
    const before = makePhoto("b", { gpsLat: 0, gpsLng: 0 });
    const after = makePhoto("a", { gpsLat: 2, gpsLng: 4 });
    const dragging = [makePhoto("x")];
    const changes = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null,
      before,
      after,
    );
    expect(changes.get("x")?.gpsLat).toBeCloseTo(1);
    expect(changes.get("x")?.gpsLng).toBeCloseTo(2);
  });
});

describe("computeInheritance — gap adopt modes", () => {
  const before = makePhoto("b", {
    captureDate: "2024-03-15", captureTime: "10:00:00", utcOffset: "-08:00", timezone: "America/Los_Angeles",
    gpsLat: 10, gpsLng: 20, cameraMake: "Nikon", cameraModel: "Z9",
  });
  const after = makePhoto("a", {
    captureDate: "2024-03-15", captureTime: "12:00:00", utcOffset: "-08:00", timezone: "America/Los_Angeles",
    gpsLat: 30, gpsLng: 40, cameraMake: "Canon", cameraModel: "R5",
  });
  const gapTarget = { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } } as const;

  it("adopts the before neighbor's values verbatim when gapMode is 'before'", () => {
    const changes = computeInheritance(
      [makePhoto("x"), makePhoto("y")],
      gapTarget,
      null, before, after,
      settingsWith({
        timestamp: { gapMode: "before" },
        location: { gapMode: "before" },
        camera: { gapMode: "before" },
      }),
    );
    for (const id of ["x", "y"]) {
      expect(changes.get(id)?.captureDate).toBe("2024-03-15");
      expect(changes.get(id)?.captureTime).toBe("10:00:00");
      expect(changes.get(id)?.gpsLat).toBe(10);
      expect(changes.get(id)?.gpsLng).toBe(20);
      expect(changes.get(id)?.cameraMake).toBe("Nikon");
    }
  });

  it("adopts the after neighbor's values verbatim when gapMode is 'after'", () => {
    const changes = computeInheritance(
      [makePhoto("x")],
      gapTarget,
      null, before, after,
      settingsWith({
        timestamp: { gapMode: "after" },
        location: { gapMode: "after" },
        camera: { gapMode: "after" },
      }),
    );
    expect(changes.get("x")?.captureTime).toBe("12:00:00");
    expect(changes.get("x")?.gpsLat).toBe(30);
    expect(changes.get("x")?.cameraMake).toBe("Canon");
  });

  it("falls back to the other side when the chosen side has no data for a group", () => {
    const bareBeforeNeighbor = makePhoto("b", { captureDate: "2024-03-15", captureTime: "10:00:00" });
    const changes = computeInheritance(
      [makePhoto("x")],
      gapTarget,
      null, bareBeforeNeighbor, after,
      settingsWith({
        location: { gapMode: "before" },
        camera: { gapMode: "before" },
      }),
    );
    // before has no GPS or camera data — the after neighbor's values are used
    expect(changes.get("x")?.gpsLat).toBe(30);
    expect(changes.get("x")?.cameraMake).toBe("Canon");
  });

  it("falls back to the sole neighbor at an edge-of-block gap", () => {
    const changes = computeInheritance(
      [makePhoto("x")],
      { kind: "gap", gap: { beforeId: "b", afterId: null, dayKey: "2024-03-15" } },
      null, before, null,
      settingsWith({
        timestamp: { gapMode: "after" },
        camera: { gapMode: "after" },
      }),
    );
    expect(changes.get("x")?.captureTime).toBe("10:00:00");
    expect(changes.get("x")?.cameraMake).toBe("Nikon");
  });

  it("skips disabled groups on gap drops", () => {
    const changes = computeInheritance(
      [makePhoto("x")],
      gapTarget,
      null, before, after,
      settingsWith({
        timestamp: { enabled: false },
        location: { enabled: false },
        camera: { enabled: false },
      }),
    );
    expect(changes.get("x")).toEqual({});
  });

  it("resolves a camera conflict silently with the chosen side (no more conflict prompt)", () => {
    const changes = computeInheritance(
      [makePhoto("x")],
      gapTarget,
      null, before, after,
      settingsWith({ camera: { gapMode: "after" } }),
    );
    expect(changes.get("x")?.cameraMake).toBe("Canon");
    expect(changes.get("x")?.cameraModel).toBe("R5");
  });
});

describe("computeInheritance — gap at start of block (no before neighbor)", () => {
  it("sets captureDate to dayKey and captureTime to first photo time minus 1 min", () => {
    const after = makePhoto("a", { captureTime: "10:00:00" });
    const dragging = [makePhoto("x")];
    const changes = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: null, afterId: "a", dayKey: "2024-03-15" } },
      null,
      null,
      after,
    );
    expect(changes.get("x")?.captureDate).toBe("2024-03-15");
    expect(changes.get("x")?.captureTime).toBe("09:59:00");
  });
});

describe("computeInheritance — gap at end of block (no after neighbor)", () => {
  it("sets captureDate to dayKey and captureTime to last photo time plus 1 min", () => {
    const before = makePhoto("b", { captureTime: "10:00:00" });
    const dragging = [makePhoto("x")];
    const changes = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: null, dayKey: "2024-03-15" } },
      null,
      before,
      null,
    );
    expect(changes.get("x")?.captureDate).toBe("2024-03-15");
    expect(changes.get("x")?.captureTime).toBe("10:01:00");
  });
});

describe("computeInheritance — gap drop with no neighbors", () => {
  it("uses the dayKey and sets captureTime to null when neither neighbor has a time", () => {
    const dragging = [makePhoto("x")];
    const changes = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: null, afterId: null, dayKey: "2024-03-15" } },
      null,
      null,
      null,
    );
    expect(changes.get("x")?.captureDate).toBe("2024-03-15");
    expect(changes.get("x")?.captureTime).toBeNull();
  });
});

describe("computeInheritance — multiple dragging photos in a gap", () => {
  it("assigns a distinct interpolated timestamp to each dragging photo", () => {
    const before = makePhoto("b", { captureDate: "2024-03-15", captureTime: "10:00:00" });
    const after = makePhoto("a", { captureDate: "2024-03-15", captureTime: "10:03:00" });
    const dragging = [makePhoto("x"), makePhoto("y"), makePhoto("z")];
    const changes = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null,
      before,
      after,
    );
    // With 3 photos between 10:00 and 10:03 → interpolation at t=1/4, 2/4, 3/4
    expect(changes.get("x")?.captureTime).toBe("10:00:45");
    expect(changes.get("y")?.captureTime).toBe("10:01:30");
    expect(changes.get("z")?.captureTime).toBe("10:02:15");
  });

  it("staggers end-of-block times: each dragging photo is 1 min later than the previous", () => {
    const before = makePhoto("b", { captureTime: "10:00:00" });
    const dragging = [makePhoto("x"), makePhoto("y")];
    const changes = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: null, dayKey: "2024-03-15" } },
      null,
      before,
      null,
    );
    expect(changes.get("x")?.captureTime).toBe("10:01:00");
    expect(changes.get("y")?.captureTime).toBe("10:02:00");
  });
});

describe("computeInheritance — gap drop camera inheritance (default settings)", () => {
  it("inherits camera data when both neighbors have the same camera data", () => {
    const cam = { cameraMake: "Nikon", cameraModel: "Z9", lens: "50mm" };
    const before = makePhoto("b", { captureTime: "10:00:00", ...cam });
    const after = makePhoto("a", { captureTime: "12:00:00", ...cam });
    const changes = computeInheritance(
      [makePhoto("x")],
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null,
      before,
      after,
    );
    expect(changes.get("x")?.cameraMake).toBe("Nikon");
    expect(changes.get("x")?.cameraModel).toBe("Z9");
  });

  it("inherits before-neighbor camera data when after has none", () => {
    const before = makePhoto("b", { cameraMake: "Leica", cameraModel: "M6" });
    const after = makePhoto("a", { captureTime: "12:00:00" });
    const changes = computeInheritance(
      [makePhoto("x")],
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null,
      before,
      after,
    );
    expect(changes.get("x")?.cameraMake).toBe("Leica");
    expect(changes.get("x")?.cameraModel).toBe("M6");
  });

  it("inherits after-neighbor camera data when before has none", () => {
    const before = makePhoto("b", { captureTime: "10:00:00" });
    const after = makePhoto("a", { cameraMake: "Sony", cameraModel: "A7 IV" });
    const changes = computeInheritance(
      [makePhoto("x")],
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null,
      before,
      after,
    );
    expect(changes.get("x")?.cameraMake).toBe("Sony");
    expect(changes.get("x")?.cameraModel).toBe("A7 IV");
  });

  it("no camera fields when neither neighbor has camera data", () => {
    const before = makePhoto("b", { captureTime: "10:00:00" });
    const after = makePhoto("a", { captureTime: "12:00:00" });
    const changes = computeInheritance(
      [makePhoto("x")],
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null,
      before,
      after,
    );
    expect(changes.get("x")?.cameraMake).toBeUndefined();
    expect(changes.get("x")?.cameraModel).toBeUndefined();
  });

  it("defaults to the before (left) camera when neighbors differ", () => {
    const before = makePhoto("b", { cameraMake: "Canon", filmVendor: "Kodak", filmType: "Portra 400" });
    const after = makePhoto("a", { cameraMake: "Fujifilm", filmVendor: "Fujifilm", filmType: "Velvia 50" });
    const changes = computeInheritance(
      [makePhoto("x"), makePhoto("y")],
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null,
      before,
      after,
    );
    for (const id of ["x", "y"]) {
      expect(changes.get(id)?.cameraMake).toBe("Canon");
      expect(changes.get(id)?.filmVendor).toBe("Kodak");
      expect(changes.get(id)?.filmType).toBe("Portra 400");
    }
  });
});

describe("computeInheritance — gap drop timezone resolution", () => {
  it("inherits timezone when both neighbors share the same timezone", () => {
    const before = makePhoto("b", { captureTime: "10:00:00", timezone: "America/New_York" });
    const after = makePhoto("a", { captureTime: "12:00:00", timezone: "America/New_York" });
    const changes = computeInheritance(
      [makePhoto("x")],
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null, before, after,
    );
    expect(changes.get("x")?.timezone).toBe("America/New_York");
  });

  it("uses before (left) timezone when both neighbors have different timezones", () => {
    const before = makePhoto("b", { captureTime: "10:00:00", timezone: "America/New_York" });
    const after = makePhoto("a", { captureTime: "12:00:00", timezone: "Europe/Paris" });
    const changes = computeInheritance(
      [makePhoto("x")],
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null, before, after,
    );
    expect(changes.get("x")?.timezone).toBe("America/New_York");
  });

  it("adopts after-neighbor timezone when only after has one", () => {
    const before = makePhoto("b", { captureTime: "10:00:00" });
    const after = makePhoto("a", { captureTime: "12:00:00", timezone: "Asia/Tokyo" });
    const changes = computeInheritance(
      [makePhoto("x")],
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null, before, after,
    );
    expect(changes.get("x")?.timezone).toBe("Asia/Tokyo");
  });

  it("omits timezone from changes when neither neighbor has one", () => {
    const before = makePhoto("b", { captureTime: "10:00:00" });
    const after = makePhoto("a", { captureTime: "12:00:00" });
    const changes = computeInheritance(
      [makePhoto("x")],
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null, before, after,
    );
    expect(changes.get("x")?.timezone).toBeUndefined();
  });

  it("adopts the sole neighbor timezone for a start-of-block gap", () => {
    const after = makePhoto("a", { captureTime: "10:00:00", timezone: "Pacific/Auckland" });
    const changes = computeInheritance(
      [makePhoto("x")],
      { kind: "gap", gap: { beforeId: null, afterId: "a", dayKey: "2024-03-15" } },
      null, null, after,
    );
    expect(changes.get("x")?.timezone).toBe("Pacific/Auckland");
  });

  it("adopts the sole neighbor timezone for an end-of-block gap", () => {
    const before = makePhoto("b", { captureTime: "10:00:00", timezone: "America/Chicago" });
    const changes = computeInheritance(
      [makePhoto("x")],
      { kind: "gap", gap: { beforeId: "b", afterId: null, dayKey: "2024-03-15" } },
      null, before, null,
    );
    expect(changes.get("x")?.timezone).toBe("America/Chicago");
  });
});

describe("parseDropSettings", () => {
  it("returns defaults for null, empty, or malformed input", () => {
    expect(parseDropSettings(null)).toEqual(DEFAULT_DROP_SETTINGS);
    expect(parseDropSettings("")).toEqual(DEFAULT_DROP_SETTINGS);
    expect(parseDropSettings("not json")).toEqual(DEFAULT_DROP_SETTINGS);
    expect(parseDropSettings("[1,2]")).toEqual(DEFAULT_DROP_SETTINGS);
  });

  it("round-trips a settings object", () => {
    const settings: DropSettings = {
      timestamp: { enabled: false, gapMode: "before" },
      location: { enabled: true, gapMode: "after" },
      camera: { enabled: false, gapMode: "after" },
    };
    expect(parseDropSettings(JSON.stringify(settings))).toEqual(settings);
  });

  it("fills in missing groups with defaults", () => {
    const parsed = parseDropSettings(JSON.stringify({ timestamp: { enabled: false } }));
    expect(parsed.timestamp.enabled).toBe(false);
    expect(parsed.timestamp.gapMode).toBe("interpolate");
    expect(parsed.location).toEqual(DEFAULT_DROP_SETTINGS.location);
    expect(parsed.camera).toEqual(DEFAULT_DROP_SETTINGS.camera);
  });

  it("rejects an interpolate gapMode for the camera group", () => {
    const parsed = parseDropSettings(
      JSON.stringify({ camera: { enabled: true, gapMode: "interpolate" } }),
    );
    expect(parsed.camera.gapMode).toBe("before");
  });
});

describe("extractCameraData", () => {
  it("returns null for a photo with no camera fields set", () => {
    expect(extractCameraData(makePhoto("x"))).toBeNull();
  });

  it("returns null for a null photo", () => {
    expect(extractCameraData(null)).toBeNull();
  });

  it("returns camera data when at least one field is set", () => {
    const photo = makePhoto("x", { cameraMake: "Leica" });
    const data = extractCameraData(photo);
    expect(data).not.toBeNull();
    expect(data?.cameraMake).toBe("Leica");
    expect(data?.cameraModel).toBeNull();
  });
});
