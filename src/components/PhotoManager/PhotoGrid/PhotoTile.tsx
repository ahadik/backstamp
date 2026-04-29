import type { Photo } from "../../../state/SessionContext";
import styles from "./PhotoTile.module.css";

interface Props {
  photo: Photo;
  tilePx: number;
}

export function PhotoTile({ photo, tilePx }: Props) {
  const src = tilePx > 400 ? photo.thumbnail.large : photo.thumbnail.small;

  return (
    <div className={styles.tile} style={{ width: tilePx, height: tilePx }}>
      {photo.fileStatus === "missing" ? (
        <div className={styles.missing}>
          <span className="text-lg" style={{ color: "var(--color-text-secondary)" }}>?</span>
          <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
            File not found
          </span>
        </div>
      ) : (
        <img src={src} className={styles.img} loading="lazy" draggable={false} />
      )}
      {photo.pendingChanges && <span className={styles.pendingDot} />}
    </div>
  );
}
