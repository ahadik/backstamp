import { invoke } from "@tauri-apps/api/core";
import type { Metadata } from "../state/SessionContext";
import type { CorpusState } from "../state/CorpusContext";

export interface TrackPoint {
  lat: number;
  lng: number;
  timestamp: number; // Unix epoch seconds (UTC)
}

export interface GpxImportResult {
  id: string;
  filePath: string;
  addedAt: number;
  trackPoints: TrackPoint[];
  thumbnailPath: string | null;
  timezone: string | null;
}

export interface PhotoApplyChanges {
  captureDate?: string | null;
  captureTime?: string | null;
  utcOffset?: string | null;
  timezone?: string | null;
  gpsLat?: number | null;
  gpsLng?: number | null;
  cameraMake?: string | null;
  cameraModel?: string | null;
  lens?: string | null;
  filmVendor?: string | null;
  filmType?: string | null;
}

export interface ApplyPayload {
  changes: Record<string, PhotoApplyChanges>;
}

export interface FailedFile {
  photoId: string;
  error: string;
}

export interface RollbackResult {
  canRollback: boolean;
  failedFiles: FailedFile[];
}

export interface ResetResult {
  failedFiles: FailedFile[];
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
    pendingChanges: Partial<Metadata> | null;
  }>;
  gpxFiles: Array<{
    id: string;
    filePath: string;
    addedAt: number;
    trackPoints: TrackPoint[];
    thumbnailPath: string | null;
    timezone: string | null;
  }>;
  canRollback: boolean;
  workingTimezone: string;
  gridColumns: number;
  mapPanelHeight: number;
}

export interface SidecarSearchResult {
  found: Record<string, string>;
  missing: string[];
}

export const tauriCommands = {
  loadSession: () => invoke<SessionLoadResult>("load_session"),

  clearSession: () => invoke<void>("clear_session"),

  importPhotos: (paths: string[], sidecarMap: Record<string, string> = {}) =>
    invoke<void>("import_photos", { paths, sidecarMap }),

  findXmpSidecars: (rawPaths: string[]) =>
    invoke<SidecarSearchResult>("find_xmp_sidecars", { rawPaths }),

  removePhotos: (ids: string[]) => invoke<void>("remove_photos", { ids }),

  applyChanges: (payload: ApplyPayload) =>
    invoke<void>("apply_changes", { payload }),

  applyCancel: () => invoke<void>("apply_cancel"),

  rollback: () => invoke<RollbackResult>("rollback"),

  resetPhotos: (ids: string[]) => invoke<ResetResult>("reset_photos", { ids }),

  getThumbnail: (photoId: string) =>
    invoke<string>("get_thumbnail", { photoId }),

  reorderPhotos: (orderedIds: string[]) =>
    invoke<void>("reorder_photos", { orderedIds }),

  loadCorpus: () => invoke<CorpusState>("load_corpus"),

  addCorpusEntry: (category: string, value: string, vendor?: string) =>
    invoke<void>("add_corpus_entry", { category, value, vendor: vendor ?? null }),

  removeCorpusEntry: (category: string, value: string, vendor?: string) =>
    invoke<void>("remove_corpus_entry", { category, value, vendor: vendor ?? null }),

  recordCorpusUse: (category: string, value: string, vendor?: string) =>
    invoke<void>("record_corpus_use", { category, value, vendor: vendor ?? null }),

  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),

  setSetting: (key: string, value: string) =>
    invoke<void>("set_setting", { key, value }),

  setPendingChanges: (photoIds: string[], fields: Array<{ field: string; value: string | null }>) =>
    invoke<void>("set_pending_changes", { photoIds, fields }),

  clearPendingChanges: (photoIds: string[]) =>
    invoke<void>("clear_pending_changes", { photoIds }),

  resolveTimezone: (lat: number, lng: number) =>
    invoke<string>("resolve_timezone", { lat, lng }),

  showPhotoContextMenu: (filePath: string, fileMissing: boolean) =>
    invoke<void>("show_photo_context_menu", { filePath, fileMissing }),

  importGpx: (path: string) => invoke<GpxImportResult>("import_gpx", { path }),

  removeGpx: (id: string) => invoke<void>("remove_gpx", { id }),

  saveGpxThumbnail: (id: string, data: number[]) =>
    invoke<string>("save_gpx_thumbnail", { id, data }),
};
