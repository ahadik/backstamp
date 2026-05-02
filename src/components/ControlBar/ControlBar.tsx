import { useSession } from "../../state/SessionContext";
import styles from "./ControlBar.module.css";

export function ControlBar() {
  const { state } = useSession();
  const { photos, selectedIds } = state;

  const hasPending = photos.some((p) => p.pendingChanges !== null);
  const hasPhotos = photos.length > 0;
  const resetLabel = selectedIds.size > 0 ? "Reset Selected" : "Reset All Photos";

  return (
    <div className={styles.controlBar}>
      <button className="btn btn-primary" disabled={!hasPending}>Apply</button>
      <button className="btn btn-glass" disabled>Roll Back</button>
      <button className="btn btn-glass" disabled={!hasPhotos}>{resetLabel}</button>
    </div>
  );
}
