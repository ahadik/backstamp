import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { GpxFile } from "../../../state/SessionContext";
import styles from "./GpxTile.module.css";

interface Props {
  gpxFile: GpxFile;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}

export function GpxTile({ gpxFile, isSelected, onSelect, onRemove }: Props) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className={`${styles.tile}${isSelected ? ` ${styles.selected}` : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSelect(gpxFile.id)}
    >
      {gpxFile.thumbnailPath ? (
        <img
          className={styles.thumbnail}
          src={convertFileSrc(gpxFile.thumbnailPath)}
          alt="GPX route"
        />
      ) : (
        <div className={styles.placeholder}>
          <span className={styles.routeIcon}>〰</span>
        </div>
      )}
      <div className={styles.label}>
        {gpxFile.filePath.split("/").pop()}
      </div>
      {hovered && (
        <button
          className={styles.removeBtn}
          onClick={(e) => { e.stopPropagation(); onRemove(gpxFile.id); }}
          title="Remove GPX file"
        >
          ✕
        </button>
      )}
    </div>
  );
}
