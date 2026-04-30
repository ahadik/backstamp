import { open } from "@tauri-apps/plugin-dialog";
import { tauriCommands } from "../../../lib/tauri";
import { useUI } from "../../../state/UIContext";
import { useSession } from "../../../state/SessionContext";
import styles from "./FloatingControls.module.css";

const SUPPORTED_EXTENSIONS = [
  "jpg", "jpeg", "tif", "tiff", "heic",
  "dng", "cr3", "cr2", "nef", "arw", "raf", "orf", "rw2", "pef",
];

export function FloatingControls() {
  const { state: ui, dispatch } = useUI();
  const { state, dispatch: sessionDispatch } = useSession();
  const { photos, selectedIds } = state;

  async function handleImportPhotos() {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Photos", extensions: SUPPORTED_EXTENSIONS }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length === 0) return;
    tauriCommands.importPhotos(paths).catch((e) => console.error("[importPhotos] error:", e));
  }

  async function handleRemove() {
    const ids =
      selectedIds.size > 0
        ? Array.from(selectedIds)
        : photos.map((p) => p.id);
    if (ids.length === 0) return;
    await tauriCommands.removePhotos(ids).catch((e) =>
      console.error("[removePhotos] error:", e),
    );
    sessionDispatch({ type: "REMOVE_PHOTOS", ids });
  }

  // Must match GRID_GAP_PX in PhotoGrid.tsx and gap: var(--space-2) in layout.css
  const GRID_GAP_PX = 8;
  const canIncrease = ui.gridColumns > 1;
  const nextDecreaseColumns = ui.gridColumns + 1;
  const nextDecreaseTilePx = Math.floor((ui.panelWidth - (nextDecreaseColumns - 1) * GRID_GAP_PX) / nextDecreaseColumns);
  const canDecrease = nextDecreaseTilePx >= 200;

  function increaseGrid() {
    dispatch({ type: "SET_GRID_COLUMNS", columns: ui.gridColumns - 1 });
  }

  function decreaseGrid() {
    dispatch({ type: "SET_GRID_COLUMNS", columns: ui.gridColumns + 1 });
  }

  const removeLabel =
    selectedIds.size > 0 ? "Remove Selected Photos" : "Remove All Photos";

  return (
    <div className={styles.floatingControls}>
      <div className={styles.leftGroup}>
        <button className="btn btn-glass" onClick={handleImportPhotos}>
          Import Photos
        </button>
        <button
          className="btn btn-glass"
          onClick={handleRemove}
          disabled={photos.length === 0}
        >
          {removeLabel}
        </button>
      </div>
      <div className={styles.rightGroup}>
        <select
          className={styles.tzSelect}
          value={ui.workingTimezone}
          onChange={(e) =>
            dispatch({ type: "SET_WORKING_TIMEZONE", timezone: e.target.value })
          }
        >
          <option value="America/Los_Angeles">US Pacific</option>
          <option value="America/New_York">US Eastern</option>
          <option value="America/Chicago">US Central</option>
          <option value="America/Denver">US Mountain</option>
          <option value="Europe/London">London</option>
          <option value="Europe/Paris">Paris</option>
          <option value="Asia/Tokyo">Tokyo</option>
        </select>
        <div className={styles.gridSizeControl}>
          <button className="btn btn-glass" onClick={decreaseGrid} disabled={!canDecrease} aria-label="Decrease grid size">–</button>
          <button className="btn btn-glass" onClick={increaseGrid} disabled={!canIncrease} aria-label="Increase grid size">+</button>
        </div>
      </div>
    </div>
  );
}
