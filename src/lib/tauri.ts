import { invoke } from "@tauri-apps/api/core";
import type { Metadata, GpxFile } from "../state/SessionContext";

export interface ApplyPayload {
  changes: Record<string, Record<string, string | number | null>>;
}

export interface SessionLoadResult {
  photos: Array<{
    id: string;
    filePath: string;
    fileStatus: "ok" | "missing";
    thumbnailSmall: string;
    thumbnailLarge: string;
    originalMetadata: Metadata;
    currentMetadata: Metadata;
    pendingChanges: null;
  }>;
  gpxFiles: GpxFile[];
}

export const tauriCommands = {
  loadSession: () => invoke<SessionLoadResult>("load_session"),

  clearSession: () => invoke<void>("clear_session"),

  importPhotos: (paths: string[]) => invoke<void>("import_photos", { paths }),

  removePhotos: (ids: string[]) => invoke<void>("remove_photos", { ids }),

  applyChanges: (payload: ApplyPayload) =>
    invoke<void>("apply_changes", { payload }),

  rollback: () => invoke<void>("rollback"),

  resetPhotos: (ids: string[]) => invoke<void>("reset_photos", { ids }),

  getThumbnail: (photoId: string) =>
    invoke<string>("get_thumbnail", { photoId }),

  reorderPhotos: (orderedIds: string[]) =>
    invoke<void>("reorder_photos", { orderedIds }),
};
