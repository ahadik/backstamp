import { computeInheritance, cameraDataEqual, extractCameraData } from "./useMetadataInheritance";
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
    const result = computeInheritance(
      dragging,
      { kind: "photo", photoId: "t" },
      target,
      null,
      null,
    );
    expect(result.changes.size).toBe(2);
    expect(result.cameraConflict).toBeNull();
    for (const id of ["a", "b"]) {
      expect(result.changes.get(id)?.captureDate).toBe("2024-03-15");
      expect(result.changes.get(id)?.captureTime).toBe("10:30:00");
      expect(result.changes.get(id)?.gpsLat).toBe(37.7);
      expect(result.changes.get(id)?.cameraMake).toBe("Canon");
      expect(result.changes.get(id)?.cameraModel).toBe("EOS R5");
      expect(result.changes.get(id)?.filmVendor).toBe("Kodak");
      expect(result.changes.get(id)?.filmType).toBe("Portra 400");
    }
  });

  it("preserves dragging photo fields when master has null for those fields", () => {
    const dragging = [makePhoto("a", { cameraMake: "Nikon", cameraModel: "F3", captureDate: "2024-01-01" })];
    const master = makePhoto("t", { captureDate: "2024-03-15", captureTime: "10:30:00" });
    const result = computeInheritance(
      dragging,
      { kind: "photo", photoId: "t" },
      master,
      null,
      null,
    );
    expect(result.changes.get("a")?.captureDate).toBe("2024-03-15");
    expect(result.changes.get("a")?.captureTime).toBe("10:30:00");
    // master has null cameraMake/cameraModel — must be absent from changes so existing values survive
    expect(result.changes.get("a")?.cameraMake).toBeUndefined();
    expect(result.changes.get("a")?.cameraModel).toBeUndefined();
  });

  it("preserves dragging photo GPS when master has no location", () => {
    // photo with location but no date, dropped on photo with date but no location
    const dragging = [makePhoto("a", { gpsLat: 37.7, gpsLng: -122.4 })];
    const master = makePhoto("t", { captureDate: "2024-03-15", captureTime: "10:30:00" });
    const result = computeInheritance(
      dragging,
      { kind: "photo", photoId: "t" },
      master,
      null,
      null,
    );
    expect(result.changes.get("a")?.captureDate).toBe("2024-03-15");
    // master gpsLat/gpsLng are null — must not appear in changes
    expect(result.changes.get("a")?.gpsLat).toBeUndefined();
    expect(result.changes.get("a")?.gpsLng).toBeUndefined();
  });

  it("returns empty map when targetPhoto is null", () => {
    const dragging = [makePhoto("a")];
    const result = computeInheritance(
      dragging,
      { kind: "photo", photoId: "t" },
      null,
      null,
      null,
    );
    expect(result.changes.size).toBe(0);
    expect(result.cameraConflict).toBeNull();
  });
});

describe("computeInheritance — no-date block drop", () => {
  it("clears captureDate and captureTime, leaves other fields unchanged", () => {
    const dragging = [makePhoto("a", { captureDate: "2024-01-01", captureTime: "08:00:00" })];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: null, afterId: null, dayKey: "no-date" } },
      null,
      null,
      null,
    );
    expect(result.changes.get("a")?.captureDate).toBeNull();
    expect(result.changes.get("a")?.captureTime).toBeNull();
    expect(result.cameraConflict).toBeNull();
  });
});

describe("computeInheritance — gap drop with no GPS on neighbors", () => {
  it("preserves dragging photo GPS when neither neighbor has GPS", () => {
    const before = makePhoto("b", { captureDate: "2024-03-15", captureTime: "10:00:00" });
    const after = makePhoto("a", { captureDate: "2024-03-15", captureTime: "12:00:00" });
    const dragging = [makePhoto("x", { gpsLat: 37.7, gpsLng: -122.4 })];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null,
      before,
      after,
    );
    // Neither neighbor has GPS — must not appear in changes so dragging photo's GPS survives
    expect(result.changes.get("x")?.gpsLat).toBeUndefined();
    expect(result.changes.get("x")?.gpsLng).toBeUndefined();
  });

  it("preserves dragging photo camera metadata when closer neighbor has no camera data", () => {
    const before = makePhoto("b", { captureDate: "2024-03-15", captureTime: "10:00:00" });
    const dragging = [makePhoto("x", { cameraMake: "Nikon", cameraModel: "F3" })];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: null, dayKey: "2024-03-15" } },
      null,
      before,
      null,
    );
    expect(result.changes.get("x")?.cameraMake).toBeUndefined();
    expect(result.changes.get("x")?.cameraModel).toBeUndefined();
    expect(result.cameraConflict).toBeNull();
  });
});

