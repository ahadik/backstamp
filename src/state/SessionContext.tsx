import React, { createContext, useContext, useReducer } from "react";

export interface Metadata {
  captureDate: string | null;   // "YYYY-MM-DD"
  captureTime: string | null;   // "HH:MM:SS"
  utcOffset: string | null;     // e.g. "+09:00" from EXIF OffsetTimeOriginal
  timezone: string | null;      // IANA name
  gpsLat: number | null;
  gpsLng: number | null;
  cameraMake: string | null;    // e.g. "Canon"
  cameraModel: string | null;   // e.g. "EOS R5"
  lens: string | null;
  filmVendor: string | null;
  filmType: string | null;
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
  trackPoints: Array<{ lat: number; lng: number; timestamp: number }>;
  thumbnailPath: string | null;
  timezone: string | null;
}

export type MetadataSnapshot = Array<{
  id: string;
  currentMetadata: Metadata;
  pendingChanges: Partial<Metadata> | null;
}>;

export interface SessionState {
  photos: Photo[];
  selectedIds: Set<string>;
  gpxFiles: GpxFile[];
  selectedGpxId: string | null;
  applyInProgress: boolean;
  canRollback: boolean;
  metadataHistory: MetadataSnapshot[];
}

type SessionAction =
  | { type: "IMPORT_PHOTOS"; photos: Photo[] }
  | { type: "IMPORT_PHOTO_PROGRESS"; photo: Photo }
  | { type: "SELECT"; id: string; mode: "single" | "shift" | "cmd" }
  | { type: "SELECT_SINGLE"; id: string }
  | { type: "TOGGLE_SELECT"; id: string }
  | { type: "SELECT_RANGE"; fromId: string; toId: string; orderedIds: string[] }
  | { type: "SELECT_ALL" }
  | { type: "DESELECT_ALL" }
  | { type: "SELECT_GPX"; id: string }
  | { type: "SET_PENDING"; ids: string[]; changes: Partial<Metadata> }
  | { type: "SET_PENDING_BATCH"; updates: Array<{ id: string; changes: Partial<Metadata> }> }
  | { type: "CLEAR_PENDING"; ids: string[] }
  | { type: "APPLY_START" }
  | { type: "APPLY_COMPLETE"; updatedPhotos: Photo[]; canRollback: boolean }
  | { type: "ROLLBACK_COMPLETE"; restoredPhotos: Photo[]; canRollback: boolean }
  | { type: "RESET_PHOTOS"; ids: string[] }
  | { type: "REMOVE_PHOTOS"; ids: string[] }
  | { type: "MARK_MISSING"; ids: string[] }
  | { type: "ADD_GPX"; gpxFile: GpxFile }
  | { type: "REMOVE_GPX"; id: string }
  | { type: "UPDATE_GPX_THUMBNAIL"; id: string; thumbnailPath: string }
  | { type: "REORDER_PHOTOS"; orderedIds: string[] }
  | { type: "RESTORE_SESSION"; photos: Photo[]; gpxFiles: GpxFile[]; canRollback: boolean }
  | { type: "CLEAR_SESSION" }
  | { type: "UNDO_LAST_EDIT" };

export const initialMetadata: Metadata = {
  captureDate: null,
  captureTime: null,
  utcOffset: null,
  timezone: null,
  gpsLat: null,
  gpsLng: null,
  cameraMake: null,
  cameraModel: null,
  lens: null,
  filmVendor: null,
  filmType: null,
};

export const initialState: SessionState = {
  photos: [],
  selectedIds: new Set(),
  gpxFiles: [],
  selectedGpxId: null,
  applyInProgress: false,
  canRollback: false,
  metadataHistory: [],
};

