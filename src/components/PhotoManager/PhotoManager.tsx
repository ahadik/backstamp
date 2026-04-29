import { useEffect, useState, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { FloatingControls } from "./FloatingControls/FloatingControls";
import { PhotoGrid } from "./PhotoGrid/PhotoGrid";
import { ImportModal } from "../ImportModal/ImportModal";
import { useSession } from "../../state/SessionContext";
import type { Photo, Metadata } from "../../state/SessionContext";
import styles from "./PhotoManager.module.css";

interface RawPhotoData {
  id: string;
  filePath: string;
  thumbnailSmall: string;
  thumbnailLarge: string;
  fileStatus: string;
  metadata: {
    captureDate: string | null;
    captureTime: string | null;
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
  const [importState, setImportState] = useState<{
    isOpen: boolean;
    done: number;
    total: number;
    errors: string[];
  }>({ isOpen: false, done: 0, total: 0, errors: [] });

  const handleDismiss = useCallback(() => {
    setImportState({ isOpen: false, done: 0, total: 0, errors: [] });
  }, []);

  useEffect(() => {
    const unlisteners = [
      listen<{ total: number }>("import:start", (e) => {
        setImportState({ isOpen: true, done: 0, total: e.payload.total, errors: [] });
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

      listen("import:complete", () => {
        setImportState((prev) => ({ ...prev }));
      }),
    ];

    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, [dispatch]);

  return (
    <div className={styles.photoManager}>
      <FloatingControls />
      <PhotoGrid />
      <ImportModal
        isOpen={importState.isOpen}
        done={importState.done}
        total={importState.total}
        errors={importState.errors}
        onDismiss={handleDismiss}
      />
    </div>
  );
}
