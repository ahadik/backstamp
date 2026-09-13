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
import { reportError } from "../../lib/errors";
import { countMatches, applyGpxAutoTag, tracksFrom } from "../../lib/gpxMatching";
import styles from "./PhotoManager.module.css";

const SUPPORTED_EXTENSIONS = new Set([
  "jpg", "jpeg", "tif", "tiff", "heic",
  "dng", "cr3", "cr2", "nef", "arw", "raf", "orf", "rw2", "pef",
]);

const RAW_EXTENSIONS = new Set([
  "dng", "cr3", "cr2", "nef", "arw", "raf", "orf", "rw2", "pef",
]);

const GPX_EXTENSIONS = new Set(["gpx"]);

/** Overlay wording based on what's being dragged: photos, GPX tracks, folders, or a mix. */
function dropOverlayLabel(paths: string[]): string {
  let hasPhoto = false;
  let hasGpx = false;
  let hasFolder = false;
  for (const path of paths) {
    const name = path.split("/").pop() ?? "";
    const dotIdx = name.lastIndexOf(".");
    // No extension on the final path segment — almost certainly a folder.
    if (dotIdx <= 0) {
      hasFolder = true;
      continue;
    }
    const ext = name.slice(dotIdx + 1).toLowerCase();
    if (SUPPORTED_EXTENSIONS.has(ext) || ext === "xmp") hasPhoto = true;
    else if (GPX_EXTENSIONS.has(ext)) hasGpx = true;
  }
  if (hasFolder && !hasPhoto && !hasGpx) {
    return paths.length === 1 ? "Drop folder to import" : "Drop folders to import";
  }
  if (hasGpx && !hasPhoto && !hasFolder) {
    return paths.length === 1 ? "Drop GPX file to import" : "Drop GPX files to import";
  }
  if (hasPhoto && !hasGpx && !hasFolder) return "Drop photos to import";
  return "Drop files to import";
}

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

// Mapbox Static Images API has an ~8192-char URL limit. Downsample dense
// tracks (e.g. 1-point-per-second GPS logs) to stay well within it.
function sampleTrack(points: TrackPoint[], maxPoints: number): TrackPoint[] {
  if (points.length <= maxPoints) return points;
  return points.filter((_, i) => i % Math.ceil(points.length / maxPoints) === 0);
}

const ROUTE_PREVIEW_COLORS = ["4264fb", "f74e4e", "31b855", "f7a941", "a05cf7", "1fb6c1"];

