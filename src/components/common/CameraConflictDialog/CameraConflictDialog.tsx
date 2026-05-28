import type { CameraConflict, CameraData } from "../../../hooks/useMetadataInheritance";
import { Modal } from "../Modal/Modal";
import styles from "./CameraConflictDialog.module.css";

interface CameraConflictDialogProps {
  conflict: CameraConflict;
  onResolve: (choice: CameraData | null) => void;
}

function summarizeCameraData(data: CameraData | null): string {
  if (!data) return "No camera data";
  const parts: string[] = [];
  const cameraStr = [data.cameraMake, data.cameraModel].filter(Boolean).join(" ");
  if (cameraStr) parts.push(cameraStr);
  if (data.lens) parts.push(data.lens);
  const filmStr = [data.filmVendor, data.filmType].filter(Boolean).join(" ");
  if (filmStr) parts.push(filmStr);
  return parts.join(" · ") || "No camera data";
}

export function CameraConflictDialog({ conflict, onResolve }: CameraConflictDialogProps) {
  return (
    <Modal isOpen closeOnBackdrop={false} closeOnEscape={false}>
      <div className={styles.dialog}>
        <h3 className={styles.title}>Which camera details should these photos inherit?</h3>
        <div className={styles.options}>
          <button
            className={styles.option}
            onClick={() => onResolve(conflict.optionBefore)}
          >
            <span className={styles.optionLabel}>Before</span>
            <span className={styles.optionSummary}>{summarizeCameraData(conflict.optionBefore)}</span>
          </button>
          <button
            className={styles.option}
            onClick={() => onResolve(conflict.optionAfter)}
          >
            <span className={styles.optionLabel}>After</span>
            <span className={styles.optionSummary}>{summarizeCameraData(conflict.optionAfter)}</span>
          </button>
        </div>
        <div className={styles.footer}>
          <button className="btn" onClick={() => onResolve(null)}>
            Don't set
          </button>
        </div>
      </div>
    </Modal>
  );
}
