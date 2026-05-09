import React, { createContext, useContext, useReducer } from "react";

export interface CorpusEntry {
  value: string;
  isBuiltin: boolean;
  lastUsed: number | null;
  useCount: number;
  vendor?: string | null;
}

export interface CorpusState {
  cameraMakeOptions: CorpusEntry[];
  cameraModelOptions: CorpusEntry[];
  lensOptions: CorpusEntry[];
  filmVendors: CorpusEntry[];
  filmTypes: CorpusEntry[];
}

export type CorpusCategory = "camera_make" | "camera_model" | "lens" | "film_vendor" | "film_type";

type CorpusAction =
  | { type: "LOAD_CORPUS"; corpus: CorpusState }
  | { type: "ADD_ENTRY"; category: CorpusCategory; value: string; vendor?: string }
  | { type: "REMOVE_ENTRY"; category: CorpusCategory; value: string; vendor?: string }
  | { type: "RECORD_USE"; category: CorpusCategory; value: string; vendor?: string };

const initialState: CorpusState = {
  cameraMakeOptions: [],
  cameraModelOptions: [],
  lensOptions: [],
  filmVendors: [],
  filmTypes: [],
};

function corpusReducer(state: CorpusState, action: CorpusAction): CorpusState {
  switch (action.type) {
    case "LOAD_CORPUS":
      return action.corpus;

    case "ADD_ENTRY": {
      const vendor = action.vendor ?? null;
      const key = action.value.trim().toLowerCase();

      if (action.category === "camera_make") {
        if (state.cameraMakeOptions.some((e) => e.value.trim().toLowerCase() === key)) return state;
        const entry: CorpusEntry = { value: action.value.trim(), isBuiltin: false, lastUsed: null, useCount: 0 };
        return { ...state, cameraMakeOptions: [...state.cameraMakeOptions, entry] };
      }
      if (action.category === "camera_model") {
        if (state.cameraModelOptions.some(
          (e) => e.value.trim().toLowerCase() === key &&
                 (e.vendor ?? null) === vendor
        )) return state;
        const entry: CorpusEntry = { value: action.value.trim(), isBuiltin: false, lastUsed: null, useCount: 0, vendor };
        return { ...state, cameraModelOptions: [...state.cameraModelOptions, entry] };
      }
      if (action.category === "lens") {
        if (state.lensOptions.some((e) => e.value.trim().toLowerCase() === key)) return state;
        const entry: CorpusEntry = { value: action.value.trim(), isBuiltin: false, lastUsed: null, useCount: 0 };
        return { ...state, lensOptions: [...state.lensOptions, entry] };
      }
      if (action.category === "film_vendor") {
        if (state.filmVendors.some((e) => e.value.trim().toLowerCase() === key)) return state;
        const entry: CorpusEntry = { value: action.value.trim(), isBuiltin: false, lastUsed: null, useCount: 0 };
        return { ...state, filmVendors: [...state.filmVendors, entry] };
      }
      if (action.category === "film_type") {
        if (state.filmTypes.some(
          (e) => e.vendor?.toLowerCase() === vendor?.toLowerCase() && e.value.trim().toLowerCase() === key
        )) return state;
        const entry: CorpusEntry = { vendor, value: action.value.trim(), isBuiltin: false, lastUsed: null, useCount: 0 };
        return { ...state, filmTypes: [...state.filmTypes, entry] };
      }
      return state;
    }

    case "REMOVE_ENTRY": {
      const vendor = action.vendor ?? null;
      const key = action.value.trim().toLowerCase();

      if (action.category === "camera_make") {
        return { ...state, cameraMakeOptions: state.cameraMakeOptions.filter((e) => e.value.trim().toLowerCase() !== key) };
      }
      if (action.category === "camera_model") {
        return {
          ...state,
          cameraModelOptions: state.cameraModelOptions.filter(
            (e) => !(e.value.trim().toLowerCase() === key && (e.vendor ?? null) === vendor)
          ),
        };
      }
      if (action.category === "lens") {
        return { ...state, lensOptions: state.lensOptions.filter((e) => e.value.trim().toLowerCase() !== key) };
      }
      if (action.category === "film_vendor") {
        return {
          ...state,
          filmVendors: state.filmVendors.filter((e) => e.value.trim().toLowerCase() !== key),
          filmTypes: state.filmTypes.filter((e) => e.vendor?.toLowerCase() !== key),
        };
      }
      if (action.category === "film_type") {
        return {
          ...state,
          filmTypes: state.filmTypes.filter(
            (e) => !(e.vendor?.toLowerCase() === vendor?.toLowerCase() && e.value.trim().toLowerCase() === key)
          ),
        };
      }
      return state;
    }

    case "RECORD_USE": {
      const vendor = action.vendor ?? null;
      const key = action.value.trim().toLowerCase();
      const now = Date.now();

      if (action.category === "camera_make") {
        return {
          ...state,
          cameraMakeOptions: state.cameraMakeOptions.map((e) =>
            e.value.trim().toLowerCase() === key ? { ...e, lastUsed: now, useCount: e.useCount + 1 } : e
          ),
        };
      }
      if (action.category === "camera_model") {
        // Update vendor-exact matches; if none found, promote null-vendor (legacy) entries.
        let promoted = false;
        const updated = state.cameraModelOptions.map((e) => {
          if (e.value.trim().toLowerCase() !== key) return e;
          if ((e.vendor ?? null) === vendor) return { ...e, lastUsed: now, useCount: e.useCount + 1 };
          if (e.vendor == null && !promoted) {
            promoted = true;
            return { ...e, vendor: vendor, lastUsed: now, useCount: e.useCount + 1 };
          }
          return e;
        });
        return { ...state, cameraModelOptions: updated };
      }
      if (action.category === "lens") {
        return {
          ...state,
          lensOptions: state.lensOptions.map((e) =>
            e.value.trim().toLowerCase() === key ? { ...e, lastUsed: now, useCount: e.useCount + 1 } : e
          ),
        };
      }
      if (action.category === "film_vendor") {
        return {
          ...state,
          filmVendors: state.filmVendors.map((e) =>
            e.value.trim().toLowerCase() === key ? { ...e, lastUsed: now, useCount: e.useCount + 1 } : e
          ),
        };
      }
      if (action.category === "film_type") {
        return {
          ...state,
          filmTypes: state.filmTypes.map((e) =>
            e.vendor?.toLowerCase() === vendor?.toLowerCase() && e.value.trim().toLowerCase() === key
              ? { ...e, lastUsed: now, useCount: e.useCount + 1 }
              : e
          ),
        };
      }
      return state;
    }

    default:
      return state;
  }
}

interface CorpusContextValue {
  state: CorpusState;
  dispatch: React.Dispatch<CorpusAction>;
}

const CorpusContext = createContext<CorpusContextValue | null>(null);

export function CorpusProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(corpusReducer, initialState);
  return (
    <CorpusContext.Provider value={{ state, dispatch }}>
      {children}
    </CorpusContext.Provider>
  );
}

export function useCorpus(): CorpusContextValue {
  const ctx = useContext(CorpusContext);
  if (!ctx) throw new Error("useCorpus must be used within CorpusProvider");
  return ctx;
}

export { initialState as corpusInitialState, corpusReducer };
