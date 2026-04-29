import React, { createContext, useContext, useReducer } from "react";

export interface Metadata {
  captureDate: string | null;   // "YYYY-MM-DD"
  captureTime: string | null;   // "HH:MM:SS"
  timezone: string | null;      // IANA name
  gpsLat: number | null;
  gpsLng: number | null;
  cameraBody: string | null;
  lens: string | null;
  film: string | null;
}

export interface Photo {
  id: string;
  filePath: string;
  fileStatus: "ok" | "missing";
  thumbnail: { small: string; large: string };
  originalMetadata: Metadata;
  currentMetadata: Metadata;
  pendingChanges: Partial<Metadata> | null;
}

export interface GpxFile {
  id: string;
  filePath: string;
  addedAt: number;
}

export interface SessionState {
  photos: Photo[];
  selectedIds: Set<string>;
  gpxFiles: GpxFile[];
  applyInProgress: boolean;
}

type SessionAction =
  | { type: "IMPORT_PHOTOS"; photos: Photo[] }
  | { type: "IMPORT_PHOTO_PROGRESS"; photo: Photo }
  | { type: "SELECT"; id: string; mode: "single" | "shift" | "cmd" }
  | { type: "SELECT_ALL" }
  | { type: "DESELECT_ALL" }
  | { type: "SET_PENDING"; ids: string[]; changes: Partial<Metadata> }
  | { type: "CLEAR_PENDING"; ids: string[] }
  | { type: "APPLY_START" }
  | { type: "APPLY_COMPLETE"; updatedPhotos: Photo[] }
  | { type: "ROLLBACK_COMPLETE"; restoredPhotos: Photo[] }
  | { type: "REMOVE_PHOTOS"; ids: string[] }
  | { type: "MARK_MISSING"; ids: string[] }
  | { type: "ADD_GPX"; gpxFile: GpxFile }
  | { type: "REMOVE_GPX"; id: string }
  | { type: "REORDER_PHOTOS"; orderedIds: string[] }
  | { type: "CLEAR_SESSION" };

const initialMetadata: Metadata = {
  captureDate: null,
  captureTime: null,
  timezone: null,
  gpsLat: null,
  gpsLng: null,
  cameraBody: null,
  lens: null,
  film: null,
};

const initialState: SessionState = {
  photos: [],
  selectedIds: new Set(),
  gpxFiles: [],
  applyInProgress: false,
};

function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "IMPORT_PHOTOS":
      return { ...state, photos: [...state.photos, ...action.photos] };

    case "IMPORT_PHOTO_PROGRESS":
      return { ...state, photos: [...state.photos, action.photo] };

    case "SELECT": {
      const { id, mode } = action;
      const ids = new Set(state.selectedIds);
      if (mode === "single") {
        ids.clear();
        ids.add(id);
      } else if (mode === "cmd") {
        if (ids.has(id)) ids.delete(id);
        else ids.add(id);
      } else if (mode === "shift") {
        // Shift-select: add range between last selected and id
        const photoIds = state.photos.map((p) => p.id);
        const clickedIdx = photoIds.indexOf(id);
        const lastIdx = photoIds.findLastIndex((pid: string) => ids.has(pid));
        if (lastIdx === -1) {
          ids.add(id);
        } else {
          const [lo, hi] = [Math.min(lastIdx, clickedIdx), Math.max(lastIdx, clickedIdx)];
          for (let i = lo; i <= hi; i++) ids.add(photoIds[i]);
        }
      }
      return { ...state, selectedIds: ids };
    }

    case "SELECT_ALL":
      return { ...state, selectedIds: new Set(state.photos.map((p) => p.id)) };

    case "DESELECT_ALL":
      return { ...state, selectedIds: new Set() };

    case "SET_PENDING": {
      const updated = state.photos.map((p) => {
        if (!action.ids.includes(p.id)) return p;
        const pending = { ...(p.pendingChanges ?? {}), ...action.changes };
        const current = { ...p.currentMetadata, ...action.changes };
        return { ...p, pendingChanges: pending, currentMetadata: current };
      });
      return { ...state, photos: updated };
    }

    case "CLEAR_PENDING": {
      const updated = state.photos.map((p) =>
        action.ids.includes(p.id)
          ? { ...p, pendingChanges: null, currentMetadata: { ...p.originalMetadata } }
          : p
      );
      return { ...state, photos: updated };
    }

    case "APPLY_START":
      return { ...state, applyInProgress: true };

    case "APPLY_COMPLETE": {
      const byId = new Map(action.updatedPhotos.map((p) => [p.id, p]));
      const updated = state.photos.map((p) => byId.get(p.id) ?? p);
      return { ...state, photos: updated, applyInProgress: false };
    }

    case "ROLLBACK_COMPLETE": {
      const byId = new Map(action.restoredPhotos.map((p) => [p.id, p]));
      const updated = state.photos.map((p) => byId.get(p.id) ?? p);
      return { ...state, photos: updated };
    }

    case "REMOVE_PHOTOS": {
      const idsSet = new Set(action.ids);
      const selected = new Set([...state.selectedIds].filter((id) => !idsSet.has(id)));
      return {
        ...state,
        photos: state.photos.filter((p) => !idsSet.has(p.id)),
        selectedIds: selected,
      };
    }

    case "MARK_MISSING": {
      const idsSet = new Set(action.ids);
      const updated = state.photos.map((p) =>
        idsSet.has(p.id) ? { ...p, fileStatus: "missing" as const } : p
      );
      return { ...state, photos: updated };
    }

    case "ADD_GPX":
      return { ...state, gpxFiles: [...state.gpxFiles, action.gpxFile] };

    case "REMOVE_GPX":
      return { ...state, gpxFiles: state.gpxFiles.filter((g) => g.id !== action.id) };

    case "REORDER_PHOTOS": {
      const byId = new Map(state.photos.map((p) => [p.id, p]));
      const reordered = action.orderedIds.flatMap((id) => {
        const p = byId.get(id);
        return p ? [p] : [];
      });
      return { ...state, photos: reordered };
    }

    case "CLEAR_SESSION":
      return { ...initialState };

    default:
      return state;
  }
}

interface SessionContextValue {
  state: SessionState;
  dispatch: React.Dispatch<SessionAction>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(sessionReducer, initialState);
  return (
    <SessionContext.Provider value={{ state, dispatch }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}

export { initialMetadata, initialState, sessionReducer };
