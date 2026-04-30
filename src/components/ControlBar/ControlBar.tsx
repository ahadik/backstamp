import { useSession } from "../../state/SessionContext";
import styles from "./ControlBar.module.css";

export function ControlBar() {
  const { state } = useSession();
  const { photos, selectedIds } = state;

  const hasSelection = selectedIds.size > 0;
  const resetLabel = hasSelection ? "Reset Selected" : "Reset All";

  return (
    <div className={styles.controlBar}>
      <button className="btn btn-primary" disabled>Apply</button>
      <button className="btn btn-glass" disabled>Roll Back</button>
      <button className="btn btn-glass" disabled>{resetLabel}</button>
    </div>
  );
}
