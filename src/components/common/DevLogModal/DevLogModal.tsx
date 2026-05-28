import { useDevLog } from "../../../state/DevLogContext";
import { Modal } from "../Modal/Modal";
import styles from "./DevLogModal.module.css";

export function DevLogModal() {
  const { entries, isOpen, close, clear } = useDevLog();

  if (!import.meta.env.DEV) return null;

  return (
    <Modal isOpen={isOpen} onClose={close}>
      <div className={styles.dialog}>
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
    </Modal>
  );
}
