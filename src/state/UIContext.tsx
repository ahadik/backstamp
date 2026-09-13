import React, { createContext, useContext, useReducer, useEffect, useRef } from "react";
import { tauriCommands } from "../lib/tauri";
import { reportError, setErrorHandler } from "../lib/errors";
import { EMPTY_PHOTO_FILTERS, type PhotoFilters } from "./selectors";

export interface UIState {
  workingTimezone: string;  // IANA name, display-only
  gridColumns: number;      // target number of columns in the photo grid
  panelWidth: number;       // current photo grid panel width in px (updated by PhotoGrid)
  mapPanelHeight: number;   // px
  photoFilters: PhotoFilters; // session-only view filters, never persisted
  mapboxToken: string | null;
  googleMapsKey: string | null;
  claudeApiKey: string | null;
  error: string | null;
}

type UIAction =
  | { type: "SET_WORKING_TIMEZONE"; timezone: string }
  | { type: "SET_GRID_COLUMNS"; columns: number }
  | { type: "SET_PANEL_WIDTH"; width: number }
  | { type: "SET_MAP_PANEL_HEIGHT"; height: number }
  | { type: "SET_PHOTO_FILTERS"; filters: Partial<PhotoFilters> }
  | { type: "RESET_PHOTO_FILTERS" }
  | { type: "SET_MAPBOX_TOKEN"; token: string | null }
  | { type: "SET_GOOGLE_MAPS_KEY"; key: string | null }
  | { type: "SET_CLAUDE_API_KEY"; key: string | null }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "RESTORE_UI"; workingTimezone: string; gridColumns: number; mapPanelHeight: number };

const initialState: UIState = {
  workingTimezone: "America/Los_Angeles",
  gridColumns: 5,
  panelWidth: 800,
  mapPanelHeight: 200,
  photoFilters: EMPTY_PHOTO_FILTERS,
  mapboxToken: null,
  googleMapsKey: null,
  claudeApiKey: null,
  error: null,
};

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case "SET_WORKING_TIMEZONE":
      return { ...state, workingTimezone: action.timezone };
    case "SET_GRID_COLUMNS":
      return { ...state, gridColumns: Math.max(1, action.columns) };
    case "SET_PANEL_WIDTH":
      return { ...state, panelWidth: action.width };
    case "SET_MAP_PANEL_HEIGHT":
      return { ...state, mapPanelHeight: Math.max(60, action.height) };
    case "SET_PHOTO_FILTERS":
      return { ...state, photoFilters: { ...state.photoFilters, ...action.filters } };
    case "RESET_PHOTO_FILTERS":
      return { ...state, photoFilters: EMPTY_PHOTO_FILTERS };
    case "SET_MAPBOX_TOKEN":
      return { ...state, mapboxToken: action.token };
    case "SET_GOOGLE_MAPS_KEY":
      return { ...state, googleMapsKey: action.key };
    case "SET_CLAUDE_API_KEY":
      return { ...state, claudeApiKey: action.key };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "RESTORE_UI":
      // Fires on session hydrate and Clear Session; filters are session-scoped
      // view state, so both start from a clean slate.
      return {
        ...state,
        workingTimezone: action.workingTimezone,
        gridColumns: action.gridColumns,
        mapPanelHeight: action.mapPanelHeight,
        photoFilters: EMPTY_PHOTO_FILTERS,
      };
    default:
      return state;
  }
}

interface UIContextValue {
  state: UIState;
  dispatch: React.Dispatch<UIAction>;
}

const UIContext = createContext<UIContextValue | null>(null);

export function UIProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(uiReducer, initialState);
  const prevRef = useRef(state);

  // Surface backend command failures in the ErrorModal. Registered here
  // because the reporting module can't reach React state on its own.
  useEffect(() => {
    setErrorHandler((message) => dispatch({ type: "SET_ERROR", error: message }));
    return () => setErrorHandler(null);
  }, []);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev.workingTimezone !== state.workingTimezone) {
      tauriCommands.setSetting("ui.workingTimezone", state.workingTimezone)
        .catch((err) => reportError("Failed to save the working timezone preference", err));
    }
    if (prev.gridColumns !== state.gridColumns) {
      tauriCommands.setSetting("ui.gridColumns", String(state.gridColumns))
        .catch((err) => reportError("Failed to save the grid layout preference", err));
    }
    prevRef.current = state;
  }, [state.workingTimezone, state.gridColumns]);

  useEffect(() => {
    const id = setTimeout(() => {
      tauriCommands.setSetting("ui.mapPanelHeight", String(state.mapPanelHeight))
        .catch((err) => reportError("Failed to save the map panel size preference", err));
    }, 500);
    return () => clearTimeout(id);
  }, [state.mapPanelHeight]);

  return (
    <UIContext.Provider value={{ state, dispatch }}>
      {children}
    </UIContext.Provider>
  );
}

export function useUI(): UIContextValue {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used within UIProvider");
  return ctx;
}

export { initialState as uiInitialState, uiReducer };
