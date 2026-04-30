import React, { createContext, useContext, useReducer } from "react";

export interface UIState {
  workingTimezone: string;  // IANA name, display-only
  gridColumns: number;      // target number of columns in the photo grid
  panelWidth: number;       // current photo grid panel width in px (updated by PhotoGrid)
  mapPanelHeight: number;   // px
}

type UIAction =
  | { type: "SET_WORKING_TIMEZONE"; timezone: string }
  | { type: "SET_GRID_COLUMNS"; columns: number }
  | { type: "SET_PANEL_WIDTH"; width: number }
  | { type: "SET_MAP_PANEL_HEIGHT"; height: number };

const initialState: UIState = {
  workingTimezone: "America/Los_Angeles",
  gridColumns: 5,
  panelWidth: 800,
  mapPanelHeight: 200,
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