describe("computeInheritance — gap drop between two dated photos", () => {
  it("interpolates timestamp linearly for a single photo", () => {
    const before = makePhoto("b", { captureDate: "2024-03-15", captureTime: "10:00:00" });
    const after = makePhoto("a", { captureDate: "2024-03-15", captureTime: "12:00:00" });
    const dragging = [makePhoto("x")];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null,
      before,
      after,
    );
    expect(result.changes.get("x")?.captureDate).toBe("2024-03-15");
    expect(result.changes.get("x")?.captureTime).toBe("11:00:00");
  });

  it("interpolates GPS coordinates linearly", () => {
    const before = makePhoto("b", { gpsLat: 0, gpsLng: 0 });
    const after = makePhoto("a", { gpsLat: 2, gpsLng: 4 });
    const dragging = [makePhoto("x")];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null,
      before,
      after,
    );
    expect(result.changes.get("x")?.gpsLat).toBeCloseTo(1);
    expect(result.changes.get("x")?.gpsLng).toBeCloseTo(2);
  });

  it("returns cameraConflict when both neighbors have different camera data", () => {
    const before = makePhoto("b", { cameraMake: "Nikon", cameraModel: "Z9", lens: "50mm" });
    const after = makePhoto("a", { cameraMake: "Canon", cameraModel: "R5", lens: "85mm" });
    const dragging = [makePhoto("x")];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null,
      before,
      after,
    );
    expect(result.cameraConflict).not.toBeNull();
    expect(result.cameraConflict?.optionBefore?.cameraMake).toBe("Nikon");
    expect(result.cameraConflict?.optionAfter?.cameraMake).toBe("Canon");
    expect(result.cameraConflict?.draggingIds).toEqual(["x"]);
    // Camera fields must NOT be in changes when there is a conflict
    expect(result.changes.get("x")?.cameraMake).toBeUndefined();
    expect(result.changes.get("x")?.cameraModel).toBeUndefined();
  });
});

describe("computeInheritance — gap at start of block (no before neighbor)", () => {
  it("sets captureDate to dayKey and captureTime to first photo time minus 1 min", () => {
    const after = makePhoto("a", { captureTime: "10:00:00" });
    const dragging = [makePhoto("x")];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: null, afterId: "a", dayKey: "2024-03-15" } },
      null,
      null,
      after,
    );
    expect(result.changes.get("x")?.captureDate).toBe("2024-03-15");
    expect(result.changes.get("x")?.captureTime).toBe("09:59:00");
  });
});

describe("computeInheritance — gap at end of block (no after neighbor)", () => {
  it("sets captureDate to dayKey and captureTime to last photo time plus 1 min", () => {
    const before = makePhoto("b", { captureTime: "10:00:00" });
    const dragging = [makePhoto("x")];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: null, dayKey: "2024-03-15" } },
      null,
      before,
      null,
    );
    expect(result.changes.get("x")?.captureDate).toBe("2024-03-15");
    expect(result.changes.get("x")?.captureTime).toBe("10:01:00");
  });
});

describe("computeInheritance — gap drop with no neighbors", () => {
  it("uses the dayKey and sets captureTime to null when neither neighbor has a time", () => {
    const dragging = [makePhoto("x")];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: null, afterId: null, dayKey: "2024-03-15" } },
      null,
      null,
      null,
    );
    expect(result.changes.get("x")?.captureDate).toBe("2024-03-15");
    expect(result.changes.get("x")?.captureTime).toBeNull();
  });
});

