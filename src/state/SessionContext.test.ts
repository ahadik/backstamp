import { sessionReducer, initialState } from "./SessionContext";
import type { Photo, Metadata, SessionState, GpxFile } from "./SessionContext";

function makeGpxFile(id: string, overrides: Partial<GpxFile> = {}): GpxFile {
  return {
    id,
    filePath: `/gpx/${id}.gpx`,
    addedAt: 1700000000,
    trackPoints: [],
    thumbnailPath: null,
    timezone: null,
    ...overrides,
  };
}

const nullMetadata: Metadata = {
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

function makePhoto(id: string, overrides: Partial<Photo> = {}): Photo {
  return {
    id,
    filePath: `/photos/${id}.jpg`,
    fileStatus: "ok",
    thumbnail: { small: `/thumb/${id}_small.jpg`, large: `/thumb/${id}_large.jpg` },
    originalMetadata: nullMetadata,
    currentMetadata: nullMetadata,
    pendingChanges: null,
    ...overrides,
  };
}

describe("sessionReducer", () => {
  describe("RESTORE_SESSION", () => {
    it("sets photos from the action", () => {
      const photos = [makePhoto("a"), makePhoto("b")];
      const next = sessionReducer(initialState, {
        type: "RESTORE_SESSION", photos, gpxFiles: [], canRollback: false,
      });
      expect(next.photos).toEqual(photos);
    });

    it("sets gpxFiles from the action", () => {
      const gpxFiles = [makeGpxFile("g1")];
      const next = sessionReducer(initialState, {
        type: "RESTORE_SESSION", photos: [], gpxFiles, canRollback: false,
      });
      expect(next.gpxFiles).toEqual(gpxFiles);
    });

    it("sets canRollback from the action", () => {
      const next = sessionReducer(initialState, {
        type: "RESTORE_SESSION", photos: [], gpxFiles: [], canRollback: true,
      });
      expect(next.canRollback).toBe(true);
    });

    it("always clears selectedIds regardless of prior state", () => {
      const withSelection = { ...initialState, selectedIds: new Set(["a", "b"]) };
      const next = sessionReducer(withSelection, {
        type: "RESTORE_SESSION", photos: [], gpxFiles: [], canRollback: false,
      });
      expect(next.selectedIds.size).toBe(0);
    });

    it("restores a photo with fileStatus missing", () => {
      const photo = makePhoto("a", { fileStatus: "missing" });
      const next = sessionReducer(initialState, {
        type: "RESTORE_SESSION", photos: [photo], gpxFiles: [], canRollback: false,
      });
      expect(next.photos[0].fileStatus).toBe("missing");
    });

    it("restores a photo with non-null pendingChanges", () => {
      const photo = makePhoto("a", { pendingChanges: { captureDate: "2024-03-15" } });
      const next = sessionReducer(initialState, {
        type: "RESTORE_SESSION", photos: [photo], gpxFiles: [], canRollback: false,
      });
      expect(next.photos[0].pendingChanges).toEqual({ captureDate: "2024-03-15" });
    });
  });

  describe("CLEAR_SESSION", () => {
    it("resets to initial state", () => {
      const state: SessionState = {
        ...initialState,
        photos: [makePhoto("a")],
        applyInProgress: true,
      };
      const next = sessionReducer(state, { type: "CLEAR_SESSION" });
      expect(next).toEqual(initialState);
      expect(next.photos).toHaveLength(0);
    });
  });

  describe("IMPORT_PHOTO_PROGRESS", () => {
    it("appends the photo to the list", () => {
      const photo = makePhoto("p1");
      const next = sessionReducer(initialState, { type: "IMPORT_PHOTO_PROGRESS", photo });
      expect(next.photos).toHaveLength(1);
      expect(next.photos[0].id).toBe("p1");
    });

    it("does not mutate the original state array", () => {
      const photo = makePhoto("p1");
      const next = sessionReducer(initialState, { type: "IMPORT_PHOTO_PROGRESS", photo });
      expect(initialState.photos).toHaveLength(0);
      expect(next.photos).not.toBe(initialState.photos);
    });

    it("appends even when a photo with the same id already exists", () => {
      const photo = makePhoto("dup");
      const stateWithOne = sessionReducer(initialState, { type: "IMPORT_PHOTO_PROGRESS", photo });
      const next = sessionReducer(stateWithOne, { type: "IMPORT_PHOTO_PROGRESS", photo });
      expect(next.photos).toHaveLength(2);
    });
  });

  describe("IMPORT_PHOTOS", () => {
    it("bulk-appends all photos", () => {
      const photos = [makePhoto("a"), makePhoto("b")];
      const next = sessionReducer(initialState, { type: "IMPORT_PHOTOS", photos });
      expect(next.photos).toHaveLength(2);
    });
  });

  describe("SELECT", () => {
    it("single mode clears previous selection and selects only the clicked photo", () => {
      const state = sessionReducer(initialState, {
        type: "IMPORT_PHOTOS",
        photos: [makePhoto("a"), makePhoto("b")],
      });
      const withA = sessionReducer(state, { type: "SELECT", id: "a", mode: "single" });
      const withB = sessionReducer(withA, { type: "SELECT", id: "b", mode: "single" });
      expect(withB.selectedIds.has("a")).toBe(false);
      expect(withB.selectedIds.has("b")).toBe(true);
    });

    it("cmd mode toggles selection", () => {
      const state = sessionReducer(initialState, {
        type: "IMPORT_PHOTOS",
        photos: [makePhoto("a"), makePhoto("b")],
      });
      const withA = sessionReducer(state, { type: "SELECT", id: "a", mode: "cmd" });
      expect(withA.selectedIds.has("a")).toBe(true);
      const withoutA = sessionReducer(withA, { type: "SELECT", id: "a", mode: "cmd" });
      expect(withoutA.selectedIds.has("a")).toBe(false);
    });
  });

  describe("REMOVE_PHOTOS", () => {
    it("removes photos by id", () => {
      const state = sessionReducer(initialState, {
        type: "IMPORT_PHOTOS",
        photos: [makePhoto("a"), makePhoto("b"), makePhoto("c")],
      });
      const next = sessionReducer(state, { type: "REMOVE_PHOTOS", ids: ["a", "c"] });
      expect(next.photos.map((p) => p.id)).toEqual(["b"]);
    });

    it("also removes the photo from selectedIds", () => {
      const state: SessionState = {
        ...initialState,
        photos: [makePhoto("a")],
        selectedIds: new Set(["a"]),
      };
      const next = sessionReducer(state, { type: "REMOVE_PHOTOS", ids: ["a"] });
      expect(next.selectedIds.has("a")).toBe(false);
    });
  });

  describe("MARK_MISSING", () => {
    it("sets fileStatus to missing for the given ids", () => {
      const state = sessionReducer(initialState, {
        type: "IMPORT_PHOTOS",
        photos: [makePhoto("a"), makePhoto("b")],
      });
      const next = sessionReducer(state, { type: "MARK_MISSING", ids: ["a"] });
      expect(next.photos.find((p) => p.id === "a")?.fileStatus).toBe("missing");
      expect(next.photos.find((p) => p.id === "b")?.fileStatus).toBe("ok");
    });
  });

  describe("SELECT_SINGLE", () => {
    it("selects only the given photo, clearing previous selection", () => {
      const state: SessionState = {
        ...initialState,
        photos: [makePhoto("a"), makePhoto("b")],
        selectedIds: new Set(["a", "b"]),
      };
      const next = sessionReducer(state, { type: "SELECT_SINGLE", id: "b" });
      expect(next.selectedIds.has("a")).toBe(false);
      expect(next.selectedIds.has("b")).toBe(true);
      expect(next.selectedIds.size).toBe(1);
    });
  });

  describe("TOGGLE_SELECT", () => {
    it("adds an unselected photo to the selection", () => {
      const state: SessionState = { ...initialState, photos: [makePhoto("a")] };
      const next = sessionReducer(state, { type: "TOGGLE_SELECT", id: "a" });
      expect(next.selectedIds.has("a")).toBe(true);
    });

    it("removes an already-selected photo from the selection", () => {
      const state: SessionState = {
        ...initialState,
        photos: [makePhoto("a")],
        selectedIds: new Set(["a"]),
      };
      const next = sessionReducer(state, { type: "TOGGLE_SELECT", id: "a" });
      expect(next.selectedIds.has("a")).toBe(false);
    });

    it("does not affect other selected photos", () => {
      const state: SessionState = {
        ...initialState,
        photos: [makePhoto("a"), makePhoto("b")],
        selectedIds: new Set(["a", "b"]),
      };
      const next = sessionReducer(state, { type: "TOGGLE_SELECT", id: "a" });
      expect(next.selectedIds.has("b")).toBe(true);
    });
  });

  describe("SELECT_RANGE", () => {
    const orderedIds = ["a", "b", "c", "d", "e"];

    it("selects all photos between fromId and toId inclusive", () => {
      const state: SessionState = {
        ...initialState,
        photos: orderedIds.map((id) => makePhoto(id)),
      };
      const next = sessionReducer(state, {
        type: "SELECT_RANGE",
        fromId: "b",
        toId: "d",
        orderedIds,
      });
      expect([...next.selectedIds].sort()).toEqual(["b", "c", "d"]);
    });

    it("works when toId comes before fromId in the list", () => {
      const state: SessionState = {
        ...initialState,
        photos: orderedIds.map((id) => makePhoto(id)),
      };
      const next = sessionReducer(state, {
        type: "SELECT_RANGE",
        fromId: "d",
        toId: "b",
        orderedIds,
      });
      expect([...next.selectedIds].sort()).toEqual(["b", "c", "d"]);
    });

    it("adds to existing selection without clearing it", () => {
      const state: SessionState = {
        ...initialState,
        photos: orderedIds.map((id) => makePhoto(id)),
        selectedIds: new Set(["a"]),
      };
      const next = sessionReducer(state, {
        type: "SELECT_RANGE",
        fromId: "c",
        toId: "d",
        orderedIds,
      });
      expect(next.selectedIds.has("a")).toBe(true);
      expect(next.selectedIds.has("c")).toBe(true);
      expect(next.selectedIds.has("d")).toBe(true);
    });

    it("returns state unchanged when fromId is not in orderedIds", () => {
      const state: SessionState = {
        ...initialState,
        photos: orderedIds.map((id) => makePhoto(id)),
      };
      const next = sessionReducer(state, {
        type: "SELECT_RANGE",
        fromId: "z",
        toId: "b",
        orderedIds,
      });
      expect(next.selectedIds.size).toBe(0);
    });
  });

  describe("REORDER_PHOTOS", () => {
    it("reorders photos to match the given id order", () => {
      const state = sessionReducer(initialState, {
        type: "IMPORT_PHOTOS",
        photos: [makePhoto("a"), makePhoto("b"), makePhoto("c")],
      });
      const next = sessionReducer(state, {
        type: "REORDER_PHOTOS",
        orderedIds: ["c", "a", "b"],
      });
      expect(next.photos.map((p) => p.id)).toEqual(["c", "a", "b"]);
    });

    it("ignores ids not present in the current photos list", () => {
      const state = sessionReducer(initialState, {
        type: "IMPORT_PHOTOS",
        photos: [makePhoto("a"), makePhoto("b")],
      });
      const next = sessionReducer(state, {
        type: "REORDER_PHOTOS",
        orderedIds: ["b", "ghost", "a"],
      });
      expect(next.photos.map((p) => p.id)).toEqual(["b", "a"]);
    });
  });

  describe("RESET_PHOTOS", () => {
    it("restores currentMetadata from originalMetadata and clears pendingChanges", () => {
      const original: Metadata = { ...nullMetadata, cameraMake: "Canon", cameraModel: "EOS R5" };
      const state: SessionState = {
        ...initialState,
        photos: [
          makePhoto("a", {
            originalMetadata: original,
            currentMetadata: { ...original, lens: "RF 50mm" },
            pendingChanges: { lens: "RF 50mm" },
          }),
        ],
      };
      const next = sessionReducer(state, { type: "RESET_PHOTOS", ids: ["a"] });
      expect(next.photos[0].currentMetadata).toEqual(original);
      expect(next.photos[0].pendingChanges).toBeNull();
    });

    it("leaves photos not in ids unchanged", () => {
      const state: SessionState = {
        ...initialState,
        photos: [
          makePhoto("a", { pendingChanges: { lens: "RF 50mm" } }),
          makePhoto("b", { pendingChanges: { filmVendor: "Kodak", filmType: "Portra 400" } }),
        ],
      };
      const next = sessionReducer(state, { type: "RESET_PHOTOS", ids: ["a"] });
      expect(next.photos[1].pendingChanges).toEqual({ filmVendor: "Kodak", filmType: "Portra 400" });
    });
  });

  describe("APPLY_COMPLETE", () => {
    it("clears applyInProgress and updates canRollback", () => {
      const state: SessionState = { ...initialState, applyInProgress: true };
      const updated = makePhoto("a", { pendingChanges: null });
      const next = sessionReducer(state, {
        type: "APPLY_COMPLETE",
        updatedPhotos: [updated],
        canRollback: true,
      });
      expect(next.applyInProgress).toBe(false);
      expect(next.canRollback).toBe(true);
    });

    it("merges updatedPhotos into existing photos by id", () => {
      const state: SessionState = {
        ...initialState,
        photos: [makePhoto("a"), makePhoto("b")],
      };
      const updated = makePhoto("a", {
        currentMetadata: { ...nullMetadata, lens: "RF 50mm" },
      });
      const next = sessionReducer(state, {
        type: "APPLY_COMPLETE",
        updatedPhotos: [updated],
        canRollback: false,
      });
      expect(next.photos.find((p) => p.id === "a")?.currentMetadata.lens).toBe("RF 50mm");
      expect(next.photos.find((p) => p.id === "b")?.id).toBe("b");
    });
  });

  describe("ROLLBACK_COMPLETE", () => {
    it("updates canRollback from the result", () => {
      const state: SessionState = { ...initialState, canRollback: true };
      const next = sessionReducer(state, {
        type: "ROLLBACK_COMPLETE",
        restoredPhotos: [],
        canRollback: false,
      });
      expect(next.canRollback).toBe(false);
    });

    it("sets canRollback to true when more history remains", () => {
      const state: SessionState = { ...initialState, canRollback: false };
      const next = sessionReducer(state, {
        type: "ROLLBACK_COMPLETE",
        restoredPhotos: [],
        canRollback: true,
      });
      expect(next.canRollback).toBe(true);
    });

    it("merges restoredPhotos into existing photos by id", () => {
      const state: SessionState = {
        ...initialState,
        photos: [makePhoto("a"), makePhoto("b")],
      };
      const restored = makePhoto("a", {
        currentMetadata: { ...nullMetadata, cameraMake: "Nikon" },
      });
      const next = sessionReducer(state, {
        type: "ROLLBACK_COMPLETE",
        restoredPhotos: [restored],
        canRollback: false,
      });
      expect(next.photos.find((p) => p.id === "a")?.currentMetadata.cameraMake).toBe("Nikon");
    });
  });

  describe("unknown action", () => {
    it("returns state unchanged", () => {
      // @ts-expect-error intentional unknown action
      const next = sessionReducer(initialState, { type: "__UNKNOWN__" });
      expect(next).toBe(initialState);
    });
  });

  describe("ADD_GPX", () => {
    it("appends a GPX file to gpxFiles", () => {
      const gpxFile = makeGpxFile("g1");
      const next = sessionReducer(initialState, { type: "ADD_GPX", gpxFile });
      expect(next.gpxFiles).toHaveLength(1);
      expect(next.gpxFiles[0].id).toBe("g1");
    });

    it("ignores duplicate GPX files with the same id", () => {
      const gpxFile = makeGpxFile("g1");
      const withOne = sessionReducer(initialState, { type: "ADD_GPX", gpxFile });
      const withDup = sessionReducer(withOne, { type: "ADD_GPX", gpxFile });
      expect(withDup.gpxFiles).toHaveLength(1);
    });
  });

  describe("REMOVE_GPX", () => {
    it("removes a GPX file by id", () => {
      const state: SessionState = {
        ...initialState,
        gpxFiles: [makeGpxFile("g1"), makeGpxFile("g2")],
      };
      const next = sessionReducer(state, { type: "REMOVE_GPX", id: "g1" });
      expect(next.gpxFiles).toHaveLength(1);
      expect(next.gpxFiles[0].id).toBe("g2");
    });
  });

  describe("UPDATE_GPX_THUMBNAIL", () => {
    it("updates thumbnailPath for the matching GPX file", () => {
      const state: SessionState = {
        ...initialState,
        gpxFiles: [makeGpxFile("g1"), makeGpxFile("g2")],
      };
      const next = sessionReducer(state, {
        type: "UPDATE_GPX_THUMBNAIL",
        id: "g1",
        thumbnailPath: "/thumbs/gpx_g1.jpg",
      });
      expect(next.gpxFiles[0].thumbnailPath).toBe("/thumbs/gpx_g1.jpg");
      expect(next.gpxFiles[1].thumbnailPath).toBeNull();
    });
  });
});
