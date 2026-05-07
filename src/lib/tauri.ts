import { invoke } from "@tauri-apps/api/core";
import type { Metadata, GpxFile } from "../state/SessionContext";
import type { CorpusState } from "../state/CorpusContext";

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
  canRollback: boolean;
}

export const tauriCommands = {
  loadSession: () => invoke<SessionLoadResult>("load_session"),

  clearSession: () => invoke<void>("clear_session"),

  importPhotos: (paths: string[]) => invoke<void>("import_photos", { paths }),

  removePhotos: (ids: string[]) => invoke<void>("remove_photos", { ids }),

  applyChanges: (payload: ApplyPayload) =>
    invoke<void>("apply_changes", { payload }),

  applyCancel: () => invoke<void>("apply_cancel"),

  rollback: () => invoke<void>("rollback"),

  resetPhotos: (ids: string[]) => invoke<void>("reset_photos", { ids }),

  getThumbnail: (photoId: string) =>
    invoke<string>("get_thumbnail", { photoId }),

  reorderPhotos: (orderedIds: string[]) =>
    invoke<void>("reorder_photos", { orderedIds }),

  loadCorpus: () => invoke<CorpusState>("load_corpus"),

  addCorpusEntry: (category: string, value: string) =>
    invoke<void>("add_corpus_entry", { category, value }),

  removeCorpusEntry: (category: string, value: string) =>
    invoke<void>("remove_corpus_entry", { category, value }),

  recordCorpusUse: (category: string, value: string) =>
    invoke<void>("record_corpus_use", { category, value }),

  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),

  setSetting: (key: string, value: string) =>
    invoke<void>("set_setting", { key, value }),

  resolveTimezone: (lat: number, lng: number) =>
    invoke<string>("resolve_timezone", { lat, lng }),
};