describe("computeInheritance — multiple dragging photos in a gap", () => {
  it("assigns a distinct interpolated timestamp to each dragging photo", () => {
    const before = makePhoto("b", { captureDate: "2024-03-15", captureTime: "10:00:00" });
    const after = makePhoto("a", { captureDate: "2024-03-15", captureTime: "10:03:00" });
    const dragging = [makePhoto("x"), makePhoto("y"), makePhoto("z")];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null,
      before,
      after,
    );
    // With 3 photos between 10:00 and 10:03 → interpolation at t=1/4, 2/4, 3/4
    // x: 10:00 + 0.25 * 180s = 10:00:45
    // y: 10:00 + 0.50 * 180s = 10:01:30
    // z: 10:00 + 0.75 * 180s = 10:02:15
    expect(result.changes.get("x")?.captureTime).toBe("10:00:45");
    expect(result.changes.get("y")?.captureTime).toBe("10:01:30");
    expect(result.changes.get("z")?.captureTime).toBe("10:02:15");
  });

  it("staggers end-of-block times: each dragging photo is 1 min later than the previous", () => {
    const before = makePhoto("b", { captureTime: "10:00:00" });
    const dragging = [makePhoto("x"), makePhoto("y")];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: null, dayKey: "2024-03-15" } },
      null,
      before,
      null,
    );
    expect(result.changes.get("x")?.captureTime).toBe("10:01:00");
    expect(result.changes.get("y")?.captureTime).toBe("10:02:00");
  });
});

describe("computeInheritance — gap drop camera conflict detection", () => {
  it("inherits camera data when both neighbors have the same camera data", () => {
    const cam = { cameraMake: "Nikon", cameraModel: "Z9", lens: "50mm" };
    const before = makePhoto("b", { captureTime: "10:00:00", ...cam });
    const after = makePhoto("a", { captureTime: "12:00:00", ...cam });
    const dragging = [makePhoto("x")];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null,
      before,
      after,
    );
    expect(result.cameraConflict).toBeNull();
    expect(result.changes.get("x")?.cameraMake).toBe("Nikon");
    expect(result.changes.get("x")?.cameraModel).toBe("Z9");
  });

  it("inherits before-neighbor camera data when after has none", () => {
    const before = makePhoto("b", { cameraMake: "Leica", cameraModel: "M6" });
    const after = makePhoto("a", { captureTime: "12:00:00" });
    const dragging = [makePhoto("x")];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null,
      before,
      after,
    );
    expect(result.cameraConflict).toBeNull();
    expect(result.changes.get("x")?.cameraMake).toBe("Leica");
    expect(result.changes.get("x")?.cameraModel).toBe("M6");
  });

  it("inherits after-neighbor camera data when before has none", () => {
    const before = makePhoto("b", { captureTime: "10:00:00" });
    const after = makePhoto("a", { cameraMake: "Sony", cameraModel: "A7 IV" });
    const dragging = [makePhoto("x")];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null,
      before,
      after,
    );
    expect(result.cameraConflict).toBeNull();
    expect(result.changes.get("x")?.cameraMake).toBe("Sony");
    expect(result.changes.get("x")?.cameraModel).toBe("A7 IV");
  });

  it("no camera fields when neither neighbor has camera data", () => {
    const before = makePhoto("b", { captureTime: "10:00:00" });
    const after = makePhoto("a", { captureTime: "12:00:00" });
    const dragging = [makePhoto("x")];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null,
      before,
      after,
    );
    expect(result.cameraConflict).toBeNull();
    expect(result.changes.get("x")?.cameraMake).toBeUndefined();
    expect(result.changes.get("x")?.cameraModel).toBeUndefined();
  });

  it("sets cameraConflict with both options when neighbors differ", () => {
    const before = makePhoto("b", { cameraMake: "Canon", filmVendor: "Kodak", filmType: "Portra 400" });
    const after = makePhoto("a", { cameraMake: "Fujifilm", filmVendor: "Fujifilm", filmType: "Velvia 50" });
    const dragging = [makePhoto("x"), makePhoto("y")];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null,
      before,
      after,
    );
    expect(result.cameraConflict).not.toBeNull();
    expect(result.cameraConflict?.optionBefore?.cameraMake).toBe("Canon");
    expect(result.cameraConflict?.optionAfter?.cameraMake).toBe("Fujifilm");
    expect(result.cameraConflict?.draggingIds).toEqual(["x", "y"]);
    expect(result.changes.get("x")?.cameraMake).toBeUndefined();
    expect(result.changes.get("y")?.cameraMake).toBeUndefined();
  });
});

