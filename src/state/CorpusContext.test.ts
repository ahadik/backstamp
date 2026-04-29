import { corpusReducer, corpusInitialState } from "./CorpusContext";

describe("corpusReducer", () => {
  describe("initial state", () => {
    it("has empty option arrays", () => {
      expect(corpusInitialState.cameraOptions).toEqual([]);
      expect(corpusInitialState.lensOptions).toEqual([]);
      expect(corpusInitialState.filmOptions).toEqual([]);
    });
  });

  describe("LOAD_CORPUS", () => {
    it("replaces the entire corpus", () => {
      const corpus = {
        cameraOptions: [{ value: "Canon EOS R5", isBuiltin: true, lastUsed: null, useCount: 0 }],
        lensOptions: [],
        filmOptions: [],
      };
      const next = corpusReducer(corpusInitialState, { type: "LOAD_CORPUS", corpus });
      expect(next.cameraOptions).toHaveLength(1);
      expect(next.cameraOptions[0].value).toBe("Canon EOS R5");
    });
  });

  describe("ADD_ENTRY", () => {
    it("adds a new camera entry", () => {
      const next = corpusReducer(corpusInitialState, {
        type: "ADD_ENTRY",
        category: "camera",
        value: "Fujifilm X-T5",
      });
      expect(next.cameraOptions).toHaveLength(1);
      expect(next.cameraOptions[0].value).toBe("Fujifilm X-T5");
      expect(next.cameraOptions[0].isBuiltin).toBe(false);
      expect(next.cameraOptions[0].useCount).toBe(0);
    });

    it("does not add a duplicate (case-insensitive)", () => {
      const first = corpusReducer(corpusInitialState, {
        type: "ADD_ENTRY",
        category: "lens",
        value: "RF 50mm",
      });
      const second = corpusReducer(first, {
        type: "ADD_ENTRY",
        category: "lens",
        value: "rf 50mm",
      });
      expect(second.lensOptions).toHaveLength(1);
    });

    it("trims whitespace from the value", () => {
      const next = corpusReducer(corpusInitialState, {
        type: "ADD_ENTRY",
        category: "film",
        value: "  Kodak Portra 400  ",
      });
      expect(next.filmOptions[0].value).toBe("Kodak Portra 400");
    });
  });

  describe("REMOVE_ENTRY", () => {
    it("removes an existing entry by value", () => {
      const withEntry = corpusReducer(corpusInitialState, {
        type: "ADD_ENTRY",
        category: "camera",
        value: "Sony A7IV",
      });
      const next = corpusReducer(withEntry, {
        type: "REMOVE_ENTRY",
        category: "camera",
        value: "Sony A7IV",
      });
      expect(next.cameraOptions).toHaveLength(0);
    });

    it("is case-insensitive", () => {
      const withEntry = corpusReducer(corpusInitialState, {
        type: "ADD_ENTRY",
        category: "camera",
        value: "Sony A7IV",
      });
      const next = corpusReducer(withEntry, {
        type: "REMOVE_ENTRY",
        category: "camera",
        value: "SONY A7IV",
      });
      expect(next.cameraOptions).toHaveLength(0);
    });
  });

  describe("RECORD_USE", () => {
    it("increments useCount and sets lastUsed", () => {
      const withEntry = corpusReducer(corpusInitialState, {
        type: "ADD_ENTRY",
        category: "film",
        value: "Fujicolor 200",
      });
      const before = Date.now();
      const next = corpusReducer(withEntry, {
        type: "RECORD_USE",
        category: "film",
        value: "Fujicolor 200",
      });
      const after = Date.now();
      const entry = next.filmOptions[0];
      expect(entry.useCount).toBe(1);
      expect(entry.lastUsed).toBeGreaterThanOrEqual(before);
      expect(entry.lastUsed).toBeLessThanOrEqual(after);
    });
  });

  describe("unknown action", () => {
    it("returns state unchanged", () => {
      // @ts-expect-error intentional unknown action
      const next = corpusReducer(corpusInitialState, { type: "__UNKNOWN__" });
      expect(next).toBe(corpusInitialState);
    });
  });
});
