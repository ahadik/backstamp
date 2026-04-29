import { open } from "@tauri-apps/plugin-dialog";
import styles from "./SubBar.module.css";

const SUPPORTED_EXTENSIONS = [
  "jpg", "jpeg", "tif", "tiff", "heic",
  "dng", "cr3", "cr2", "nef", "arw", "raf", "orf", "rw2", "pef",
];

async function handleSelectPhotos() {
  const selected = await open({
    multiple: true,
    filters: [{ name: "Photos", extensions: SUPPORTED_EXTENSIONS }],
  });
  if (!selected) return;
  const paths = Array.isArray(selected) ? selected : [selected];
  console.log("Selected paths:", paths);
}

export function SubBar() {
  return (
    <div className={styles.subBar}>
      <button className="btn btn-ghost" onClick={handleSelectPhotos}>Select Photos</button>
      <button className="btn btn-ghost" disabled>Remove Selected Photos</button>
      <div className={styles.spacer} />
      <span className={styles.sliderLabel}>Grid Size</span>
      <input
        type="range"
        min={0}
        max={100}
        defaultValue={30}
        className={styles.gridSlider}
        readOnly
      />
      <select className={styles.tzSelect} defaultValue="America/Los_Angeles">
        <option value="America/Los_Angeles">US Pacific</option>
      </select>
    </div>
  );
}
