import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { FloatingControls } from "./FloatingControls/FloatingControls";
import { PhotoGrid } from "./PhotoGrid/PhotoGrid";
import { ImportModal } from "../ImportModal/ImportModal";
import { DropImportOverlay } from "./DropImportOverlay";
import { useSession } from "../../state/SessionContext";
import type { Photo, Metadata } from "../../state/SessionContext";
import { tauriCommands } from "../../lib/tauri";
import styles from "./PhotoManager.module.css";

const SUPPORTED_EXTENSIONS = new Set([
  "jpg", "jpeg", "tif", "tiff", "heic",
  "dng", "cr3", "cr2", "nef", "arw", "raf", "orf", "rw2", "pef",
]);

interface RawPhotoData {
  id: string;
  filePath: string;
  thumbnailSmall: string;
  thumbnailLarge: string;
  fileStatus: string;
  metadata: {
    captureDate: string | null;
    captureTime: string | null;
    utcOffset: string | null;
    timezone: string | null;
    gpsLat: number | null;
    gpsLng: number | null;
    cameraBody: string | null;
    lens: string | null;
    film: string | null;
  };
}

interface ImportProgressEvent {
  done: number;
  total: number;
  photo: RawPhotoData | null;
  error: string | null;
}

function mapRawPhoto(raw: RawPhotoData): Photo {
  const meta: Metadata = {
    captureDate: raw.metadata.captureDate,
    captureTime: raw.metadata.captureTime,
    utcOffset: raw.metadata.utcOffset,
    timezone: raw.metadata.timezone,
    gpsLat: raw.metadata.gpsLat,
    gpsLng: raw.metadata.gpsLng,
    cameraBody: raw.metadata.cameraBody,
    lens: raw.metadata.lens,
    film: raw.metadata.film,
  };
  return {
    id: raw.id,
    filePath: raw.filePath,
    fileStatus: raw.fileStatus === "missing" ? "missing" : "ok",
    thumbnail: {
      small: convertFileSrc(raw.thumbnailSmall),
      large: convertFileSrc(raw.thumbnailLarge),
    },
    originalMetadata: meta,
    currentMetadata: meta,
    pendingChanges: null,
  };
}

export function PhotoManager() {
  const { dispatch } = useSession();
  const [showDropOverlay, setShowDropOverlay] = useState(false);
  const [importState, setImportState] = useState<{
    isOpen: boolean;
    done: number;
    total: number;
    skipped: number;
    isComplete: boolean;
    errors: string[];
  }>({ isOpen: false, done: 0, total: 0, skipped: 0, isComplete: false, errors: [] });

  const handleDismiss = useCallback(() => {
    setImportState({ isOpen: false, done: 0, total: 0, skipped: 0, isComplete: false, errors: [] });
  }, []);

  // Restore existing session from SQLite on startup
  useEffect(() => {
    async function restoreSession() {
      try {
        const result = await tauriCommands.loadSession();
        if (result.photos.length > 0) {
          const photos: Photo[] = result.photos.map((p) => ({
            id: p.id,
            filePath: p.filePath,
            fileStatus: p.fileStatus,
            thumbnail: {
              small: convertFileSrc(p.thumbnailSmall),
              large: convertFileSrc(p.thumbnailLarge),
            },
            originalMetadata: p.originalMetadata,
            currentMetadata: p.currentMetadata,
            pendingChanges: null,
          }));
          dispatch({ type: "IMPORT_PHOTOS", photos });
        }
      } catch (err) {
        console.error("[restoreSession] failed:", err);
      }
    }
    restoreSession();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const unlisteners = [
      listen<{ total: number }>("import:start", (e) => {
        if (e.payload.total === 0) return;
        setImportState({ isOpen: true, done: 0, total: e.payload.total, skipped: 0, isComplete: false, errors: [] });
      }),

      listen<ImportProgressEvent>("import:progress", (e) => {
        const { done, total, photo, error } = e.payload;
        if (photo) {
          dispatch({ type: "IMPORT_PHOTO_PROGRESS", photo: mapRawPhoto(photo) });
        }
        setImportState((prev) => ({
          ...prev,
          done,
          total,
          errors: error ? [...prev.errors, error] : prev.errors,
        }));
      }),

      listen<{ total: number; skipped: number }>("import:complete", (e) => {
        setImportState((prev) => ({
          ...prev,
          isComplete: true,
          skipped: e.payload.skipped ?? 0,
        }));
      }),
    ];

    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, [dispatch]);

  useEffect(() => {
    const webview = getCurrentWebviewWindow();
    const unlisten = webview.onDragDropEvent((event) => {
      const payload = event.payload;
      if (payload.type === "enter" || payload.type === "over") {
        setShowDropOverlay(true);
      } else if (payload.type === "drop") {
        setShowDropOverlay(false);
        const paths = payload.paths ?? [];
        const filtered = paths.filter((p) => {
          const ext = p.split(".").pop()?.toLowerCase() ?? "";
          return SUPPORTED_EXTENSIONS.has(ext);
        });
        if (filtered.length > 0) {
          tauriCommands
            .importPhotos(filtered)
            .catch((err) => console.error("[finderDrop]", err));
        }
      } else {
        setShowDropOverlay(false);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div className={styles.photoManager}>
      <FloatingControls />
      <PhotoGrid />
      <DropImportOverlay isVisible={showDropOverlay} />
      <ImportModal
        isOpen={importState.isOpen}
        done={importState.done}
        total={importState.total}
        skipped={importState.skipped}
        isComplete={importState.isComplete}
        errors={importState.errors}
        onDismiss={handleDismiss}
      />
    </div>
  );
}
