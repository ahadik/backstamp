import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { FloatingControls } from "./FloatingControls/FloatingControls";
import { PhotoGrid } from "./PhotoGrid/PhotoGrid";
import { ImportModal } from "../ImportModal/ImportModal";
import { DropImportOverlay } from "./DropImportOverlay";
import { useSession } from "../../state/SessionContext";
import { useCorpus } from "../../state/CorpusContext";
import { useUI } from "../../state/UIContext";
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
  const { dispatch: sessionDispatch } = useSession();
  const { dispatch: corpusDispatch } = useCorpus();
  const { dispatch: uiDispatch } = useUI();

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

  // Restore session + load corpus + load settings on startup
  useEffect(() => {
    async function init() {
      try {
        // Load session
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
          sessionDispatch({ type: "IMPORT_PHOTOS", photos });
        }
        if (result.canRollback) {
          // Reflect canRollback state from loaded session
          sessionDispatch({
            type: "APPLY_COMPLETE",
            updatedPhotos: [],
            canRollback: result.canRollback,
          });
        }
      } catch (err) {
        console.error("[PhotoManager] loadSession failed:", err);
      }

      try {
        // Load corpus
        const corpus = await tauriCommands.loadCorpus();
        corpusDispatch({ type: "LOAD_CORPUS", corpus });
      } catch (err) {
        console.error("[PhotoManager] loadCorpus failed:", err);
      }

      try {
        // Load API key settings
        const [mapboxToken, claudeApiKey] = await Promise.all([
          tauriCommands.getSetting("mapbox_token"),
          tauriCommands.getSetting("claude_api_key"),
        ]);
        if (mapboxToken) uiDispatch({ type: "SET_MAPBOX_TOKEN", token: mapboxToken });
        if (claudeApiKey) uiDispatch({ type: "SET_CLAUDE_API_KEY", key: claudeApiKey });
      } catch (err) {
        console.error("[PhotoManager] settings load failed:", err);
      }
    }
    init();
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
          sessionDispatch({ type: "IMPORT_PHOTO_PROGRESS", photo: mapRawPhoto(photo) });
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
  }, [sessionDispatch]);

  // Detect Finder file drags using DOM events. dragDropEnabled is false in tauri.conf.json
  // so wry's native handler does not intercept drops, allowing HTML5 drag-drop to work.
  useEffect(() => {
    let isFileDrag = false;

    function onDragEnter(e: DragEvent) {
      const types = Array.from(e.dataTransfer?.types ?? []);
      if (types.includes("Files") || types.includes("public.file-url")) {
        isFileDrag = true;
        setShowDropOverlay(true);
      }
    }

    function onDragLeave(e: DragEvent) {
      // relatedTarget is null only when the drag leaves the window entirely
      if (isFileDrag && e.relatedTarget === null) {
        isFileDrag = false;
        setShowDropOverlay(false);
      }
    }

    function onDragOver(e: DragEvent) {
      if (isFileDrag) e.preventDefault();
    }

    function onDrop(e: DragEvent) {
      if (!isFileDrag) return;
      e.preventDefault();
      isFileDrag = false;
      setShowDropOverlay(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      // WKWebView on macOS exposes File.path for native app file drops
      const paths = files
        .map((f) => (f as File & { path?: string }).path ?? "")
        .filter((p) => {
          const ext = p.split(".").pop()?.toLowerCase() ?? "";
          return SUPPORTED_EXTENSIONS.has(ext) && p.length > 0;
        });
      if (paths.length > 0) {
        tauriCommands
          .importPhotos(paths)
          .catch((err) => console.error("[finderDrop]", err));
      }
    }

    document.addEventListener("dragenter", onDragEnter);
    document.addEventListener("dragleave", onDragLeave);
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);

    return () => {
      document.removeEventListener("dragenter", onDragEnter);
      document.removeEventListener("dragleave", onDragLeave);
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
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
