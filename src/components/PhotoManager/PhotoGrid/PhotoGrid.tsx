import { useEffect, useRef, useState } from "react";
import { useSession } from "../../../state/SessionContext";
import { useUI } from "../../../state/UIContext";
import { PhotoTile } from "./PhotoTile";
import styles from "./PhotoGrid.module.css";

export function PhotoGrid() {
  const { state: session } = useSession();
  const { state: ui } = useUI();
  const containerRef = useRef<HTMLDivElement>(null);
  const [panelWidth, setPanelWidth] = useState(800);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setPanelWidth(el.offsetWidth);
    const observer = new ResizeObserver((entries) => {
      setPanelWidth(entries[0].contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const tilePx = Math.max(60, Math.round(ui.gridTileSize * panelWidth));

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
