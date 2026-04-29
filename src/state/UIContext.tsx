import React, { createContext, useContext, useReducer } from "react";

export interface UIState {
  workingTimezone: string;  // IANA name, display-only
  gridTileSize: number;     // 0–1 fraction of panel width per tile
  mapPanelHeight: number;   // px
}

type UIAction =
  | { type: "SET_WORKING_TIMEZONE"; timezone: string }
  | { type: "SET_GRID_TILE_SIZE"; size: number }
  | { type: "SET_MAP_PANEL_HEIGHT"; height: number };

const initialState: UIState = {
  workingTimezone: "America/Los_Angeles",
  gridTileSize: 0.2,
  mapPanelHeight: 200,
};

function uiReducer(state: UIState, action: UIAction): UIState {
  switch (action.type) {
    case "SET_WORKING_TIMEZONE":
      return { ...state, workingTimezone: action.timezone };
    case "SET_GRID_TILE_SIZE":
      return { ...state, gridTileSize: Math.max(0, Math.min(1, action.size)) };
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
