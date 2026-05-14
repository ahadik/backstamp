import React, { createContext, useContext, useReducer, useEffect, useRef } from "react";
import { tauriCommands } from "../lib/tauri";

export interface UIState {
  workingTimezone: string;  // IANA name, display-only
  gridColumns: number;      // target number of columns in the photo grid
  panelWidth: number;       // current photo grid panel width in px (updated by PhotoGrid)
  mapPanelHeight: number;   // px
  mapboxToken: string | null;
  claudeApiKey: string | null;
  error: string | null;
}

type UIAction =
  | { type: "SET_WORKING_TIMEZONE"; timezone: string }
  | { type: "SET_GRID_COLUMNS"; columns: number }
  | { type: "SET_PANEL_WIDTH"; width: number }
  | { type: "SET_MAP_PANEL_HEIGHT"; height: number }
  | { type: "SET_MAPBOX_TOKEN"; token: string | null }
  | { type: "SET_CLAUDE_API_KEY"; key: string | null }
  | { type: "SET_ERROR"; error: string | null }
  | { type: "RESTORE_UI"; workingTimezone: string; gridColumns: number; mapPanelHeight: number };

const initialState: UIState = {
  workingTimezone: "America/Los_Angeles",
  gridColumns: 5,
  panelWidth: 800,
  mapPanelHeight: 200,
  mapboxToken: null,
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
    case "SET_MAPBOX_TOKEN":
      return { ...state, mapboxToken: action.token };
    case "SET_CLAUDE_API_KEY":
      return { ...state, claudeApiKey: action.key };
    case "SET_ERROR":
      return { ...state, error: action.error };
    case "RESTORE_UI":
      return {
        ...state,
        workingTimezone: action.workingTimezone,
        gridColumns: action.gridColumns,
        mapPanelHeight: action.mapPanelHeight,
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

  useEffect(() => {
    const prev = prevRef.current;
    if (prev.workingTimezone !== state.workingTimezone) {
      tauriCommands.setSetting("ui.workingTimezone", state.workingTimezone).catch(console.error);
    }
    if (prev.gridColumns !== state.gridColumns) {
      tauriCommands.setSetting("ui.gridColumns", String(state.gridColumns)).catch(console.error);
    }
    prevRef.current = state;
  }, [state.workingTimezone, state.gridColumns]);

  useEffect(() => {
    const id = setTimeout(() => {
      tauriCommands.setSetting("ui.mapPanelHeight", String(state.mapPanelHeight)).catch(console.error);
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
