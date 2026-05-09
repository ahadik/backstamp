import { corpusReducer, corpusInitialState } from "./CorpusContext";

describe("corpusReducer", () => {
  describe("initial state", () => {
    it("has empty option arrays", () => {
      expect(corpusInitialState.cameraMakeOptions).toEqual([]);
      expect(corpusInitialState.cameraModelOptions).toEqual([]);
      expect(corpusInitialState.lensOptions).toEqual([]);
      expect(corpusInitialState.filmVendors).toEqual([]);
      expect(corpusInitialState.filmTypes).toEqual([]);
    });
  });

  describe("LOAD_CORPUS", () => {
    it("replaces the entire corpus", () => {
      const corpus = {
        cameraMakeOptions: [{ value: "Canon", isBuiltin: true, lastUsed: null, useCount: 0 }],
        cameraModelOptions: [{ value: "EOS R5", isBuiltin: true, lastUsed: null, useCount: 0, vendor: "Canon" }],
        lensOptions: [],
        filmVendors: [],
        filmTypes: [],
      };
      const next = corpusReducer(corpusInitialState, { type: "LOAD_CORPUS", corpus });
      expect(next.cameraMakeOptions).toHaveLength(1);
      expect(next.cameraMakeOptions[0].value).toBe("Canon");
      expect(next.cameraModelOptions).toHaveLength(1);
      expect(next.cameraModelOptions[0].value).toBe("EOS R5");
    });
  });

  describe("ADD_ENTRY", () => {
    it("adds a new camera make entry", () => {
      const next = corpusReducer(corpusInitialState, {
        type: "ADD_ENTRY",
        category: "camera_make",
        value: "Fujifilm",
      });
      expect(next.cameraMakeOptions).toHaveLength(1);
      expect(next.cameraMakeOptions[0].value).toBe("Fujifilm");
      expect(next.cameraMakeOptions[0].isBuiltin).toBe(false);
      expect(next.cameraMakeOptions[0].useCount).toBe(0);
    });

    it("adds a new camera model entry with vendor", () => {
      const next = corpusReducer(corpusInitialState, {
        type: "ADD_ENTRY",
        category: "camera_model",
        value: "X-T5",
        vendor: "Fujifilm",
      });
      expect(next.cameraModelOptions).toHaveLength(1);
      expect(next.cameraModelOptions[0].value).toBe("X-T5");
      expect(next.cameraModelOptions[0].vendor).toBe("Fujifilm");
    });

    it("allows same model name under different makes", () => {
      const withFuji = corpusReducer(corpusInitialState, {
        type: "ADD_ENTRY",
        category: "camera_model",
        value: "X100",
        vendor: "Fujifilm",
      });
      const withCanon = corpusReducer(withFuji, {
        type: "ADD_ENTRY",
        category: "camera_model",
        value: "X100",
        vendor: "Canon",
      });
      expect(withCanon.cameraModelOptions).toHaveLength(2);
    });

    it("does not add a duplicate model under the same make (case-insensitive)", () => {
      const first = corpusReducer(corpusInitialState, {
        type: "ADD_ENTRY",
        category: "camera_model",
        value: "X-T5",
        vendor: "Fujifilm",
      });
      const second = corpusReducer(first, {
        type: "ADD_ENTRY",
        category: "camera_model",
        value: "x-t5",
        vendor: "Fujifilm",
      });
      expect(second.cameraModelOptions).toHaveLength(1);
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
        category: "film_vendor",
        value: "  Kodak  ",
      });
      expect(next.filmVendors[0].value).toBe("Kodak");
    });

    it("adds a film type with vendor association", () => {
      const next = corpusReducer(corpusInitialState, {
        type: "ADD_ENTRY",
        category: "film_type",
        value: "Portra 400",
        vendor: "Kodak",
      });
      expect(next.filmTypes[0].value).toBe("Portra 400");
      expect(next.filmTypes[0].vendor).toBe("Kodak");
    });
  });

  describe("REMOVE_ENTRY", () => {
    it("removes an existing camera make entry by value", () => {
      const withEntry = corpusReducer(corpusInitialState, {
        type: "ADD_ENTRY",
        category: "camera_make",
        value: "Sony",
      });
      const next = corpusReducer(withEntry, {
        type: "REMOVE_ENTRY",
        category: "camera_make",
        value: "Sony",
      });
      expect(next.cameraMakeOptions).toHaveLength(0);
    });

    it("is case-insensitive for make removal", () => {
      const withEntry = corpusReducer(corpusInitialState, {
        type: "ADD_ENTRY",
        category: "camera_make",
        value: "Sony",
      });
      const next = corpusReducer(withEntry, {
        type: "REMOVE_ENTRY",
        category: "camera_make",
        value: "SONY",
      });
      expect(next.cameraMakeOptions).toHaveLength(0);
    });

    it("removes camera model by value and vendor", () => {
      const withEntry = corpusReducer(corpusInitialState, {
        type: "ADD_ENTRY",
        category: "camera_model",
        value: "X-T5",
        vendor: "Fujifilm",
      });
      const next = corpusReducer(withEntry, {
        type: "REMOVE_ENTRY",
        category: "camera_model",
        value: "X-T5",
        vendor: "Fujifilm",
      });
      expect(next.cameraModelOptions).toHaveLength(0);
    });

    it("removing a film vendor also removes its types", () => {
      const withVendor = corpusReducer(corpusInitialState, {
        type: "ADD_ENTRY",
        category: "film_vendor",
        value: "Kodak",
      });
      const withType = corpusReducer(withVendor, {
        type: "ADD_ENTRY",
        category: "film_type",
        value: "Portra 400",
        vendor: "Kodak",
      });
      const next = corpusReducer(withType, {
        type: "REMOVE_ENTRY",
        category: "film_vendor",
        value: "Kodak",
      });
      expect(next.filmVendors).toHaveLength(0);
      expect(next.filmTypes).toHaveLength(0);
    });
  });

  describe("RECORD_USE", () => {
    it("increments useCount and sets lastUsed for make", () => {
      const withEntry = corpusReducer(corpusInitialState, {
        type: "ADD_ENTRY",
        category: "camera_make",
        value: "Fujifilm",
      });
      const before = Date.now();
      const next = corpusReducer(withEntry, {
        type: "RECORD_USE",
        category: "camera_make",
        value: "Fujifilm",
      });
      const after = Date.now();
      const entry = next.cameraMakeOptions[0];
      expect(entry.useCount).toBe(1);
      expect(entry.lastUsed).toBeGreaterThanOrEqual(before);
      expect(entry.lastUsed).toBeLessThanOrEqual(after);
    });

    it("increments useCount for camera model matched by value and vendor", () => {
      const withEntry = corpusReducer(corpusInitialState, {
        type: "ADD_ENTRY",
        category: "camera_model",
        value: "X-T5",
        vendor: "Fujifilm",
      });
      const next = corpusReducer(withEntry, {
        type: "RECORD_USE",
        category: "camera_model",
        value: "X-T5",
        vendor: "Fujifilm",
      });
      expect(next.cameraModelOptions[0].useCount).toBe(1);
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
