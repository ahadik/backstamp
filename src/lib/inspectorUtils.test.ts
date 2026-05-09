import { deriveFieldValue } from "./inspectorUtils";
import type { Photo, Metadata } from "../state/SessionContext";

const nullMeta: Metadata = {
  captureDate: null, captureTime: null, utcOffset: null, timezone: null,
  gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null, lens: null, filmVendor: null, filmType: null,
};

function makePhoto(id: string, meta: Partial<Metadata> = {}): Photo {
  const m = { ...nullMeta, ...meta };
  return {
    id,
    filePath: `/${id}.jpg`,
    fileStatus: "ok",
    thumbnail: { small: "", large: "" },
    originalMetadata: m,
    currentMetadata: m,
    pendingChanges: null,
  };
}

describe("deriveFieldValue", () => {
  // ── Empty / all-null inputs ──────────────────────────────────────────────

  it("returns null for an empty selection", () => {
    expect(deriveFieldValue([], (m) => m.captureDate)).toBeNull();
  });

  it("returns null when all photos have null for the field", () => {
    const photos = [makePhoto("a"), makePhoto("b"), makePhoto("c")];
    expect(deriveFieldValue(photos, (m) => m.captureDate)).toBeNull();
  });

  // ── Single photo ─────────────────────────────────────────────────────────

  it("returns the value for a single photo with a non-null field", () => {
    const photos = [makePhoto("a", { captureDate: "2024-03-15" })];
    expect(deriveFieldValue(photos, (m) => m.captureDate)).toBe("2024-03-15");
  });

  it("returns null for a single photo with a null field", () => {
    const photos = [makePhoto("a")];
    expect(deriveFieldValue(photos, (m) => m.captureDate)).toBeNull();
  });

  // ── Agreement across multiple photos ─────────────────────────────────────

  it("returns the shared value when all non-null photos agree", () => {
    const photos = [
      makePhoto("a", { cameraMake: "Nikon F3" }),
      makePhoto("b", { cameraMake: "Nikon F3" }),
      makePhoto("c", { cameraMake: "Nikon F3" }),
    ];
    expect(deriveFieldValue(photos, (m) => m.cameraMake)).toBe("Nikon F3");
  });

  it("returns 'multiple' when photos have different non-null values", () => {
    const photos = [
      makePhoto("a", { cameraMake: "Nikon F3" }),
      makePhoto("b", { cameraMake: "Canon AE-1" }),
    ];
    expect(deriveFieldValue(photos, (m) => m.cameraMake)).toBe("multiple");
  });

  it("returns 'multiple' across three distinct values", () => {
    const photos = [
      makePhoto("a", { lens: "50mm f/1.4" }),
      makePhoto("b", { lens: "35mm f/2" }),
      makePhoto("c", { lens: "85mm f/1.8" }),
    ];
    expect(deriveFieldValue(photos, (m) => m.lens)).toBe("multiple");
  });

  // ── Null-ignoring behaviour ───────────────────────────────────────────────
  //
  // Nulls are excluded before the agreement check, so a mix of null and a
  // single consistent non-null value resolves to that value — not "multiple".

  it("returns the non-null value when some photos are null and the rest agree", () => {
    const photos = [
      makePhoto("a", { filmVendor: "Kodak" }),
      makePhoto("b"),                          // filmVendor: null
      makePhoto("c", { filmVendor: "Kodak" }),
    ];
    expect(deriveFieldValue(photos, (m) => m.filmVendor)).toBe("Kodak");
  });

  it("returns the value when only one photo is non-null and the rest are null", () => {
    const photos = [
      makePhoto("a"),
      makePhoto("b", { timezone: "Asia/Tokyo" }),
      makePhoto("c"),
    ];
    expect(deriveFieldValue(photos, (m) => m.timezone)).toBe("Asia/Tokyo");
  });

  it("returns 'multiple' when nulls are mixed with different non-null values", () => {
    const photos = [
      makePhoto("a", { cameraMake: "Nikon F3" }),
      makePhoto("b"),
      makePhoto("c", { cameraMake: "Canon AE-1" }),
    ];
    expect(deriveFieldValue(photos, (m) => m.cameraMake)).toBe("multiple");
  });

  // ── Numeric fields ────────────────────────────────────────────────────────

  it("works for numeric fields — returns value when all agree", () => {
    const photos = [
      makePhoto("a", { gpsLat: 35.6762 }),
      makePhoto("b", { gpsLat: 35.6762 }),
    ];
    expect(deriveFieldValue(photos, (m) => m.gpsLat)).toBe(35.6762);
  });

  it("works for numeric fields — returns 'multiple' when values differ", () => {
    const photos = [
      makePhoto("a", { gpsLat: 35.6762 }),
      makePhoto("b", { gpsLat: 48.8566 }),
    ];
    expect(deriveFieldValue(photos, (m) => m.gpsLat)).toBe("multiple");
  });

  it("treats 0 as a valid non-null value, not falsy", () => {
    const photos = [
      makePhoto("a", { gpsLat: 0 }),
      makePhoto("b", { gpsLat: 0 }),
    ];
    expect(deriveFieldValue(photos, (m) => m.gpsLat)).toBe(0);
  });
});
