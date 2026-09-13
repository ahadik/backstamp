import { useEffect, useRef } from "react";
import { Modal } from "../common/Modal/Modal";
import styles from "./ImportModal.module.css";

interface Props {
  isOpen: boolean;
  done: number;
  total: number;
  skipped?: number;
  isComplete?: boolean;
  /** Cancel requested; the backend is finishing the in-flight file and cleaning up. */
  isCancelling?: boolean;
  /** Import ended because the user cancelled it. */
  isCancelled?: boolean;
  errors: string[];
  onCancel?: () => void;
  onDismiss: () => void;
}

export function ImportModal({
  isOpen,
  done,
  total,
  skipped = 0,
  isComplete,
  isCancelling = false,
  isCancelled = false,
  errors,
  onCancel,
  onDismiss,
}: Props) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const complete = isComplete ?? (total > 0 && done >= total);
  const logRef = useRef<HTMLPreElement>(null);

  const title = isCancelled
    ? "Import Cancelled"
    : isCancelling
      ? "Cancelling Import…"
      : "Importing Photos";

  useEffect(() => {
    if (complete && errors.length === 0) {
      const t = setTimeout(onDismiss, 600);
      return () => clearTimeout(t);
    }
  }, [complete, errors.length, onDismiss]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [errors.length]);

  return (
    <Modal isOpen={isOpen} closeOnBackdrop={false} closeOnEscape={false}>
      <div className={styles.panel}>
        <p className={styles.title}>{title}</p>

        <div className={styles.track}>
          <div className={styles.bar} style={{ width: `${pct}%` }} />
        </div>

        <p className={styles.counter}>
          {isCancelled ? "Imported photos removed" : `${done} of ${total}`}
          {complete && !isCancelled && skipped > 0 && ` · ${skipped} duplicate${skipped !== 1 ? "s" : ""} skipped`}
          {errors.length > 0 && ` · ${errors.length} error${errors.length !== 1 ? "s" : ""}`}
        </p>

        {errors.length > 0 && (
          <pre ref={logRef} className={styles.errorLog}>
            {errors.join("\n")}
          </pre>
        )}

        {!complete && onCancel && (
          <div className={styles.footer}>
            <button
              className="btn btn-low btn-glass"
              onClick={onCancel}
              disabled={isCancelling}
            >
              {isCancelling ? "Cancelling…" : "Cancel"}
            </button>
          </div>
        )}

        {complete && errors.length > 0 && (
          <div className={styles.footer}>
            <button className="btn btn-glass" onClick={onDismiss}>
              Done
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
