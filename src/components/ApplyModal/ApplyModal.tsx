import { useEffect } from "react";
import styles from "./ApplyModal.module.css";

export interface ApplyError {
  photoId: string;
  filePath: string;
  error: string;
}

export type ApplyPhase =
  | { type: "idle" }
  | { type: "applying"; done: number; total: number; errors: ApplyError[] }
  | { type: "undoing"; done: number; total: number }
  | { type: "complete"; errors: ApplyError[] }
  | { type: "cancelled" };

interface ApplyModalProps {
  phase: ApplyPhase;
  onCancel: () => void;
  onDismiss: () => void;
}

export function ApplyModal({ phase, onCancel, onDismiss }: ApplyModalProps) {
  // Auto-dismiss after 1.5s when complete with no errors
  useEffect(() => {
    if (phase.type === "complete" && phase.errors.length === 0) {
      const id = setTimeout(onDismiss, 1500);
      return () => clearTimeout(id);
    }
  }, [phase, onDismiss]);

  if (phase.type === "idle") return null;

  const renderProgress = () => {
    if (phase.type === "applying" || phase.type === "undoing") {
      const pct =
        phase.total > 0 ? Math.round((phase.done / phase.total) * 100) : 0;
      return (
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
        </div>
      );
    }
    if (phase.type === "complete") {
      const pct =
        phase.errors.length === 0
          ? 100
          : 0; // partial shown via error list
      return (
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
        </div>
      );
    }
    return null;
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        {phase.type === "applying" && (
          <>
            <h3 className={styles.title}>
              Writing {phase.done} of {phase.total} photos…
            </h3>
            {renderProgress()}
            <div className={styles.actions}>
              <button className="btn btn-glass" onClick={onCancel}>
                Cancel
              </button>
            </div>
          </>
        )}

        {phase.type === "undoing" && (
          <>
            <h3 className={styles.title}>
              Undoing {phase.done} of {phase.total} photos… (cannot cancel)
            </h3>
            {renderProgress()}
          </>
        )}

        {phase.type === "complete" && phase.errors.length === 0 && (
          <>
            <h3 className={styles.title}>All photos written successfully.</h3>
            {renderProgress()}
            <div className={styles.actions}>
              <button className="btn btn-primary" onClick={onDismiss}>
                Dismiss
              </button>
            </div>
          </>
        )}

        {phase.type === "complete" && phase.errors.length > 0 && (
          <>
            <h3 className={styles.title}>
              {phase.errors.length} file(s) could not be written.
            </h3>
            <ul className={styles.errorList}>
              {phase.errors.map((e) => (
                <li key={e.photoId} className={styles.errorItem}>
                  <span className={`text-sm ${styles.filePath}`}>
                    {e.filePath || e.photoId}
                  </span>
                  <span className={`text-xs ${styles.errorMsg}`}>{e.error}</span>
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              <button className="btn btn-primary" onClick={onDismiss}>
                Dismiss
              </button>
            </div>
          </>
        )}

        {phase.type === "cancelled" && (
          <>
            <h3 className={styles.title}>Changes cancelled.</h3>
            <div className={styles.actions}>
              <button className="btn btn-glass" onClick={onDismiss}>
                Dismiss
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
