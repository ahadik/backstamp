import { invoke } from "@tauri-apps/api/core";
import type { SessionState } from "../state/SessionContext";

export interface ApplyPayload {
  changes: Record<string, Record<string, string | number | null>>;
}

export const tauriCommands = {
  loadSession: () =>
    invoke<SessionState>("load_session"),

  clearSession: () =>
    invoke<void>("clear_session"),

  importPhotos: (paths: string[]) =>
    invoke<void>("import_photos", { paths }),

  removePhotos: (ids: string[]) =>
    invoke<void>("remove_photos", { ids }),

  applyChanges: (payload: ApplyPayload) =>
    invoke<void>("apply_changes", { payload }),

  rollback: () =>
    invoke<void>("rollback"),

  resetPhotos: (ids: string[]) =>
    invoke<void>("reset_photos", { ids }),

  getThumbnail: (photoId: string) =>
    invoke<string>("get_thumbnail", { photoId }),
};
