import { useEffect, useRef } from "react";
import { useSession } from "../../../state/SessionContext";
import { useUI } from "../../../state/UIContext";
import { PhotoTile } from "./PhotoTile";
import styles from "./PhotoGrid.module.css";

// Must match gap: var(--space-2) = 8px in layout.css .photo-grid
const GRID_GAP_PX = 8;

export function PhotoGrid() {
  const { state: session } = useSession();
  const { state: ui, dispatch } = useUI();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    dispatch({ type: "SET_PANEL_WIDTH", width: el.offsetWidth });
    const observer = new ResizeObserver((entries) => {
      dispatch({ type: "SET_PANEL_WIDTH", width: entries[0].contentRect.width });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [dispatch]);

  const tilePx = Math.max(200, Math.floor((ui.panelWidth - (ui.gridColumns - 1) * GRID_GAP_PX) / ui.gridColumns));

  return (
    <div ref={containerRef} className={styles.container}>
      {session.photos.length === 0 ? (
        <div className={styles.empty}>
          <span>No photos imported</span>
          <span className="text-xs">Click "Import Photos" to get started</span>
        </div>
      ) : (
        <div
          className="photo-grid"
          style={{ ["--tile-size" as string]: `${tilePx}px` }}
        >
          {session.photos.map((photo) => (
            <PhotoTile key={photo.id} photo={photo} tilePx={tilePx} />
          ))}
        </div>
      )}
    </div>
  );
}