function diffMetadata(original: Metadata, current: Metadata): Partial<Metadata> | null {
  const changes: Partial<Metadata> = {};
  for (const key of Object.keys(original) as (keyof Metadata)[]) {
    if (original[key] !== current[key]) (changes as Record<string, unknown>)[key] = current[key];
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  switch (action.type) {
    case "IMPORT_PHOTOS":
      return { ...state, photos: action.photos };

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
      return { ...state, selectedIds: ids, selectedGpxId: null };
    }

    case "SELECT_SINGLE":
      return { ...state, selectedIds: new Set([action.id]), selectedGpxId: null };

    case "TOGGLE_SELECT": {
      const ids = new Set(state.selectedIds);
      if (ids.has(action.id)) ids.delete(action.id);
      else ids.add(action.id);
      return { ...state, selectedIds: ids, selectedGpxId: null };
    }

    case "SELECT_RANGE": {
      const { fromId, toId, orderedIds } = action;
      const fromIdx = orderedIds.indexOf(fromId);
      const toIdx = orderedIds.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return state;
      const [lo, hi] = [Math.min(fromIdx, toIdx), Math.max(fromIdx, toIdx)];
      const ids = new Set(state.selectedIds);
      for (let i = lo; i <= hi; i++) ids.add(orderedIds[i]);
      return { ...state, selectedIds: ids, selectedGpxId: null };
    }

    case "SELECT_ALL":
      return { ...state, selectedIds: new Set(state.photos.map((p) => p.id)), selectedGpxId: null };

    case "DESELECT_ALL":
      return { ...state, selectedIds: new Set() };

    case "SELECT_GPX":
      return {
        ...state,
        selectedGpxId: state.selectedGpxId === action.id ? null : action.id,
        selectedIds: new Set(),
      };

    case "SET_PENDING": {
      const snapshot: MetadataSnapshot = state.photos
        .filter((p) => action.ids.includes(p.id))
        .map((p) => ({
          id: p.id,
          currentMetadata: { ...p.currentMetadata },
          pendingChanges: p.pendingChanges ? { ...p.pendingChanges } : null,
        }));
      const updated = state.photos.map((p) => {
        if (!action.ids.includes(p.id)) return p;
        const pending = { ...(p.pendingChanges ?? {}), ...action.changes };
        const current = { ...p.currentMetadata, ...action.changes };
        return { ...p, pendingChanges: pending, currentMetadata: current };
      });
      const history = [...state.metadataHistory, snapshot];
      if (history.length > 50) history.shift();
      return { ...state, photos: updated, metadataHistory: history };
    }

    case "SET_PENDING_BATCH": {
      const ids = new Set(action.updates.map((u) => u.id));
      const snapshot: MetadataSnapshot = state.photos
        .filter((p) => ids.has(p.id))
        .map((p) => ({
          id: p.id,
          currentMetadata: { ...p.currentMetadata },
          pendingChanges: p.pendingChanges ? { ...p.pendingChanges } : null,
        }));
      const changesMap = new Map(action.updates.map((u) => [u.id, u.changes]));
      const updated = state.photos.map((p) => {
        const changes = changesMap.get(p.id);
        if (!changes) return p;
        const pending = { ...(p.pendingChanges ?? {}), ...changes };
        const current = { ...p.currentMetadata, ...changes };
        return { ...p, pendingChanges: pending, currentMetadata: current };
      });
      const history = [...state.metadataHistory, snapshot];
      if (history.length > 50) history.shift();
      return { ...state, photos: updated, metadataHistory: history };
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
      return { ...state, photos: updated, applyInProgress: false, canRollback: action.canRollback };
    }

    case "ROLLBACK_COMPLETE": {
      const byId = new Map(action.restoredPhotos.map((p) => [p.id, p]));
      const updated = state.photos.map((p) => byId.get(p.id) ?? p);
      return { ...state, photos: updated, canRollback: action.canRollback, metadataHistory: [] };
    }

    case "RESET_PHOTOS": {
      const idSet = new Set(action.ids);
      return {
        ...state,
        photos: state.photos.map((p) =>
          idSet.has(p.id)
            ? { ...p, currentMetadata: { ...p.originalMetadata }, pendingChanges: null }
            : p
        ),
      };
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

    case "ADD_GPX": {
      if (state.gpxFiles.some((g) => g.id === action.gpxFile.id)) return state;
      return { ...state, gpxFiles: [...state.gpxFiles, action.gpxFile] };
    }

    case "REMOVE_GPX":
      return {
        ...state,
        gpxFiles: state.gpxFiles.filter((g) => g.id !== action.id),
        selectedGpxId: state.selectedGpxId === action.id ? null : state.selectedGpxId,
      };

    case "UPDATE_GPX_THUMBNAIL":
      return {
        ...state,
        gpxFiles: state.gpxFiles.map((g) =>
          g.id === action.id ? { ...g, thumbnailPath: action.thumbnailPath } : g
        ),
      };

    case "REORDER_PHOTOS": {
      const byId = new Map(state.photos.map((p) => [p.id, p]));
      const reordered = action.orderedIds.flatMap((id) => {
        const p = byId.get(id);
        return p ? [p] : [];
      });
      return { ...state, photos: reordered };
    }

    case "RESTORE_SESSION":
      return {
        ...state,
        photos: action.photos,
        gpxFiles: action.gpxFiles,
        canRollback: action.canRollback,
        selectedIds: new Set(),
        metadataHistory: [],
      };

    case "CLEAR_SESSION":
      return { ...initialState };

    case "UNDO_LAST_EDIT": {
      if (state.metadataHistory.length === 0) return state;
      const history = state.metadataHistory.slice(0, -1);
      const snapshot = state.metadataHistory[state.metadataHistory.length - 1];
      const byId = new Map(snapshot.map((s) => [s.id, s]));
      const updated = state.photos.map((p) => {
        const saved = byId.get(p.id);
        if (!saved) return p;
        const currentMetadata = { ...saved.currentMetadata };
        const pendingChanges = diffMetadata(p.originalMetadata, currentMetadata);
        return { ...p, currentMetadata, pendingChanges };
      });
      return { ...state, photos: updated, metadataHistory: history };
    }

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
