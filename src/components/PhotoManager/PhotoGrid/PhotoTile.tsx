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
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}

export function PhotoTile({
  photo,
  tilePx,
  isSelected,
  isDragging,
  dropZone,
  onClick,
  draggable,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: Props) {
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
      className={tileClass}
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {photo.fileStatus === "missing" ? (
        <div className={styles.missing}>
          <span className="text-lg">?</span>
          <span className="text-xs">File not found</span>
        </div>
      ) : (
        <img src={src} className={styles.img} loading="lazy" draggable={false} />
      )}
      {photo.pendingChanges && <span className={styles.pendingDot} />}
      {isSelected && <div className={styles.selectedOverlay} />}
      {isSelected && <span className={styles.checkmark}>✓</span>}
      {dropZone === "on-photo" && <div className={styles.dropOverlay} />}
      {dropZone === "gap-before" && <GapDropZone side="left" />}
      {dropZone === "gap-after" && <GapDropZone side="right" />}
    </div>
  );
}