describe("computeInheritance — gap drop timezone resolution", () => {
  it("inherits timezone when both neighbors share the same timezone", () => {
    const before = makePhoto("b", { captureTime: "10:00:00", timezone: "America/New_York" });
    const after = makePhoto("a", { captureTime: "12:00:00", timezone: "America/New_York" });
    const dragging = [makePhoto("x")];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null, before, after,
    );
    expect(result.changes.get("x")?.timezone).toBe("America/New_York");
  });

  it("uses before (left) timezone when both neighbors have different timezones", () => {
    const before = makePhoto("b", { captureTime: "10:00:00", timezone: "America/New_York" });
    const after = makePhoto("a", { captureTime: "12:00:00", timezone: "Europe/Paris" });
    const dragging = [makePhoto("x")];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null, before, after,
    );
    expect(result.changes.get("x")?.timezone).toBe("America/New_York");
  });

  it("adopts after-neighbor timezone when only after has one", () => {
    const before = makePhoto("b", { captureTime: "10:00:00" });
    const after = makePhoto("a", { captureTime: "12:00:00", timezone: "Asia/Tokyo" });
    const dragging = [makePhoto("x")];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null, before, after,
    );
    expect(result.changes.get("x")?.timezone).toBe("Asia/Tokyo");
  });

  it("omits timezone from changes when neither neighbor has one", () => {
    const before = makePhoto("b", { captureTime: "10:00:00" });
    const after = makePhoto("a", { captureTime: "12:00:00" });
    const dragging = [makePhoto("x")];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: "a", dayKey: "2024-03-15" } },
      null, before, after,
    );
    expect(result.changes.get("x")?.timezone).toBeUndefined();
  });

  it("adopts the sole neighbor timezone for a start-of-block gap", () => {
    const after = makePhoto("a", { captureTime: "10:00:00", timezone: "Pacific/Auckland" });
    const dragging = [makePhoto("x")];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: null, afterId: "a", dayKey: "2024-03-15" } },
      null, null, after,
    );
    expect(result.changes.get("x")?.timezone).toBe("Pacific/Auckland");
  });

  it("adopts the sole neighbor timezone for an end-of-block gap", () => {
    const before = makePhoto("b", { captureTime: "10:00:00", timezone: "America/Chicago" });
    const dragging = [makePhoto("x")];
    const result = computeInheritance(
      dragging,
      { kind: "gap", gap: { beforeId: "b", afterId: null, dayKey: "2024-03-15" } },
      null, before, null,
    );
    expect(result.changes.get("x")?.timezone).toBe("America/Chicago");
  });
});

describe("cameraDataEqual", () => {
  it("returns true when both are null", () => {
    expect(cameraDataEqual(null, null)).toBe(true);
  });

  it("returns false when one is null", () => {
    expect(cameraDataEqual({ cameraMake: "Canon", cameraModel: null, lens: null, filmVendor: null, filmType: null }, null)).toBe(false);
    expect(cameraDataEqual(null, { cameraMake: "Canon", cameraModel: null, lens: null, filmVendor: null, filmType: null })).toBe(false);
  });

  it("returns true when all fields match", () => {
    const data = { cameraMake: "Nikon", cameraModel: "Z9", lens: "50mm", filmVendor: null, filmType: null };
    expect(cameraDataEqual(data, { ...data })).toBe(true);
  });

  it("returns false when fields differ", () => {
    const a = { cameraMake: "Nikon", cameraModel: "Z9", lens: null, filmVendor: null, filmType: null };
    const b = { cameraMake: "Canon", cameraModel: "R5", lens: null, filmVendor: null, filmType: null };
    expect(cameraDataEqual(a, b)).toBe(false);
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
