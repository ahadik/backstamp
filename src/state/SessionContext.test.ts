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
  describe("SELECT_ALL", () => {
    const base: SessionState = {
      ...initialState,
      photos: [makePhoto("a"), makePhoto("b"), makePhoto("c")],
    };

    it("selects every photo when no ids are given", () => {
      const next = sessionReducer(base, { type: "SELECT_ALL" });
      expect(next.selectedIds).toEqual(new Set(["a", "b", "c"]));
    });

    it("selects exactly the given ids when provided", () => {
      const next = sessionReducer(base, { type: "SELECT_ALL", ids: ["b"] });
      expect(next.selectedIds).toEqual(new Set(["b"]));
    });

    it("clears the selection when given an empty id list", () => {
      const selected = { ...base, selectedIds: new Set(["a", "c"]) };
      const next = sessionReducer(selected, { type: "SELECT_ALL", ids: [] });
      expect(next.selectedIds.size).toBe(0);
    });
  });

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

  describe("REFRESH_PHOTOS", () => {
    const base: SessionState = {
      ...initialState,
      photos: [
        makePhoto("a", { pendingChanges: { lens: "edited" }, currentMetadata: { ...nullMetadata, lens: "edited" } }),
        makePhoto("b"),
      ],
      selectedIds: new Set(["a", "gone"]),
      canRollback: true,
      metadataHistory: [[{ id: "a", currentMetadata: nullMetadata, pendingChanges: null }]],
      gpxFiles: [makeGpxFile("g1")],
    };
    const reloaded = [
      makePhoto("a", { originalMetadata: { ...nullMetadata, lens: "disk" }, currentMetadata: { ...nullMetadata, lens: "disk" } }),
      makePhoto("b"),
    ];

    it("replaces photos with the reloaded rows verbatim", () => {
      const next = sessionReducer(base, { type: "REFRESH_PHOTOS", photos: reloaded, canRollback: false });
      expect(next.photos).toEqual(reloaded);
      expect(next.photos[0].pendingChanges).toBeNull();
    });

    it("keeps the selection for photos that still exist and drops the rest", () => {
      const next = sessionReducer(base, { type: "REFRESH_PHOTOS", photos: reloaded, canRollback: false });
      expect(next.selectedIds).toEqual(new Set(["a"]));
    });

    it("clears edit history and adopts canRollback from the backend", () => {
      const next = sessionReducer(base, { type: "REFRESH_PHOTOS", photos: reloaded, canRollback: false });
      expect(next.metadataHistory).toEqual([]);
      expect(next.canRollback).toBe(false);
    });

    it("leaves GPX files untouched", () => {
      const next = sessionReducer(base, { type: "REFRESH_PHOTOS", photos: reloaded, canRollback: false });
      expect(next.gpxFiles).toBe(base.gpxFiles);
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
    it("adopts the reloaded rows, keeping backend-computed pendingChanges", () => {
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
      // No changes were on disk: backend returns current == original, no pending.
      const reloaded = makePhoto("a", {
        originalMetadata: original,
        currentMetadata: original,
        pendingChanges: null,
      });
      const next = sessionReducer(state, { type: "RESET_PHOTOS", updatedPhotos: [reloaded] });
      expect(next.photos[0].currentMetadata).toEqual(original);
      expect(next.photos[0].pendingChanges).toBeNull();
    });

    it("keeps non-null pendingChanges when disk is out of sync after reset", () => {
      const original: Metadata = { ...nullMetadata, cameraMake: "Canon" };
      const state: SessionState = {
        ...initialState,
        photos: [makePhoto("a", { originalMetadata: original })],
      };
      // Changes were applied to disk earlier: reset reverts current to import
      // values but keeps a pending diff so the import values can be written back.
      const reloaded = makePhoto("a", {
        originalMetadata: original,
        currentMetadata: original,
        pendingChanges: { cameraMake: "Canon" },
      });
      const next = sessionReducer(state, { type: "RESET_PHOTOS", updatedPhotos: [reloaded] });
      expect(next.photos[0].pendingChanges).toEqual({ cameraMake: "Canon" });
    });

    it("leaves photos not in the reloaded set unchanged", () => {
      const state: SessionState = {
        ...initialState,
        photos: [
          makePhoto("a", { pendingChanges: { lens: "RF 50mm" } }),
          makePhoto("b", { pendingChanges: { filmVendor: "Kodak", filmType: "Portra 400" } }),
        ],
      };
      const reloadedA = makePhoto("a", { pendingChanges: null });
      const next = sessionReducer(state, { type: "RESET_PHOTOS", updatedPhotos: [reloadedA] });
      expect(next.photos[0].pendingChanges).toBeNull();
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

    it("drops the removed file from the GPX selection", () => {
      const state: SessionState = {
        ...initialState,
        gpxFiles: [makeGpxFile("g1"), makeGpxFile("g2")],
        selectedGpxIds: new Set(["g1", "g2"]),
      };
      const next = sessionReducer(state, { type: "REMOVE_GPX", id: "g1" });
      expect([...next.selectedGpxIds]).toEqual(["g2"]);
    });
  });

  describe("SELECT_GPX", () => {
    const threeTracks: SessionState = {
      ...initialState,
      gpxFiles: [makeGpxFile("g1"), makeGpxFile("g2"), makeGpxFile("g3")],
    };

    it("selects a single track by default and clears the photo selection", () => {
      const state = { ...threeTracks, selectedIds: new Set(["p1"]) };
      const next = sessionReducer(state, { type: "SELECT_GPX", id: "g2" });
      expect([...next.selectedGpxIds]).toEqual(["g2"]);
      expect(next.selectedIds.size).toBe(0);
    });

    it("replaces the selection on a plain click", () => {
      const state = { ...threeTracks, selectedGpxIds: new Set(["g1", "g3"]) };
      const next = sessionReducer(state, { type: "SELECT_GPX", id: "g2", mode: "single" });
      expect([...next.selectedGpxIds]).toEqual(["g2"]);
    });

    it("deselects when the lone selected track is clicked again", () => {
      const state = { ...threeTracks, selectedGpxIds: new Set(["g2"]) };
      const next = sessionReducer(state, { type: "SELECT_GPX", id: "g2" });
      expect(next.selectedGpxIds.size).toBe(0);
    });

    it("toggles membership in cmd mode", () => {
      const state = { ...threeTracks, selectedGpxIds: new Set(["g1"]) };
      const added = sessionReducer(state, { type: "SELECT_GPX", id: "g3", mode: "cmd" });
      expect([...added.selectedGpxIds].sort()).toEqual(["g1", "g3"]);
      const removed = sessionReducer(added, { type: "SELECT_GPX", id: "g1", mode: "cmd" });
      expect([...removed.selectedGpxIds]).toEqual(["g3"]);
    });

    it("extends over the list order in shift mode", () => {
      const state = { ...threeTracks, selectedGpxIds: new Set(["g1"]) };
      const next = sessionReducer(state, { type: "SELECT_GPX", id: "g3", mode: "shift" });
      expect([...next.selectedGpxIds].sort()).toEqual(["g1", "g2", "g3"]);
    });

    it("shift-selects just the clicked track when nothing was selected", () => {
      const next = sessionReducer(threeTracks, { type: "SELECT_GPX", id: "g2", mode: "shift" });
      expect([...next.selectedGpxIds]).toEqual(["g2"]);
    });
  });

  describe("photo selection vs GPX selection", () => {
    it("selecting a photo clears the GPX selection", () => {
      const state: SessionState = {
        ...initialState,
        photos: [makePhoto("p1")],
        gpxFiles: [makeGpxFile("g1")],
        selectedGpxIds: new Set(["g1"]),
      };
      const next = sessionReducer(state, { type: "SELECT_SINGLE", id: "p1" });
      expect(next.selectedGpxIds.size).toBe(0);
      expect([...next.selectedIds]).toEqual(["p1"]);
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

// ── Offset derivation ─────────────────────────────────────────────────────────
//
// The stored offset follows date + time + zone for every edit, whichever
// control produced it — the inspector, a drag-and-drop, a track snap, a Vibe
// Tag proposal — so the reducer derives it rather than trusting each writer.

describe("sessionReducer offset derivation", () => {
  function withMeta(id: string, meta: Partial<Metadata>): Photo {
    const m = { ...nullMetadata, ...meta };
    return makePhoto(id, { originalMetadata: m, currentMetadata: m });
  }

  function stateWith(...photos: Photo[]): SessionState {
    return { ...initialState, photos };
  }

  it("derives the offset when a date lands on a photo that already has a zone", () => {
    const state = stateWith(withMeta("a", { timezone: "America/Denver" }));
    const next = sessionReducer(state, {
      type: "SET_PENDING", ids: ["a"], changes: { captureDate: "2026-07-03", captureTime: "00:00:00" },
    });
    expect(next.photos[0].currentMetadata.utcOffset).toBe("-06:00");
    expect(next.photos[0].pendingChanges).toEqual({
      captureDate: "2026-07-03", captureTime: "00:00:00", utcOffset: "-06:00",
    });
  });

  it("derives per photo in a batch, honouring each photo's own zone and date", () => {
    const state = stateWith(
      withMeta("a", { captureDate: "2026-01-15", timezone: "America/Denver" }),
      withMeta("b", { captureDate: "2026-07-03", timezone: "Asia/Tokyo" }),
    );
    const next = sessionReducer(state, {
      type: "SET_PENDING_BATCH",
      updates: [
        { id: "a", changes: { captureTime: "12:00:00" } },
        { id: "b", changes: { captureTime: "12:00:00" } },
      ],
    });
    expect(next.photos[0].currentMetadata.utcOffset).toBe("-07:00");
    expect(next.photos[1].currentMetadata.utcOffset).toBe("+09:00");
  });

  it("re-derives when the time crosses a DST transition", () => {
    const state = stateWith(withMeta("a", {
      captureDate: "2026-11-01", captureTime: "00:30:00", timezone: "America/Denver", utcOffset: "-06:00",
    }));
    const next = sessionReducer(state, {
      type: "SET_PENDING", ids: ["a"], changes: { captureTime: "15:00:00" },
    });
    expect(next.photos[0].currentMetadata.utcOffset).toBe("-07:00");
  });

  it("leaves the offset null when a zone is set on a photo with no date", () => {
    const state = stateWith(withMeta("a", {}));
    const next = sessionReducer(state, {
      type: "SET_PENDING", ids: ["a"], changes: { timezone: "America/Denver" },
    });
    expect(next.photos[0].currentMetadata.utcOffset).toBeNull();
    expect(next.photos[0].pendingChanges).toEqual({ timezone: "America/Denver", utcOffset: null });
  });

  it("clears the offset when the date is cleared on a zoned photo", () => {
    const state = stateWith(withMeta("a", {
      captureDate: "2026-07-03", timezone: "America/Denver", utcOffset: "-06:00",
    }));
    const next = sessionReducer(state, {
      type: "SET_PENDING", ids: ["a"], changes: { captureDate: null },
    });
    expect(next.photos[0].currentMetadata.utcOffset).toBeNull();
  });

  it("clears the offset when the zone is cleared", () => {
    const state = stateWith(withMeta("a", {
      captureDate: "2026-07-03", timezone: "America/Denver", utcOffset: "-06:00",
    }));
    const next = sessionReducer(state, {
      type: "SET_PENDING", ids: ["a"], changes: { timezone: null },
    });
    expect(next.photos[0].currentMetadata.utcOffset).toBeNull();
  });

  it("leaves a camera-recorded offset alone when no zone is involved", () => {
    const state = stateWith(withMeta("a", {
      captureDate: "2026-07-03", captureTime: "10:00:00", utcOffset: "+09:00",
    }));
    const next = sessionReducer(state, {
      type: "SET_PENDING", ids: ["a"], changes: { captureTime: "11:00:00" },
    });
    expect(next.photos[0].currentMetadata.utcOffset).toBe("+09:00");
    expect(next.photos[0].pendingChanges).toEqual({ captureTime: "11:00:00" });
  });

  it("does not touch the offset for edits outside the timestamp group", () => {
    const state = stateWith(withMeta("a", {
      captureDate: "2026-07-03", timezone: "America/Denver", utcOffset: "-06:00",
    }));
    const next = sessionReducer(state, {
      type: "SET_PENDING", ids: ["a"], changes: { gpsLat: 1, gpsLng: 2 },
    });
    expect(next.photos[0].pendingChanges).toEqual({ gpsLat: 1, gpsLng: 2 });
    expect(next.photos[0].currentMetadata.utcOffset).toBe("-06:00");
  });

  it("re-derives a missing offset for restored photos with pending timestamp edits", () => {
    // A session saved before the offset was derived centrally can carry a
    // pending date alongside a zone with no offset; restore repairs it.
    const original = { ...nullMetadata, timezone: "America/Denver" };
    const photo = makePhoto("a", {
      originalMetadata: original,
      currentMetadata: { ...original, captureDate: "2026-07-03", captureTime: "09:00:00" },
      pendingChanges: { captureDate: "2026-07-03", captureTime: "09:00:00" },
    });
    const next = sessionReducer(initialState, {
      type: "RESTORE_SESSION", photos: [photo], gpxFiles: [], canRollback: false,
    });
    expect(next.photos[0].currentMetadata.utcOffset).toBe("-06:00");
    expect(next.photos[0].pendingChanges?.utcOffset).toBe("-06:00");
  });

  it("restores photos without timestamp edits verbatim", () => {
    const m = { ...nullMetadata, captureDate: "2026-07-03", utcOffset: "+09:00" };
    const photo = makePhoto("a", {
      originalMetadata: m,
      currentMetadata: { ...m, gpsLat: 1, gpsLng: 2 },
      pendingChanges: { gpsLat: 1, gpsLng: 2 },
    });
    const next = sessionReducer(initialState, {
      type: "RESTORE_SESSION", photos: [photo], gpxFiles: [], canRollback: false,
    });
    expect(next.photos[0]).toBe(photo);
  });
});
