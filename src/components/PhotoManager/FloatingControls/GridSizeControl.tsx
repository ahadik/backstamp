import { useUI } from "../../../state/UIContext";
import styles from "./GridSizeControl.module.css";

const GRID_GAP_PX = 8;

export function GridSizeControl() {
  const { state: ui, dispatch } = useUI();

  const nextLarger = ui.gridColumns - 1;
  const nextSmaller = ui.gridColumns + 1;
  const nextSmallerTilePx = Math.floor(
    (ui.panelWidth - (nextSmaller - 1) * GRID_GAP_PX) / nextSmaller
  );

  const canGrow = ui.gridColumns > 2;
  const canShrink = nextSmallerTilePx >= 200;

  return (
    <div className={styles.control}>
      <button
        className={styles.btn}
        onClick={() => dispatch({ type: "SET_GRID_COLUMNS", columns: nextSmaller })}
        disabled={!canShrink}
        aria-label="Smaller tiles"
      >
        −
      </button>
      <button
        className={styles.btn}
        onClick={() => dispatch({ type: "SET_GRID_COLUMNS", columns: nextLarger })}
        disabled={!canGrow}
        aria-label="Larger tiles"
      >
        +
      </button>
    </div>
  );
}
