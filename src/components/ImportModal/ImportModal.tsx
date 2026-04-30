import { useEffect } from "react";
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
  // When isComplete is not provided, fall back to done >= total (keeps existing tests passing)
  const complete = isComplete ?? (total > 0 && done >= total);

  useEffect(() => {
    if (complete && errors.length === 0) {
      const t = setTimeout(onDismiss, 600);
      return () => clearTimeout(t);
    }
  }, [complete, errors.length, onDismiss]);

  if (!isOpen) return null;

  return (
    <div className={styles.overlay}>
      <div className={`inspector-card ${styles.panel}`}>
        <p className="text-lg font-medium" style={{ marginBottom: "var(--space-4)" }}>
          Importing Photos
        </p>

        <div className={styles.track}>
          <div className={styles.bar} style={{ width: `${pct}%` }} />
        </div>

        <p className="text-sm" style={{ color: "var(--color-text-secondary)", marginTop: "var(--space-2)" }}>
          {done} of {total}
        </p>

        {complete && skipped > 0 && (
          <p className="text-sm" style={{ color: "var(--color-text-secondary)", marginTop: "var(--space-1)" }}>
            {skipped} duplicate{skipped !== 1 ? "s" : ""} skipped
          </p>
        )}

        {errors.length > 0 && (
          <ul className={styles.errors}>
            {errors.map((err, i) => (
              <li key={i} className="text-xs" style={{ color: "var(--color-danger)" }}>
                {err}
              </li>
            ))}
          </ul>
        )}

        {complete && errors.length > 0 && (
          <button
            className="btn btn-glass"
            style={{ marginTop: "var(--space-4)" }}
            onClick={onDismiss}
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}
