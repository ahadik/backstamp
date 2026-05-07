import { open } from "@tauri-apps/plugin-dialog";
import { tauriCommands } from "../../../lib/tauri";
import { useUI } from "../../../state/UIContext";
import { useSession } from "../../../state/SessionContext";
import { WORKING_TIMEZONES } from "../../../lib/timezones";
import { GridSizeControl } from "./GridSizeControl";
import styles from "./FloatingControls.module.css";

const SUPPORTED_EXTENSIONS = [
  "jpg", "jpeg", "tif", "tiff", "heic",
  "dng", "cr3", "cr2", "nef", "arw", "raf", "orf", "rw2", "pef",
];

export function FloatingControls() {
  const { state: ui, dispatch } = useUI();
  const { state, dispatch: sessionDispatch } = useSession();
  const { selectedIds } = state;

  async function handleImportPhotos() {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Photos", extensions: SUPPORTED_EXTENSIONS }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    if (paths.length === 0) return;
    tauriCommands.importPhotos(paths).catch((err) => console.error("[importPhotos]", err));
  }

  async function handleRemoveSelected() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    await tauriCommands
      .removePhotos(ids)
      .catch((err) => console.error("[removePhotos]", err));
    sessionDispatch({ type: "REMOVE_PHOTOS", ids });
  }

  return (
    <div className={styles.floatingControls}>
      <div className={styles.leftGroup}>
        <button className="btn btn-glass" onClick={handleImportPhotos}>
          Import Photos
        </button>
        <button
          className="btn btn-glass"
          onClick={handleRemoveSelected}
          disabled={selectedIds.size === 0}
        >
          Remove Selected
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
          {WORKING_TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>{tz.label}</option>
          ))}
        </select>
        <GridSizeControl />
      </div>
    </div>
  );
}
