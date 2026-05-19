import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import styles from "./App.module.css";
import { PhotoManager } from "./components/PhotoManager/PhotoManager";
import { TopBar } from "./components/TopBar/TopBar";
import { InspectorPanel } from "./components/InspectorPanel/InspectorPanel";
import { MapPanel } from "./components/MapPanel/MapPanel";
import { ApplyModal } from "./components/ApplyModal/ApplyModal";
import { SettingsModal } from "./components/SettingsModal/SettingsModal";
import { ErrorModal } from "./components/common/ErrorModal/ErrorModal";
import { DevLogModal } from "./components/common/DevLogModal/DevLogModal";
import { useSession } from "./state/SessionContext";
import { useUI } from "./state/UIContext";
import { tauriCommands } from "./lib/tauri";
import type { ApplyPhase, ApplyError } from "./components/ApplyModal/ApplyModal";
import type { Metadata, Photo, GpxFile } from "./state/SessionContext";
import type { TrackPoint } from "./lib/tauri";

function mapLoadedPhoto(p: {
  id: string;
  filePath: string;
  fileStatus: "ok" | "missing";
  thumbnailSmall: string;
  thumbnailLarge: string;
  originalMetadata: Metadata;
  currentMetadata: Metadata;
  pendingChanges: Partial<Metadata> | null;
}): Photo {
  return {
    id: p.id,
    filePath: p.filePath,
    fileStatus: p.fileStatus,
    thumbnail: {
      small: convertFileSrc(p.thumbnailSmall),
      large: convertFileSrc(p.thumbnailLarge),
    },
    originalMetadata: p.originalMetadata,
    currentMetadata: p.currentMetadata,
    pendingChanges: p.pendingChanges ?? null,
  };
}

function mapLoadedGpxFile(g: {
  id: string;
  filePath: string;
  addedAt: number;
  trackPoints: TrackPoint[];
  thumbnailPath: string | null;
  timezone: string | null;
}): GpxFile {
  return {
    id: g.id,
    filePath: g.filePath,
    addedAt: g.addedAt,
    trackPoints: g.trackPoints,
    thumbnailPath: g.thumbnailPath,
    timezone: g.timezone,
  };
}

function App() {
  const { state, dispatch } = useSession();
  const { dispatch: uiDispatch } = useUI();
  const [applyPhase, setApplyPhase] = useState<ApplyPhase>({ type: "idle" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);

  useEffect(() => {
    async function hydrateSession() {
      try {
        const session = await tauriCommands.loadSession();
        dispatch({
          type: "RESTORE_SESSION",
          photos: session.photos.map(mapLoadedPhoto),
          gpxFiles: session.gpxFiles.map(mapLoadedGpxFile),
          canRollback: session.canRollback,
        });
        uiDispatch({
          type: "RESTORE_UI",
          workingTimezone: session.workingTimezone,
          gridColumns: session.gridColumns,
          mapPanelHeight: session.mapPanelHeight,
        });
      } catch (err) {
        console.error("[App] session restore failed:", err);
      } finally {
        setSessionLoading(false);
      }

      tauriCommands.getApiKey("mapbox_token").then((token) => {
        if (token) uiDispatch({ type: "SET_MAPBOX_TOKEN", token });
      });
      tauriCommands.getApiKey("google_maps_key").then((key) => {
        if (key) uiDispatch({ type: "SET_GOOGLE_MAPS_KEY", key });
      });
      tauriCommands.getApiKey("claude_api_key").then((key) => {
        if (key) uiDispatch({ type: "SET_CLAUDE_API_KEY", key });
      });
    }

    hydrateSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const pending = [
      listen<{ done: number; total: number; photoId: string; filePath: string; success: boolean; error: string | null }>(
        "apply:progress",
        ({ payload }) => {
          setApplyPhase((prev) => {
            if (prev.type !== "applying") return prev;
            const errors: ApplyError[] = payload.success
              ? prev.errors
              : [
                  ...prev.errors,
                  {
                    photoId: payload.photoId,
                    filePath: payload.filePath,
                    error: payload.error ?? "Unknown error",
                  },
                ];
            return { ...prev, done: payload.done, errors };
          });
        }
      ),

      listen<{ done: number; total: number }>("apply:undo_progress", ({ payload }) => {
        setApplyPhase({ type: "undoing", done: payload.done, total: payload.total });
      }),

      listen<{ failedFiles: Array<{ photoId: string; filePath: string; error: string }> }>(
        "apply:complete",
        async ({ payload }) => {
          try {
            const session = await tauriCommands.loadSession();
            const updatedPhotos = session.photos.map(mapLoadedPhoto);
            dispatch({
              type: "APPLY_COMPLETE",
              updatedPhotos,
              canRollback: session.canRollback,
            });
          } catch (err) {
            console.error("[App] loadSession after apply failed:", err);
            dispatch({ type: "APPLY_COMPLETE", updatedPhotos: [], canRollback: true });
          }
          const errors: ApplyError[] = payload.failedFiles.map((f) => ({
            photoId: f.photoId,
            filePath: f.filePath,
            error: f.error,
          }));
          setApplyPhase({ type: "complete", errors });
        }
      ),

      listen("apply:cancelled", () => {
        dispatch({ type: "APPLY_COMPLETE", updatedPhotos: [], canRollback: state.canRollback });
        setApplyPhase({ type: "cancelled" });
      }),
    ];

    return () => {
      pending.forEach((p) => p.then((fn) => fn()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  function openSettings() {
    setSettingsOpen(true);
  }

  if (sessionLoading) {
    return (
      <div className={styles.sessionLoader}>
        <div className={styles.spinner} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <PhotoManager onOpenSettings={openSettings} />
      <div className={styles.rightColumn}>
        <TopBar
          applyPhase={applyPhase}
          setApplyPhase={setApplyPhase}
          onOpenSettings={openSettings}
        />
        <InspectorPanel onOpenSettings={openSettings} />
      </div>
      <MapPanel onOpenSettings={openSettings} />
      {applyPhase.type !== "idle" && (
        <ApplyModal
          phase={applyPhase}
          onCancel={async () => {
            setApplyPhase((prev) =>
              prev.type === "applying"
                ? { type: "undoing", done: 0, total: prev.done }
                : prev
            );
            await tauriCommands.applyCancel();
          }}
          onDismiss={() => setApplyPhase({ type: "idle" })}
        />
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <ErrorModal />
      <DevLogModal />
    </div>
  );
}

export default App;