/** Static map URL rendering all dropped routes together, one color per route. */
function buildRoutesPreviewUrl(tracks: TrackPoint[][], mapboxToken: string): string | null {
  const drawable = tracks.filter((t) => t.length >= 2);
  if (drawable.length === 0) return null;
  const perTrack = Math.max(2, Math.floor(100 / drawable.length));
  const geojson = encodeURIComponent(
    JSON.stringify({
      type: "FeatureCollection",
      features: drawable.map((points, i) => ({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: sampleTrack(points, perTrack).map((p) => [p.lng, p.lat]),
        },
        properties: {
          stroke: `#${ROUTE_PREVIEW_COLORS[i % ROUTE_PREVIEW_COLORS.length]}`,
          "stroke-width": 3,
        },
      })),
    })
  );
  // streets-v12 (also used by LocationSection's mini map) — the light/dark
  // styles are monotone by design and read as a black box at this size.
  return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/geojson(${geojson})/auto/400x200@2x?access_token=${mapboxToken}&padding=30`;
}

// One entry per drop gesture. The dialog opens immediately in "processing"
// state and is updated in place once parsing and match-counting finish.
type PendingGpxImport =
  | { id: number; status: "processing"; fileCount: number }
  | {
      id: number;
      status: "ready";
      gpxFiles: GpxFile[];
      tracks: TrackPoint[][];
      matchCount: number;
      totalCount: number;
      previewUrl: string | null;
    };

interface PhotoManagerProps {
  onOpenSettings: () => void;
}

export function PhotoManager({ onOpenSettings }: PhotoManagerProps) {
  const { state: session, dispatch: sessionDispatch } = useSession();
  const { dispatch: corpusDispatch } = useCorpus();
  const { state: uiState } = useUI();

  const [dropOverlay, setDropOverlay] = useState<{ label: string } | null>(null);
  const [showGpxKeyPrompt, setShowGpxKeyPrompt] = useState(false);
  const [pendingSidecarSearch, setPendingSidecarSearch] = useState<{
    rawsWithoutXmp: string[];
    allRawPaths: string[];
    sidecarMap: Record<string, string>;
    gpxPaths: string[];
  } | null>(null);
  const [sidecarMissingNotice, setSidecarMissingNotice] = useState<string[] | null>(null);
  // Queue of prompts, one per drop gesture — a bulk drop imports several GPX
  // files at once and gets a single combined auto-tag confirmation.
  const [pendingGpxImports, setPendingGpxImports] = useState<PendingGpxImport[]>([]);
  const gpxBatchIdRef = useRef(0);
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
      const sampled = sampleTrack(trackPoints, 100);
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

  const handleGpxDrop = useCallback(async (paths: string[]) => {
    if (paths.length === 0) return;
    const mapboxToken = uiState.mapboxToken;
    if (!mapboxToken) {
      setShowGpxKeyPrompt(true);
      return;
    }

    // Open the dialog right away; it flips to the confirmation once parsing
    // and match-counting below finish.
    const batchId = ++gpxBatchIdRef.current;
    setPendingGpxImports((prev) => [
      ...prev,
      { id: batchId, status: "processing", fileCount: paths.length },
    ]);

    const imported: GpxFile[] = [];
    const errors: string[] = [];
    for (const path of paths) {
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
        if (result.trackPoints.length > 0) {
          fetchAndSaveGpxThumbnail(result.id, result.trackPoints, mapboxToken);
        }
        imported.push(gpxFile);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${path.split("/").pop()}: ${msg}`);
      }
    }

    if (errors.length > 0) {
      setGpxImportError(errors.join("\n"));
    }
    if (imported.length === 0) {
      setPendingGpxImports((prev) => prev.filter((b) => b.id !== batchId));
      return;
    }

    // Prefetch the combined-routes preview while the processing dialog is up,
    // so the confirmation appears with the map already rendered.
    let previewUrl: string | null = null;
    const remoteUrl = buildRoutesPreviewUrl(imported.map((g) => g.trackPoints), mapboxToken);
    if (remoteUrl) {
      try {
        const resp = await fetch(remoteUrl);
        if (!resp.ok) throw new Error(`Mapbox Static Images: ${resp.status}`);
        previewUrl = URL.createObjectURL(await resp.blob());
      } catch (err) {
        console.error("[gpxRoutesPreview]", err);
      }
    }

    // Match photos against each dropped track separately: gaps inside a track
    // interpolate, but separate tracks are never bridged.
    const tracks = tracksFrom(imported);
    const { matching, total } = countMatches(session.photos, tracks);
    setPendingGpxImports((prev) =>
      prev.map((b) =>
        b.id === batchId
          ? {
              id: batchId,
              status: "ready" as const,
              gpxFiles: imported,
              tracks,
              matchCount: matching,
              totalCount: total,
              previewUrl,
            }
          : b
      )
    );
  }, [sessionDispatch, session.photos, uiState.mapboxToken, fetchAndSaveGpxThumbnail]);

  const handleGpxDropRef = useRef(handleGpxDrop);
  handleGpxDropRef.current = handleGpxDrop;

  const handleFinderDrop = useCallback(async (rawInputPaths: string[]) => {
    // Expand any dropped/selected directories into the importable files they
    // contain; plain file paths pass through unchanged.
    let paths: string[];
    try {
      paths = await tauriCommands.expandImportPaths(rawInputPaths);
    } catch (err) {
      reportError("Failed to read dropped folders", err);
      return;
    }

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
        tauriCommands.importPhotos(allRawPaths, sidecarMap)
          .catch((err) => reportError("Failed to import photos", err));
      }
      handleGpxDropRef.current(gpxPaths);
    }
  }, []);

  const handleFinderDropRef = useRef(handleFinderDrop);
  handleFinderDropRef.current = handleFinderDrop;

  // Load corpus on mount (session/settings are hydrated by App.tsx)
  useEffect(() => {
    tauriCommands.loadCorpus()
      .then((corpus) => corpusDispatch({ type: "LOAD_CORPUS", corpus }))
      .catch((err) => reportError("Failed to load saved camera and film lists", err));
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
          setDropOverlay({ label: dropOverlayLabel(event.payload.paths) });
        } else if (type === "drop" && event.payload.paths.length > 0) {
          setDropOverlay(null);
          handleFinderDropRef.current(event.payload.paths)
            .catch((err) => reportError("Failed to import dropped files", err));
        } else if (type === "leave") {
          setDropOverlay(null);
        }
      });
      if (cancelled) fn();
      else unlisten = fn;
    }

    setup().catch((err) => reportError("Failed to enable drag-and-drop import", err));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  return (
    <div className={styles.photoManager}>
      <FloatingControls
        onImportPaths={(paths) => {
          handleFinderDropRef.current(paths)
            .catch((err) => reportError("Failed to import selected files", err));
        }}
      />
      {!dropOverlay && <PhotoGrid />}
      <DropImportOverlay isVisible={dropOverlay !== null} label={dropOverlay?.label ?? ""} />
      <ImportModal
        isOpen={importState.isOpen}
        done={importState.done}
        total={importState.total}
        skipped={importState.skipped}
        isComplete={importState.isComplete}
        errors={importState.errors}
        onDismiss={handleDismiss}
      />
      {pendingGpxImports.length > 0 && (() => {
        const pendingGpxImport = pendingGpxImports[0];
        if (pendingGpxImport.status === "processing") {
          const many = pendingGpxImport.fileCount !== 1;
          return (
            <ConfirmDialog
              title="Importing GPX"
              message={
                <>
                  <div className={`${styles.gpxPreviewImage} ${styles.gpxPreviewLoading}`} />
                  {`Importing ${many ? `${pendingGpxImport.fileCount} GPX files` : "GPX file"}…`}
                </>
              }
              busy
              onConfirm={() => {}}
              onCancel={() => {}}
            />
          );
        }
        const { gpxFiles, matchCount, previewUrl } = pendingGpxImport;
        const single = gpxFiles.length === 1;
        const trackPhrase = single ? "this GPX track" : `these ${gpxFiles.length} GPX tracks`;
        const dequeue = () => {
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          setPendingGpxImports((prev) => prev.slice(1));
        };
        return (
          <ConfirmDialog
            title={matchCount === 0 ? "GPX Imported" : "Auto-Tag Locations from GPX?"}
            message={
              <>
                {previewUrl && (
                  <img
                    src={previewUrl}
                    alt={single ? "Imported GPX route" : "Imported GPX routes"}
                    className={styles.gpxPreviewImage}
                  />
                )}
                {matchCount === 0
                  ? `${single ? "GPX file" : `${gpxFiles.length} GPX files`} imported successfully. No photos have timestamps that fall within ${single ? "this track's time range" : "these tracks' time ranges"}.`
                  : `${matchCount} photo${matchCount === 1 ? "" : "s"} have timestamps that overlap with ${trackPhrase}. Auto-tag their locations now?`}
              </>
            }
            confirmLabel="Yes"
            cancelLabel={matchCount === 0 ? "Cancel" : "No"}
            infoOnly={matchCount === 0}
            onConfirm={() => {
              applyGpxAutoTag(
                session.photos,
                pendingGpxImport.tracks,
                (action) => {
                  sessionDispatch(action);
                  for (const { id, changes } of action.updates) {
                    const fields = Object.entries(changes).map(([field, value]) => ({
                      field,
                      value: value == null ? null : String(value),
                    }));
                    tauriCommands.setPendingChanges([id], fields)
                      .catch((err) => reportError("Failed to save location edits", err));
                  }
                }
              );
              sessionDispatch({ type: "SELECT_GPX", id: gpxFiles[0].id });
              dequeue();
            }}
            onCancel={() => {
              sessionDispatch({ type: "SELECT_GPX", id: gpxFiles[0].id });
              dequeue();
            }}
          />
        );
      })()}
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
                tauriCommands.importPhotos(allRawPaths, mergedMap)
                  .catch((err) => reportError("Failed to import photos", err));
              }
              handleGpxDropRef.current(gpxPaths);
            })().catch((err) => reportError("Failed to search for XMP sidecars", err));
          }}
          onCancel={() => {
            const { allRawPaths, sidecarMap, gpxPaths } = pendingSidecarSearch;
            setPendingSidecarSearch(null);
            if (allRawPaths.length > 0) {
              tauriCommands.importPhotos(allRawPaths, sidecarMap)
                .catch((err) => reportError("Failed to import photos", err));
            }
            handleGpxDropRef.current(gpxPaths);
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
