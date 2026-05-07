import { useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useSession } from "../../state/SessionContext";
import { tauriCommands } from "../../lib/tauri";
import type { Photo, Metadata } from "../../state/SessionContext";
import styles from "./ApplyModal.module.css";

type Phase = "applying" | "undoing" | "done";

interface ApplyModalProps {
  total: number;
  onClose: () => void;
}

interface ProgressEvent {
  done: number;
  total: number;
}

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

export function ApplyModal({ total, onClose }: ApplyModalProps) {
  const { dispatch } = useSession();
  const [phase, setPhase] = useState<Phase>("applying");
  const [done, setDone] = useState(0);
  const [currentTotal, setCurrentTotal] = useState(total);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const unlisteners = [
      listen<ProgressEvent>("apply:progress", (e) => {
        setDone(e.payload.done);
        setCurrentTotal(e.payload.total);
      }),

      listen<ProgressEvent>("apply:undo_progress", (e) => {
        setPhase("undoing");
        setDone(e.payload.done);
        setCurrentTotal(e.payload.total);
      }),

      listen("apply:complete", async () => {
        try {
          const result = await tauriCommands.loadSession();
          const photos = result.photos.map(mapLoadedPhoto);
          dispatch({ type: "APPLY_COMPLETE", updatedPhotos: photos, canRollback: result.canRollback });
        } catch (err) {
          console.error("[ApplyModal] loadSession failed:", err);
          dispatch({ type: "APPLY_COMPLETE", updatedPhotos: [], canRollback: true });
        }
        onClose();
      }),

      listen("apply:cancelled", () => {
        dispatch({ type: "APPLY_START" }); // clears applyInProgress via inverse dispatch
        // Actually we need to reset applyInProgress — dispatch a no-op style action
        // The apply was cancelled and undone; just close the modal
        onClose();
      }),
    ];

    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, [dispatch, onClose]);

  async function handleCancel() {
    setCancelling(true);
    try {
      await tauriCommands.applyCancel();
    } catch (err) {
      console.error("[ApplyModal] applyCancel failed:", err);
    }
  }

  const percent =
    currentTotal > 0 ? Math.round((done / currentTotal) * 100) : 0;

  return (
    <div className={styles.backdrop}>
      <div className={`inspector-card ${styles.modal}`}>
        {phase === "applying" && (
          <>
            <h3 className={styles.title}>Writing changes…</h3>
            <p className={styles.counter}>
              {done} / {currentTotal} files
            </p>
          </>
        )}
        {phase === "undoing" && (
          <>
            <h3 className={styles.title}>Reverting changes…</h3>
            <p className={styles.counter}>
              {done} / {currentTotal} files
            </p>
          </>
        )}
        <div className={styles.progressTrack}>
          <div
            className={styles.progressFill}
            style={{ width: `${percent}%` }}
          />
        </div>
        {phase === "applying" && !cancelling && (
          <button className="btn btn-glass" onClick={handleCancel}>
            Cancel
          </button>
        )}
        {cancelling && (
          <p className={styles.cancelNote}>Cancelling…</p>
        )}
      </div>
    </div>
  );
}
