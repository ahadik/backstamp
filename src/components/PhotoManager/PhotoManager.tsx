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

const RAW_EXTENSIONS = new Set([
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

interface PhotoManagerProps {
  onOpenSettings: () => void;
}

export function PhotoManager({ onOpenSettings }: PhotoManagerProps) {
  const { state: session, dispatch: sessionDispatch } = useSession();
  const { dispatch: corpusDispatch } = useCorpus();
  const { state: uiState } = useUI();

  const [showDropOverlay, setShowDropOverlay] = useState(false);
  const [showGpxKeyPrompt, setShowGpxKeyPrompt] = useState(false);
  const [pendingSidecarSearch, setPendingSidecarSearch] = useState<{
    rawsWithoutXmp: string[];
    allRawPaths: string[];
    sidecarMap: Record<string, string>;
    gpxPaths: string[];
  } | null>(null);
  const [sidecarMissingNotice, setSidecarMissingNotice] = useState<string[] | null>(null);
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
      // Mapbox Static Images API has an ~8192-char URL limit. Downsample dense
      // tracks (e.g. 1-point-per-second GPS logs) to stay well within it.
      const MAX_POINTS = 100;
      const sampled = trackPoints.length <= MAX_POINTS
        ? trackPoints
        : trackPoints.filter((_, i) => i % Math.ceil(trackPoints.length / MAX_POINTS) === 0);
      const geojson = encodeURIComponent(
        JSON.stringify({
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: sampled.map((p) => [p.lng, p.lat]),
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
    if (!uiState.mapboxToken) {
      setShowGpxKeyPrompt(true);
      return;
    }
    try {
      const result = await tauriCommands.importGpx(path);
      const gpxFile: GpxFile = {
        id: result.id,
        filePath: result.filePath,
        addedAt: result.addedAt,
        trackPoints: result.trackPoints,
        thumbnailPath: null,
        timezone: result.timezone,
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
    const rawPaths: string[] = [];
    const regularPhotoPaths: string[] = [];
    const xmpPaths: string[] = [];
    const gpxPaths: string[] = [];

    for (const path of paths) {
      const ext = path.split(".").pop()?.toLowerCase() ?? "";
      if (RAW_EXTENSIONS.has(ext)) rawPaths.push(path);
      else if (SUPPORTED_EXTENSIONS.has(ext)) regularPhotoPaths.push(path);
      else if (ext === "xmp") xmpPaths.push(path);
      else if (GPX_EXTENSIONS.has(ext)) gpxPaths.push(path);
    }

    // Build sidecar map from XMP files dropped alongside RAW files.
    // Match on full path minus extension (directory-aware, case-insensitive).
    const sidecarMap: Record<string, string> = {};
    const xmpByStem = new Map<string, string>();
    for (const xmp of xmpPaths) {
      const stem = xmp.replace(/\.[^./]+$/, "").toLowerCase();
      xmpByStem.set(stem, xmp);
    }

    const rawsWithoutXmp: string[] = [];
    for (const raw of rawPaths) {
      const stem = raw.replace(/\.[^./]+$/, "").toLowerCase();
      const match = xmpByStem.get(stem);
      if (match) sidecarMap[raw] = match;
      else rawsWithoutXmp.push(raw);
    }

    const allRawPaths = [...regularPhotoPaths, ...rawPaths];

    if (rawsWithoutXmp.length > 0) {
      // Pause and ask whether to search for sidecars on disk.
      setPendingSidecarSearch({ rawsWithoutXmp, allRawPaths, sidecarMap, gpxPaths });
    } else {
      if (allRawPaths.length > 0) {
        tauriCommands.importPhotos(allRawPaths, sidecarMap).catch((err) =>
          console.error("[finderDrop]", err)
        );
      }
      for (const gpxPath of gpxPaths) handleGpxDropRef.current(gpxPath);
    }
  }, []);

  const handleFinderDropRef = useRef(handleFinderDrop);
  handleFinderDropRef.current = handleFinderDrop;

  // Load corpus on mount (session/settings are hydrated by App.tsx)
  useEffect(() => {
    tauriCommands.loadCorpus()
      .then((corpus) => corpusDispatch({ type: "LOAD_CORPUS", corpus }))
      .catch((err) => console.error("[PhotoManager] loadCorpus failed:", err));
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
          cancelLabel={pendingGpxImport.matchCount === 0 ? "Cancel" : "No"}
          infoOnly={pendingGpxImport.matchCount === 0}
          onConfirm={() => {
            applyGpxAutoTag(
              session.photos,
              pendingGpxImport.gpxFile.trackPoints,
              (action) => {
                sessionDispatch(action);
                for (const { id, changes } of action.updates) {
                  const fields = Object.entries(changes).map(([field, value]) => ({
                    field,
                    value: value == null ? null : String(value),
                  }));
                  tauriCommands.setPendingChanges([id], fields).catch(console.error);
                }
              }
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
      {showGpxKeyPrompt && (
        <ConfirmDialog
          title="Mapbox API Key Required"
          message="A Mapbox API key is required to import GPX files. Route thumbnails are generated using the Mapbox Static Images API."
          confirmLabel="Open Settings"
          onConfirm={() => {
            setShowGpxKeyPrompt(false);
            onOpenSettings();
          }}
          onCancel={() => setShowGpxKeyPrompt(false)}
        />
      )}
      {pendingSidecarSearch && (
        <ConfirmDialog
          title="Search for XMP Sidecars?"
          message={`${pendingSidecarSearch.rawsWithoutXmp.length} RAW file${pendingSidecarSearch.rawsWithoutXmp.length === 1 ? " was" : "s were"} dropped without an XMP sidecar. Search for sidecar files in the same folder${pendingSidecarSearch.rawsWithoutXmp.length === 1 ? "" : "s"}?`}
          confirmLabel="Search"
          cancelLabel="Import Without Sidecar"
          onConfirm={() => {
            const { rawsWithoutXmp, allRawPaths, sidecarMap, gpxPaths } = pendingSidecarSearch;
            setPendingSidecarSearch(null);
            (async () => {
              const result = await tauriCommands.findXmpSidecars(rawsWithoutXmp);
              const mergedMap = { ...sidecarMap, ...result.found };
              if (result.missing.length > 0) setSidecarMissingNotice(result.missing);
              if (allRawPaths.length > 0) {
                tauriCommands.importPhotos(allRawPaths, mergedMap).catch((err) =>
                  console.error("[finderDrop]", err)
                );
              }
              for (const gpxPath of gpxPaths) handleGpxDropRef.current(gpxPath);
            })();
          }}
          onCancel={() => {
            const { allRawPaths, sidecarMap, gpxPaths } = pendingSidecarSearch;
            setPendingSidecarSearch(null);
            if (allRawPaths.length > 0) {
              tauriCommands.importPhotos(allRawPaths, sidecarMap).catch((err) =>
                console.error("[finderDrop]", err)
              );
            }
            for (const gpxPath of gpxPaths) handleGpxDropRef.current(gpxPath);
          }}
        />
      )}
      {sidecarMissingNotice && (
        <ConfirmDialog
          title="XMP Sidecar Not Found"
          message={`No XMP sidecar was found for ${sidecarMissingNotice.length} file${sidecarMissingNotice.length === 1 ? "" : "s"}. These files will be imported with their embedded camera metadata only. To include edits or additional metadata, write the EXIF data to disk using your photo management software (e.g. Lightroom, Capture One) before importing.`}
          infoOnly
          onConfirm={() => setSidecarMissingNotice(null)}
          onCancel={() => setSidecarMissingNotice(null)}
        />
      )}
    </div>
  );
}
