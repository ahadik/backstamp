import { describe, it, expect } from "vitest";
import {
  selectedPhotosInGridOrder,
  selectedGpxFiles,
  clampIndex,
  isTextEntryTarget,
  fileNameOf,
} from "./previewItems";
import { EMPTY_PHOTO_FILTERS } from "../../state/selectors";
import type { Photo, GpxFile, Metadata } from "../../state/SessionContext";

const nullMeta: Metadata = {
  captureDate: null, captureTime: null, utcOffset: null, timezone: null,
  gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null,
  lens: null, filmVendor: null, filmType: null,
};

function makePhoto(id: string, meta: Partial<Metadata> = {}): Photo {
  return {
    id,
    filePath: `/photos/${id}.jpg`,
    fileStatus: "ok",
    thumbnail: { small: `/t/${id}_s.jpg`, large: `/t/${id}_l.jpg` },
    originalMetadata: { ...nullMeta, ...meta },
    currentMetadata: { ...nullMeta, ...meta },
    pendingChanges: null,
  };
}

function makeGpx(id: string): GpxFile {
  return { id, filePath: `/gpx/${id}.gpx`, addedAt: 0, trackPoints: [], thumbnailPath: null, timezone: null };
}

describe("selectedPhotosInGridOrder", () => {
  const early = makePhoto("early", { captureDate: "2026-01-01", captureTime: "08:00:00", utcOffset: "+00:00" });
  const late = makePhoto("late", { captureDate: "2026-01-01", captureTime: "18:00:00", utcOffset: "+00:00" });
  const other = makePhoto("other", { captureDate: "2026-01-02", captureTime: "12:00:00", utcOffset: "+00:00" });

  it("returns nothing when nothing is selected", () => {
    expect(selectedPhotosInGridOrder([early, late], new Set(), EMPTY_PHOTO_FILTERS, "UTC")).toEqual([]);
  });

  it("orders by grid position, not click order", () => {
    const result = selectedPhotosInGridOrder(
      [late, early, other],
      new Set(["late", "early"]),
      EMPTY_PHOTO_FILTERS,
      "UTC"
    );
    expect(result.map((p) => p.id)).toEqual(["early", "late"]);
  });

  it("excludes selected photos hidden by an active filter", () => {
    const result = selectedPhotosInGridOrder(
      [early, late, other],
      new Set(["early", "other"]),
      { ...EMPTY_PHOTO_FILTERS, dateAfter: "2026-01-02" },
      "UTC"
    );
    expect(result.map((p) => p.id)).toEqual(["other"]);
  });
});

describe("selectedGpxFiles", () => {
  it("keeps list order and drops unselected files", () => {
    const files = [makeGpx("a"), makeGpx("b"), makeGpx("c")];
    expect(selectedGpxFiles(files, new Set(["c", "a"])).map((g) => g.id)).toEqual(["a", "c"]);
    expect(selectedGpxFiles(files, new Set())).toEqual([]);
  });
});

describe("clampIndex", () => {
  it("stops at either end instead of wrapping", () => {
    expect(clampIndex(-1, 3)).toBe(0);
    expect(clampIndex(3, 3)).toBe(2);
    expect(clampIndex(1, 3)).toBe(1);
    expect(clampIndex(5, 0)).toBe(0);
  });
});

describe("isTextEntryTarget", () => {
  it("is true for fields and buttons, false for plain elements", () => {
    expect(isTextEntryTarget(document.createElement("input"))).toBe(true);
    expect(isTextEntryTarget(document.createElement("textarea"))).toBe(true);
    expect(isTextEntryTarget(document.createElement("select"))).toBe(true);
    expect(isTextEntryTarget(document.createElement("button"))).toBe(true);
    expect(isTextEntryTarget(document.createElement("div"))).toBe(false);
    expect(isTextEntryTarget(document.body)).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});

describe("fileNameOf", () => {
  it("returns the last path segment", () => {
    expect(fileNameOf("/a/b/IMG_0001.jpg")).toBe("IMG_0001.jpg");
    expect(fileNameOf("IMG.jpg")).toBe("IMG.jpg");
  });
});
