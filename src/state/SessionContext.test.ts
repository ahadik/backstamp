import { sessionReducer, initialState } from "./SessionContext";
import type { Photo, Metadata, SessionState } from "./SessionContext";

const nullMetadata: Metadata = {
  captureDate: null,
  captureTime: null,
  utcOffset: null,
  timezone: null,
  gpsLat: null,
  gpsLng: null,
  cameraBody: null,
  lens: null,
  film: null,
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

  describe("unknown action", () => {
    it("returns state unchanged", () => {
      // @ts-expect-error intentional unknown action
      const next = sessionReducer(initialState, { type: "__UNKNOWN__" });
      expect(next).toBe(initialState);
    });
  });
});
