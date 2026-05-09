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
import { useSession } from "./state/SessionContext";
import { useUI } from "./state/UIContext";
import { tauriCommands } from "./lib/tauri";
import type { ApplyPhase, ApplyError } from "./components/ApplyModal/ApplyModal";
import type { Metadata, Photo } from "./state/SessionContext";

function mapLoadedPhoto(p: {
  id: string;
  filePath: string;
  fileStatus: "ok" | "missing";
  thumbnailSmall: string;
  thumbnailLarge: string;
  originalMetadata: Metadata;
  currentMetadata: Metadata;
  pendingChanges: null;
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
    pendingChanges: null,
  };
}

function App() {
  const { state, dispatch } = useSession();
  const { dispatch: uiDispatch } = useUI();
  const [applyPhase, setApplyPhase] = useState<ApplyPhase>({ type: "idle" });
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    tauriCommands.getSetting("mapbox_token").then((token) => {
      if (token) uiDispatch({ type: "SET_MAPBOX_TOKEN", token });
    });
    tauriCommands.getSetting("claude_api_key").then((key) => {
      if (key) uiDispatch({ type: "SET_CLAUDE_API_KEY", key });
    });
  }, [uiDispatch]);

  useEffect(() => {
    const pending = [
      listen<{ done: number; total: number; photoId: string; success: boolean; error: string | null }>(
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
                    filePath: state.photos.find((p) => p.id === payload.photoId)?.filePath ?? "",
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

      listen<{ failedFiles: Array<{ photoId: string; error: string }> }>(
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
            filePath: state.photos.find((p) => p.id === f.photoId)?.filePath ?? "",
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

  return (
    <div className="app-shell">
      <PhotoManager />
      <div className={styles.rightColumn}>
        <TopBar
          applyPhase={applyPhase}
          setApplyPhase={setApplyPhase}
          onOpenSettings={openSettings}
        />
        <InspectorPanel onOpenSettings={openSettings} />
      </div>
      <MapPanel />
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
    </div>
  );
}

export default App;
