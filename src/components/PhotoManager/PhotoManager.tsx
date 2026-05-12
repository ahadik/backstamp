import { useEffect, useState, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { FloatingControls } from "./FloatingControls/FloatingControls";
import { PhotoGrid } from "./PhotoGrid/PhotoGrid";
import { ImportModal } from "../ImportModal/ImportModal";
import { DropImportOverlay } from "./DropImportOverlay";
import { ConfirmDialog } from "../common/ConfirmDialog/ConfirmDialog";
import { useSession } from "../../state/SessionContext";
import { useCorpus } from "../../state/CorpusContext";
import { useUI } from "../../state/UIContext";
import type { Photo, Metadata, GpxFile } from "../../state/SessionContext";
import type { TrackPoint } from "../../lib/tauri";
import { tauriCommands } from "../../lib/tauri";
import { countMatches, applyGpxAutoTag } from "../../lib/gpxMatching";
import styles from "./PhotoManager.module.css";

const SUPPORTED_EXTENSIONS = new Set([
  "jpg", "jpeg", "tif", "tiff", "heic",
  "dng", "cr3", "cr2", "nef", "arw", "raf", "orf", "rw2", "pef",
]);

const GPX_EXTENSIONS = new Set(["gpx"]);

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
    cameraMake: string | null;
    cameraModel: string | null;
    lens: string | null;
    filmVendor: string | null;
    filmType: string | null;
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
    cameraMake: raw.metadata.cameraMake,
    cameraModel: raw.metadata.cameraModel,
    lens: raw.metadata.lens,
    filmVendor: raw.metadata.filmVendor,
    filmType: raw.metadata.filmType,
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
  const { state: session, dispatch: sessionDispatch } = useSession();
  const { dispatch: corpusDispatch } = useCorpus();
  const { state: uiState, dispatch: uiDispatch } = useUI();

  const [showDropOverlay, setShowDropOverlay] = useState(false);
  const [pendingGpxImport, setPendingGpxImport] = useState<{
    gpxFile: GpxFile;
    matchCount: number;
    totalCount: number;
  } | null>(null);
  const [gpxImportError, setGpxImportError] = useState<string | null>(null);
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

  const fetchAndSaveGpxThumbnail = useCallback(async (
    gpxId: string,
    trackPoints: TrackPoint[],
    mapboxToken: string
  ): Promise<void> => {
    try {
      const geojson = encodeURIComponent(
        JSON.stringify({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: trackPoints.map((p) => [p.lng, p.lat]),
          },
          properties: {},
        })
      );
      const url = `https://api.mapbox.com/styles/v1/mapbox/dark-v11/static/geojson(${geojson})/auto/400x200?access_token=${mapboxToken}&padding=20`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`Mapbox Static Images: ${resp.status}`);
      const buffer = await resp.arrayBuffer();
      const data = Array.from(new Uint8Array(buffer));
      const savedPath = await tauriCommands.saveGpxThumbnail(gpxId, data);
      sessionDispatch({ type: "UPDATE_GPX_THUMBNAIL", id: gpxId, thumbnailPath: savedPath });
    } catch (err) {
      console.error("[fetchAndSaveGpxThumbnail]", err);
    }
  }, [sessionDispatch]);

  const handleGpxDrop = useCallback(async (path: string) => {
    try {
      const result = await tauriCommands.importGpx(path);
      const gpxFile: GpxFile = {
        id: result.id,
        filePath: result.filePath,
        addedAt: result.addedAt,
        trackPoints: result.trackPoints,
        thumbnailPath: null,
      };
      sessionDispatch({ type: "ADD_GPX", gpxFile });

      const mapboxToken = uiState.mapboxToken;
      if (mapboxToken && result.trackPoints.length > 0) {
        fetchAndSaveGpxThumbnail(result.id, result.trackPoints, mapboxToken);
      }

      const { matching, total } = countMatches(session.photos, result.trackPoints);
      setPendingGpxImport({ gpxFile, matchCount: matching, totalCount: total });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setGpxImportError(msg);
    }
  }, [sessionDispatch, session.photos, uiState.mapboxToken, fetchAndSaveGpxThumbnail]);

  const handleGpxDropRef = useRef(handleGpxDrop);
  handleGpxDropRef.current = handleGpxDrop;

  const handleFinderDrop = useCallback((paths: string[]) => {
    const photoPaths: string[] = [];
    const gpxPaths: string[] = [];
    for (const path of paths) {
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      if (SUPPORTED_EXTENSIONS.has(ext)) photoPaths.push(path);
      else if (GPX_EXTENSIONS.has(ext)) gpxPaths.push(path);
    }
    if (photoPaths.length > 0) {
      tauriCommands.importPhotos(photoPaths).catch((err) => console.error("[finderDrop]", err));
    }
    for (const gpxPath of gpxPaths) {
      handleGpxDropRef.current(gpxPath);
    }
  }, []);

  const handleFinderDropRef = useRef(handleFinderDrop);
  handleFinderDropRef.current = handleFinderDrop;

  // Restore session + load corpus + load settings on startup
  useEffect(() => {
    async function init() {
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
          sessionDispatch({ type: "IMPORT_PHOTOS", photos });
        }
        if (result.canRollback) {
          sessionDispatch({
            type: "APPLY_COMPLETE",
            updatedPhotos: [],
            canRollback: result.canRollback,
          });
        }
        if (result.gpxFiles.length > 0) {
          for (const g of result.gpxFiles) {
            sessionDispatch({
              type: "ADD_GPX",
              gpxFile: {
                id: g.id,
                filePath: g.filePath,
                addedAt: g.addedAt,
                trackPoints: g.trackPoints,
                thumbnailPath: g.thumbnailPath,
              },
            });
          }
        }
      } catch (err) {
        console.error("[PhotoManager] loadSession failed:", err);
      }

      try {
        const corpus = await tauriCommands.loadCorpus();
        corpusDispatch({ type: "LOAD_CORPUS", corpus });
      } catch (err) {
        console.error("[PhotoManager] loadCorpus failed:", err);
      }

      try {
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

  // Handle Finder file drags. dragDropEnabled: true means onDragDropEvent fires with real
  // file paths. When a Finder drag enters, we unmount PhotoGrid and show the overlay —
  // this avoids any pointer-events conflict between the overlay and tile drag handlers.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    async function setup() {
      const webview = getCurrentWebview();
      const fn = await webview.onDragDropEvent((event) => {
        const { type } = event.payload;
        if (type === "enter" && event.payload.paths.length > 0) {
          setShowDropOverlay(true);
        } else if (type === "drop" && event.payload.paths.length > 0) {
          setShowDropOverlay(false);
          handleFinderDropRef.current(event.payload.paths);
        } else if (type === "leave") {
          setShowDropOverlay(false);
        }
      });
      if (cancelled) fn();
      else unlisten = fn;
    }

    setup().catch(console.error);
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <div className={styles.photoManager}>
      <FloatingControls />
      {!showDropOverlay && <PhotoGrid />}
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
      {pendingGpxImport && (
        <ConfirmDialog
          title={pendingGpxImport.matchCount === 0 ? "GPX Imported" : "Auto-Tag Locations from GPX?"}
          message={
            pendingGpxImport.matchCount === 0
              ? "GPX file imported successfully. No photos have timestamps that fall within this track's time range."
              : `${pendingGpxImport.matchCount} photo${pendingGpxImport.matchCount === 1 ? "" : "s"} have timestamps that overlap with this GPX track. Auto-tag their locations now?`
          }
          confirmLabel="Yes"
          cancelLabel="No"
          infoOnly={pendingGpxImport.matchCount === 0}
          onConfirm={() => {
            applyGpxAutoTag(
              session.photos,
              pendingGpxImport.gpxFile.trackPoints,
              sessionDispatch
            );
            sessionDispatch({ type: "SELECT_GPX", id: pendingGpxImport.gpxFile.id });
            setPendingGpxImport(null);
          }}
          onCancel={() => {
            sessionDispatch({ type: "SELECT_GPX", id: pendingGpxImport.gpxFile.id });
            setPendingGpxImport(null);
          }}
        />
      )}
      {gpxImportError && (
        <ConfirmDialog
          title="GPX Import Failed"
          message={gpxImportError}
          infoOnly
          onConfirm={() => {}}
          onCancel={() => setGpxImportError(null)}
        />
      )}
    </div>
  );
}
