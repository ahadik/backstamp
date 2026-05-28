import { useEffect, useRef } from "react";
import { Modal } from "../common/Modal/Modal";
import styles from "./ImportModal.module.css";

interface Props {
  isOpen: boolean;
  done: number;
  total: number;
  skipped?: number;
  isComplete?: boolean;
  errors: string[];
  onDismiss: () => void;
}

export function ImportModal({
  isOpen,
  done,
  total,
  skipped = 0,
  isComplete,
  errors,
  onDismiss,
}: Props) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const complete = isComplete ?? (total > 0 && done >= total);
  const logRef = useRef<HTMLPreElement>(null);

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
        <p className={styles.title}>Importing Photos</p>

        <div className={styles.track}>
          <div className={styles.bar} style={{ width: `${pct}%` }} />
        </div>

        <p className={styles.counter}>
          {done} of {total}
          {complete && skipped > 0 && ` · ${skipped} duplicate${skipped !== 1 ? "s" : ""} skipped`}
          {errors.length > 0 && ` · ${errors.length} error${errors.length !== 1 ? "s" : ""}`}
        </p>

        {errors.length > 0 && (
          <pre ref={logRef} className={styles.errorLog}>
            {errors.join("\n")}
          </pre>
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
