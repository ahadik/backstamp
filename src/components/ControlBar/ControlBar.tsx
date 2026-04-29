import styles from "./ControlBar.module.css";

export function ControlBar() {
  return (
    <div className={styles.controlBar}>
      <button className="btn btn-primary" disabled>Apply</button>
      <button className="btn btn-glass" disabled>Roll Back</button>
      <button className="btn btn-glass" disabled>Reset All</button>
    </div>
  );
}
