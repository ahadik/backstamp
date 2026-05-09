import { computeInheritance } from "./useMetadataInheritance";
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
    expect(result.size).toBe(2);
    for (const id of ["a", "b"]) {
      expect(result.get(id)?.captureDate).toBe("2024-03-15");
      expect(result.get(id)?.captureTime).toBe("10:30:00");
      expect(result.get(id)?.gpsLat).toBe(37.7);
      expect(result.get(id)?.cameraMake).toBe("Canon");
      expect(result.get(id)?.cameraModel).toBe("EOS R5");
      expect(result.get(id)?.filmVendor).toBe("Kodak");
      expect(result.get(id)?.filmType).toBe("Portra 400");
    }
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
    expect(result.size).toBe(0);
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
    expect(result.get("a")?.captureDate).toBeNull();
    expect(result.get("a")?.captureTime).toBeNull();
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
    expect(result.get("x")?.captureDate).toBe("2024-03-15");
    expect(result.get("x")?.captureTime).toBe("11:00:00");
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
    expect(result.get("x")?.gpsLat).toBeCloseTo(1);
    expect(result.get("x")?.gpsLng).toBeCloseTo(2);
  });

  it("copies camera metadata from the closer (before) neighbor", () => {
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
    expect(result.get("x")?.cameraMake).toBe("Nikon");
    expect(result.get("x")?.cameraModel).toBe("Z9");
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
    expect(result.get("x")?.captureDate).toBe("2024-03-15");
    expect(result.get("x")?.captureTime).toBe("09:59:00");
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
    expect(result.get("x")?.captureDate).toBe("2024-03-15");
    expect(result.get("x")?.captureTime).toBe("10:01:00");
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
    expect(result.get("x")?.captureDate).toBe("2024-03-15");
    expect(result.get("x")?.captureTime).toBeNull();
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
    expect(result.get("x")?.captureTime).toBe("10:00:45");
    expect(result.get("y")?.captureTime).toBe("10:01:30");
    expect(result.get("z")?.captureTime).toBe("10:02:15");
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
    expect(result.get("x")?.captureTime).toBe("10:01:00");
    expect(result.get("y")?.captureTime).toBe("10:02:00");
  });
});
