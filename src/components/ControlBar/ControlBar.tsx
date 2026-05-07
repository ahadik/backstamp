import { useState, useCallback } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useSession } from "../../state/SessionContext";
import { tauriCommands } from "../../lib/tauri";
import { ConfirmDialog } from "../common/ConfirmDialog/ConfirmDialog";
import { ApplyModal } from "../ApplyModal/ApplyModal";
import type { Photo, Metadata } from "../../state/SessionContext";
import styles from "./ControlBar.module.css";

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

export function ControlBar() {
  const { state, dispatch } = useSession();
  const { photos, selectedIds, canRollback } = state;

  const [showApplyModal, setShowApplyModal] = useState(false);
  const [showRollbackConfirm, setShowRollbackConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [applyTotal, setApplyTotal] = useState(0);

  const hasPending = photos.some((p) => p.pendingChanges !== null);
  const hasPhotos = photos.length > 0;

  const resetIds =
    selectedIds.size > 0
      ? [...selectedIds]
      : photos.map((p) => p.id);
  const resetLabel = selectedIds.size > 0 ? "Reset Selected" : "Reset All Photos";
  const resetHasPending = resetIds.some((id) => {
    const p = photos.find((ph) => ph.id === id);
    return p ? p.pendingChanges !== null : false;
  });

  async function handleApply() {
    const photosWithPending = photos.filter((p) => p.pendingChanges !== null);
    if (photosWithPending.length === 0) return;

    const changes: Record<string, Record<string, string | number | null>> = {};
    for (const photo of photosWithPending) {
      changes[photo.id] = photo.pendingChanges as Record<string, string | number | null>;
    }

    setApplyTotal(photosWithPending.length);
    dispatch({ type: "APPLY_START" });
    setShowApplyModal(true);

    try {
      await tauriCommands.applyChanges({ changes });
    } catch (err) {
      console.error("[ControlBar] applyChanges failed:", err);
      // Close the modal — events may not fire if command failed immediately
      setShowApplyModal(false);
      dispatch({ type: "APPLY_COMPLETE", updatedPhotos: [], canRollback });
    }
  }

  async function handleRollback() {
    setShowRollbackConfirm(false);
    try {
      await tauriCommands.rollback();
      const result = await tauriCommands.loadSession();
      const restoredPhotos = result.photos.map(mapLoadedPhoto);
      dispatch({
        type: "ROLLBACK_COMPLETE",
        restoredPhotos,
        canRollback: result.canRollback,
      });
    } catch (err) {
      console.error("[ControlBar] rollback failed:", err);
    }
  }

  async function handleReset() {
    setShowResetConfirm(false);
    try {
      await tauriCommands.resetPhotos(resetIds);
      dispatch({ type: "CLEAR_PENDING", ids: resetIds });
    } catch (err) {
      console.error("[ControlBar] resetPhotos failed:", err);
    }
  }

  const handleApplyClose = useCallback(() => setShowApplyModal(false), []);

  return (
    <>
      <div className={styles.controlBar}>
        <button
          className="btn btn-primary"
          disabled={!hasPending}
          onClick={handleApply}
        >
          Apply
        </button>
        <button
          className="btn btn-glass"
          disabled={!canRollback}
          onClick={() => setShowRollbackConfirm(true)}
        >
          Roll Back
        </button>
        <button
          className="btn btn-glass"
          disabled={!hasPhotos || !resetHasPending}
          onClick={() => setShowResetConfirm(true)}
        >
          {resetLabel}
        </button>
      </div>

      {showApplyModal && (
        <ApplyModal total={applyTotal} onClose={handleApplyClose} />
      )}

      {showRollbackConfirm && (
        <ConfirmDialog
          title="Roll Back?"
          message="Roll back the most recent Apply? This cannot be undone."
          confirmLabel="Roll Back"
          destructive
          onConfirm={handleRollback}
          onCancel={() => setShowRollbackConfirm(false)}
        />
      )}

      {showResetConfirm && (
        <ConfirmDialog
          title={`Reset ${resetIds.length} photo${resetIds.length !== 1 ? "s" : ""}?`}
          message={`Reset ${resetIds.length} photo${resetIds.length !== 1 ? "s" : ""} to their original metadata? Pending changes will be discarded.`}
          confirmLabel="Reset"
          destructive
          onConfirm={handleReset}
          onCancel={() => setShowResetConfirm(false)}
        />
      )}
    </>
  );
}
