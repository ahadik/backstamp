import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useSession } from "../../state/SessionContext";
import { tauriCommands } from "../../lib/tauri";
import { buildApplyPayload } from "../../lib/applyUtils";
import { ConfirmDialog } from "../common/ConfirmDialog/ConfirmDialog";
import type { Photo, Metadata } from "../../state/SessionContext";
import type { ApplyPhase } from "../ApplyModal/ApplyModal";
import styles from "./TopBar.module.css";

interface TopBarProps {
  applyPhase: ApplyPhase;
  setApplyPhase: (phase: ApplyPhase) => void;
  onOpenSettings: () => void;
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

export function TopBar({ applyPhase, setApplyPhase, onOpenSettings }: TopBarProps) {
  const { state, dispatch } = useSession();
  const { photos, selectedIds, canRollback, applyInProgress } = state;

  const [isRollingBack, setIsRollingBack] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const hasPending = photos.some((p) => p.pendingChanges !== null);
  const hasSelected = selectedIds.size > 0;
  const hasPhotos = photos.length > 0;
  const busy = applyInProgress || applyPhase.type !== "idle";

  const resetIds = hasSelected ? [...selectedIds] : photos.map((p) => p.id);
  const resetLabel = hasSelected ? "Reset Selected" : "Reset All";

  async function handleApply() {
    const payload = buildApplyPayload(photos);
    if (Object.keys(payload.changes).length === 0) return;
    const total = Object.keys(payload.changes).length;
    dispatch({ type: "APPLY_START" });
    setApplyPhase({ type: "applying", done: 0, total, errors: [] });
    try {
      await tauriCommands.applyChanges(payload);
    } catch (err) {
      console.error("[TopBar] applyChanges failed:", err);
      dispatch({ type: "APPLY_COMPLETE", updatedPhotos: [], canRollback });
      setApplyPhase({ type: "idle" });
    }
  }

  async function handleRollback() {
    setIsRollingBack(true);
    setRollbackError(null);
    try {
      const result = await tauriCommands.rollback();
      const session = await tauriCommands.loadSession();
      const restoredPhotos = session.photos.map(mapLoadedPhoto);
      dispatch({
        type: "ROLLBACK_COMPLETE",
        restoredPhotos,
        canRollback: result.canRollback,
      });
      if (result.failedFiles.length > 0) {
        setRollbackError(`Roll Back failed for ${result.failedFiles.length} file(s).`);
      }
    } catch (err) {
      setRollbackError(String(err));
    } finally {
      setIsRollingBack(false);
    }
  }

  async function handleReset() {
    setShowResetConfirm(false);
    try {
      const result = await tauriCommands.resetPhotos(resetIds);
      dispatch({ type: "RESET_PHOTOS", ids: resetIds });
      if (result.failedFiles.length > 0) {
        setRollbackError(`Reset failed for ${result.failedFiles.length} file(s).`);
      }
    } catch (err) {
      setRollbackError(String(err));
    }
  }

  return (
    <>
      <header className={styles.topBar}>
        <div className={styles.meta}>
          <span className={`text-sm ${styles.count}`}>
            {photos.length} {photos.length === 1 ? "photo" : "photos"}
          </span>
        </div>
        <div className={styles.controls}>
          <button
            className="btn btn-primary"
            disabled={!hasPending || busy}
            onClick={handleApply}
          >
            Apply
          </button>
          <button
            className="btn btn-glass"
            disabled={!canRollback || busy || isRollingBack}
            onClick={handleRollback}
          >
            {isRollingBack ? "Rolling Back…" : "Roll Back"}
          </button>
          <button
            className="btn btn-glass"
            disabled={!hasPhotos || busy}
            onClick={() => setShowResetConfirm(true)}
          >
            {resetLabel}
          </button>
          <button
            className="btn btn-glass"
            onClick={onOpenSettings}
            aria-label="Open settings"
          >
            ⚙
          </button>
        </div>
        {rollbackError && (
          <div className={styles.errorBanner}>
            <span>{rollbackError}</span>
            <button
              className="btn btn-ghost"
              onClick={() => setRollbackError(null)}
            >
              Dismiss
            </button>
          </div>
        )}
      </header>

      {showResetConfirm && (
        <ConfirmDialog
          title={`Reset ${resetIds.length} photo${resetIds.length !== 1 ? "s" : ""}?`}
          message={`Reset ${resetIds.length} photo${resetIds.length !== 1 ? "s" : ""} to their original metadata? Applied writes on disk will be overwritten. This cannot be undone.`}
          confirmLabel="Reset"
          destructive
          onConfirm={handleReset}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}
    </>
  );
}
