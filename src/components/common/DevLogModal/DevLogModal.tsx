import { useDevLog } from "../../../state/DevLogContext";
import styles from "./DevLogModal.module.css";

export function DevLogModal() {
  const { entries, isOpen, close, clear } = useDevLog();

  if (!import.meta.env.DEV || !isOpen) return null;

  return (
    <div className={styles.backdrop} onClick={close}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title}>Dev Log</span>
          <div className={styles.headerActions}>
            <button className="btn" onClick={clear}>Clear</button>
            <button className="btn" onClick={close}>Close</button>
          </div>
        </div>
        <div className={styles.entries}>
          {entries.length === 0 ? (
            <p className={styles.empty}>No warnings or errors.</p>
          ) : (
            [...entries].reverse().map((entry, i) => (
              <div key={i} className={`${styles.entry} ${styles[entry.level]}`}>
                <span className={styles.icon}>{entry.level === "warn" ? "⚠" : "✕"}</span>
                <span className={styles.message}>{entry.message}</span>
                <span className={styles.time}>{new Date(entry.timestamp).toLocaleTimeString()}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
