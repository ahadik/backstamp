import { buildApplyPayload } from "./applyUtils";
import type { Photo, Metadata } from "../state/SessionContext";

const nullMeta: Metadata = {
  captureDate: null,
  captureTime: null,
  utcOffset: null,
  timezone: null,
  gpsLat: null,
  gpsLng: null,
  cameraMake: null,
  cameraModel: null,
  lens: null,
  filmVendor: null,
  filmType: null,
};

function makePhoto(id: string, pending: Partial<Metadata> | null = null, current: Partial<Metadata> = {}): Photo {
  return {
    id,
    filePath: `/photos/${id}.jpg`,
    fileStatus: "ok",
    thumbnail: { small: "", large: "" },
    originalMetadata: { ...nullMeta },
    currentMetadata: { ...nullMeta, ...current },
    pendingChanges: pending,
  };
}

describe("buildApplyPayload", () => {
  it("skips photos with no pending changes", () => {
    const photos = [makePhoto("a"), makePhoto("b", { lens: "Canon RF 50mm" })];
    const payload = buildApplyPayload(photos);
    expect(Object.keys(payload.changes)).not.toContain("a");
    expect(Object.keys(payload.changes)).toContain("b");
  });

  it("includes utcOffset when captureDate and timezone are present in pending", () => {
    const photos = [
      makePhoto("a", { captureDate: "2024-07-15", timezone: "America/Los_Angeles" }),
    ];
    const payload = buildApplyPayload(photos);
    expect(payload.changes["a"].utcOffset).toBe("-07:00");
  });

  it("uses current metadata timezone when timezone not in pending but captureDate is", () => {
    const photos = [
      makePhoto(
        "a",
        { captureDate: "2024-01-15" },
        { timezone: "America/Los_Angeles" }
      ),
    ];
    const payload = buildApplyPayload(photos);
    expect(payload.changes["a"].utcOffset).toBe("-08:00");
  });

  it("sets utcOffset to null when captureDate is missing from pending and current", () => {
    const photos = [makePhoto("a", { timezone: "America/Los_Angeles" })];
    const payload = buildApplyPayload(photos);
    expect(payload.changes["a"].utcOffset).toBeNull();
  });

  // ── captureDate / captureTime supplement ──────────────────────────────────

  it("supplements captureDate from current when only captureTime is pending", () => {
    const photos = [
      makePhoto("a", { captureTime: "14:30:00" }, { captureDate: "2024-03-15" }),
    ];
    const payload = buildApplyPayload(photos);
    expect(payload.changes["a"].captureDate).toBe("2024-03-15");
    expect(payload.changes["a"].captureTime).toBe("14:30:00");
  });

  it("does not supplement captureDate when current captureDate is null", () => {
    const photos = [makePhoto("a", { captureTime: "14:30:00" })];
    const payload = buildApplyPayload(photos);
    expect("captureDate" in payload.changes["a"]).toBe(false);
  });

  it("supplements captureTime from current when only captureDate is pending", () => {
    const photos = [
      makePhoto("a", { captureDate: "2024-03-15" }, { captureTime: "09:00:00" }),
    ];
    const payload = buildApplyPayload(photos);
    expect(payload.changes["a"].captureDate).toBe("2024-03-15");
    expect(payload.changes["a"].captureTime).toBe("09:00:00");
  });

  it("supplements captureTime as null when current captureTime is null", () => {
    const photos = [makePhoto("a", { captureDate: "2024-03-15" })];
    const payload = buildApplyPayload(photos);
    expect(payload.changes["a"].captureTime).toBeNull();
  });

  it("computes utcOffset from current date when only captureTime is pending", () => {
    const photos = [
      makePhoto(
        "a",
        { captureTime: "14:30:00" },
        { captureDate: "2024-07-15", timezone: "America/Los_Angeles" }
      ),
    ];
    const payload = buildApplyPayload(photos);
    expect(payload.changes["a"].utcOffset).toBe("-07:00");
  });

  it("sets utcOffset to null when timezone is missing from both pending and current", () => {
    const photos = [makePhoto("a", { captureDate: "2024-07-15" })];
    const payload = buildApplyPayload(photos);
    expect(payload.changes["a"].utcOffset).toBeNull();
  });

  it("includes all pending fields in the payload", () => {
    const photos = [
      makePhoto("a", { cameraMake: "Canon", cameraModel: "EOS R5", lens: "RF 50mm" }),
    ];
    const payload = buildApplyPayload(photos);
    expect(payload.changes["a"].cameraMake).toBe("Canon");
    expect(payload.changes["a"].cameraModel).toBe("EOS R5");
    expect(payload.changes["a"].lens).toBe("RF 50mm");
  });

  it("returns empty changes when no photos have pending", () => {
    const photos = [makePhoto("a"), makePhoto("b")];
    const payload = buildApplyPayload(photos);
    expect(Object.keys(payload.changes)).toHaveLength(0);
  });
});
