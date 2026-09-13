import styles from "./DropImportOverlay.module.css";

interface Props {
  isVisible: boolean;
  label: string;
}

export function DropImportOverlay({ isVisible, label }: Props) {
  if (!isVisible) return null;
  return (
    <div className={styles.overlay}>
      <span className={styles.label}>{label}</span>
    </div>
  );
}
