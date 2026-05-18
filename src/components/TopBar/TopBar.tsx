import { useState, useRef, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { useSession } from "../../state/SessionContext";
import { useUI } from "../../state/UIContext";
import { useDevLog } from "../../state/DevLogContext";
import { tauriCommands } from "../../lib/tauri";
import { buildApplyPayload } from "../../lib/applyUtils";
import { ConfirmDialog } from "../common/ConfirmDialog/ConfirmDialog";
import type { Photo, Metadata } from "../../state/SessionContext";
import type { ApplyPhase } from "../ApplyModal/ApplyModal";
import styles from "./TopBar.module.css";

interface TopBarProps {
  applyPhase: ApplyPhase;
  setApplyPhase: (phase: ApplyPhase) => void;
}

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

export function TopBar({ applyPhase, setApplyPhase }: TopBarProps) {
  const { state, dispatch } = useSession();
  const { dispatch: uiDispatch } = useUI();
  const { entries: devEntries, open: openDevLog } = useDevLog();
  const { photos, selectedIds, canRollback, applyInProgress, gpxFiles } = state;

  const [isRollingBack, setIsRollingBack] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showUndoMenu, setShowUndoMenu] = useState(false);
  const undoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showUndoMenu) return;
    function handleClickOutside(e: MouseEvent) {
      if (undoRef.current && !undoRef.current.contains(e.target as Node)) {
        setShowUndoMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showUndoMenu]);

  const hasPending = photos.some((p) => p.pendingChanges !== null);
  const hasSelected = selectedIds.size > 0;
  const hasPhotos = photos.length > 0;
  const busy = applyInProgress || applyPhase.type !== "idle";
  const canUndoEdit = state.metadataHistory.length > 0;

  const resetIds = hasSelected ? [...selectedIds] : photos.map((p) => p.id);

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
    setApplyPhase({ type: "undoing", done: 0, total: 0 });
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
        setApplyPhase({ type: "idle" });
      } else {
        setApplyPhase({ type: "complete", errors: [] });
      }
    } catch (err) {
      setRollbackError(String(err));
      setApplyPhase({ type: "idle" });
    } finally {
      setIsRollingBack(false);
    }
  }

  async function handleClearSession() {
    setShowClearConfirm(false);
    try {
      await tauriCommands.clearSession();
      dispatch({ type: "CLEAR_SESSION" });
      uiDispatch({ type: "RESTORE_UI", workingTimezone: "America/Los_Angeles", gridColumns: 5, mapPanelHeight: 200 });
    } catch (err) {
      setRollbackError(String(err));
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
          {import.meta.env.DEV && devEntries.length > 0 && (() => {
            const latest = devEntries[devEntries.length - 1];
            return (
              <button
                className={`${styles.devNotification} ${styles[latest.level]}`}
                onClick={openDevLog}
                title={`${devEntries.length} dev log ${devEntries.length === 1 ? "entry" : "entries"}`}
              >
                {latest.level === "error" ? "✕" : "⚠"}
              </button>
            );
          })()}
        </div>
        <div className={styles.controls}>
          <button
            className="btn btn-primary"
            disabled={!hasPending || busy}
            onClick={handleApply}
          >
            Apply
          </button>
          <div className={styles.undoWrapper} ref={undoRef}>
            <button
              className="btn btn-glass"
              disabled={(!canRollback && !hasPhotos && !canUndoEdit) || busy || isRollingBack}
              onClick={() => setShowUndoMenu((v) => !v)}
            >
              Undo ▾
            </button>
            {showUndoMenu && (
              <div className={styles.undoDropdown}>
                <button
                  className={styles.undoItem}
                  disabled={!canUndoEdit || busy}
                  onClick={() => { setShowUndoMenu(false); dispatch({ type: "UNDO_LAST_EDIT" }); }}
                >
                  <span className={styles.undoItemTitle}>Undo Last Edit</span>
                  <span className={styles.undoItemDesc}>
                    Revert the last metadata edit. Does not write changes to disk.
                  </span>
                </button>
                <div className={styles.undoDivider} />
                <button
                  className={styles.undoItem}
                  disabled={!canRollback || isRollingBack}
                  onClick={() => { setShowUndoMenu(false); handleRollback(); }}
                >
                  <span className={styles.undoItemTitle}>
                    {isRollingBack ? "Rolling Back…" : "Roll Back"}
                  </span>
                  <span className={styles.undoItemDesc}>
                    Reset metadata for all photos to state at prior Apply. Changes written to disk.
                  </span>
                </button>
                <div className={styles.undoDivider} />
                <button
                  className={styles.undoItem}
                  disabled={!hasPhotos}
                  onClick={() => { setShowUndoMenu(false); setShowResetConfirm(true); }}
                >
                  <span className={styles.undoItemTitle}>
                    Reset {hasSelected ? "Selected" : "All"}
                  </span>
                  <span className={styles.undoItemDesc}>
                    {hasSelected ? "Selected" : "All"} photos will be reset to the metadata present at import. No changes written to disk.
                  </span>
                </button>
              </div>
            )}
          </div>
          <button
            className="btn btn-glass"
            disabled={photos.length === 0 && gpxFiles.length === 0}
            onClick={() => setShowClearConfirm(true)}
          >
            Clear Session
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

      {showClearConfirm && (
        <ConfirmDialog
          title="Clear Session?"
          message="This will remove all imported photos, GPX files, and pending changes. Photos already written to disk via Apply are not affected."
          confirmLabel="Clear Session"
          destructive
          onConfirm={handleClearSession}
          onCancel={() => setShowClearConfirm(false)}
        />
      )}
    </>
  );
}
