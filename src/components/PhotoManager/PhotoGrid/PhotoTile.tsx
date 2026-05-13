import { useSession } from "../../../state/SessionContext";
import { tauriCommands } from "../../../lib/tauri";
import type { Photo } from "../../../state/SessionContext";
import type { DropZone } from "../../../hooks/useDragDrop";
import { GapDropZone } from "./GapDropZone";
import styles from "./PhotoTile.module.css";

interface Props {
  photo: Photo;
  tilePx: number;
  isSelected: boolean;
  isDragging: boolean;
  dropZone: DropZone | null;
  onClick: (e: React.MouseEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

export function PhotoTile({
  photo,
  tilePx,
  isSelected,
  isDragging,
  dropZone,
  onClick,
  onMouseDown,
  onContextMenu,
}: Props) {
  const { dispatch } = useSession();
  const src = tilePx > 400 ? photo.thumbnail.large : photo.thumbnail.small;

  const tileClass = [
    styles.tile,
    isSelected ? styles.selected : "",
    isDragging ? styles.dragging : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      data-photo-id={photo.id}
      className={tileClass}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
    >
      <div className={styles.content}>
        {photo.fileStatus === "missing" ? (
          <div className={styles.missing}>
            <span className="text-lg">?</span>
            <span className="text-xs">File not found</span>
            <div className={styles.missingOverlay}>
              <button
                className={styles.missingRemoveBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: "REMOVE_PHOTOS", ids: [photo.id] });
                  tauriCommands.removePhotos([photo.id]).catch(console.error);
                }}
                title="Remove from session"
              >
                ✕
              </button>
            </div>
          </div>
        ) : (
          <img src={src} className={styles.img} loading="lazy" draggable={false} />
        )}
        {photo.currentMetadata.gpsLat != null && photo.currentMetadata.gpsLng != null && (
          <span className={styles.locationPin}>📍</span>
        )}
        {photo.pendingChanges && <span className={styles.pendingDot} />}
        {isSelected && <div className={styles.selectedOverlay} />}
        {isSelected && <span className={styles.checkmark}>✓</span>}
        {dropZone === "on-photo" && <div className={styles.dropOverlay} />}
      </div>
      {dropZone === "gap-before" && <GapDropZone side="left" />}
      {dropZone === "gap-after" && <GapDropZone side="right" />}
    </div>
  );
}
