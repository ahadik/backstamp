import React, { createContext, useContext, useReducer } from "react";

export interface CorpusEntry {
  value: string;
  isBuiltin: boolean;
  lastUsed: number | null;
  useCount: number;
}

export interface CorpusState {
  cameraOptions: CorpusEntry[];
  lensOptions: CorpusEntry[];
  filmOptions: CorpusEntry[];
}

type CorpusAction =
  | { type: "LOAD_CORPUS"; corpus: CorpusState }
  | { type: "ADD_ENTRY"; category: "camera" | "lens" | "film"; value: string }
  | { type: "REMOVE_ENTRY"; category: "camera" | "lens" | "film"; value: string }
  | { type: "RECORD_USE"; category: "camera" | "lens" | "film"; value: string };

const initialState: CorpusState = {
  cameraOptions: [],
  lensOptions: [],
  filmOptions: [],
};

function getList(
  state: CorpusState,
  category: "camera" | "lens" | "film"
): CorpusEntry[] {
  if (category === "camera") return state.cameraOptions;
  if (category === "lens") return state.lensOptions;
  return state.filmOptions;
}

function setList(
  state: CorpusState,
  category: "camera" | "lens" | "film",
  list: CorpusEntry[]
): CorpusState {
  if (category === "camera") return { ...state, cameraOptions: list };
  if (category === "lens") return { ...state, lensOptions: list };
  return { ...state, filmOptions: list };
}

function corpusReducer(state: CorpusState, action: CorpusAction): CorpusState {
  switch (action.type) {
    case "LOAD_CORPUS":
      return action.corpus;

    case "ADD_ENTRY": {
      const list = getList(state, action.category);
      const key = action.value.trim().toLowerCase();
      if (list.some((e) => e.value.trim().toLowerCase() === key)) return state;
      const newEntry: CorpusEntry = {
        value: action.value.trim(),
        isBuiltin: false,
        lastUsed: null,
        useCount: 0,
      };
      return setList(state, action.category, [...list, newEntry]);
    }

    case "REMOVE_ENTRY": {
      const list = getList(state, action.category);
      const key = action.value.trim().toLowerCase();
      return setList(
        state,
        action.category,
        list.filter((e) => e.value.trim().toLowerCase() !== key)
      );
    }

    case "RECORD_USE": {
      const list = getList(state, action.category);
      const key = action.value.trim().toLowerCase();
      const updated = list.map((e) =>
        e.value.trim().toLowerCase() === key
          ? { ...e, lastUsed: Date.now(), useCount: e.useCount + 1 }
          : e
      );
      return setList(state, action.category, updated);
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
