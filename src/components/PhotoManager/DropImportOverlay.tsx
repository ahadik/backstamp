import styles from "./DropImportOverlay.module.css";

interface Props {
  isVisible: boolean;
}

export function DropImportOverlay({ isVisible }: Props) {
  if (!isVisible) return null;
  return (
    <div className={styles.overlay}>
      <span className={styles.label}>Drop photos to import</span>
    </div>
  );
}
