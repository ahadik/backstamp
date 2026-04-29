import { sessionReducer, initialState } from "./SessionContext";
import type { Photo, Metadata, SessionState } from "./SessionContext";

const nullMetadata: Metadata = {
  captureDate: null,
  captureTime: null,
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

  describe("unknown action", () => {
    it("returns state unchanged", () => {
      // @ts-expect-error intentional unknown action
      const next = sessionReducer(initialState, { type: "__UNKNOWN__" });
      expect(next).toBe(initialState);
    });
  });
});
