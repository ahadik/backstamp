import styles from "./MapPanel.module.css";

export function MapPanel() {
  return (
    <div className={styles.mapPanel}>
      <div className={styles.dragHandle} />
      <span className={styles.placeholder}>Map</span>
    </div>
  );
}
