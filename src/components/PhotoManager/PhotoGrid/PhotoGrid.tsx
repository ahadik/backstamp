import { useEffect, useRef, useState, useCallback } from "react";
import { useSession } from "../../../state/SessionContext";
import { useUI } from "../../../state/UIContext";
import { groupPhotosByDay, flatOrderedIds } from "../../../state/selectors";
import { useDragDrop } from "../../../hooks/useDragDrop";
import { computeInheritance } from "../../../hooks/useMetadataInheritance";
import type { CameraConflict } from "../../../hooks/useMetadataInheritance";
import { tauriCommands } from "../../../lib/tauri";
import { CameraConflictDialog } from "../../common/CameraConflictDialog/CameraConflictDialog";
import { DayBlockHeader } from "./DayBlockHeader";
import { GpxTile } from "./GpxTile";
import { PhotoTile } from "./PhotoTile";
import styles from "./PhotoGrid.module.css";
import type { DropTarget } from "../../../hooks/useDragDrop";

const GRID_GAP_PX = 8;

export function PhotoGrid() {
  const { state: session, dispatch } = useSession();
  const { state: ui, dispatch: uiDispatch } = useUI();
  const containerRef = useRef<HTMLDivElement>(null);
  const gpxSectionRef = useRef<HTMLDivElement>(null);
  const inspectorFocusedAtMouseDown = useRef(false);
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [cameraConflict, setCameraConflict] = useState<CameraConflict | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    uiDispatch({ type: "SET_PANEL_WIDTH", width: el.offsetWidth });
    const observer = new ResizeObserver((entries) => {
      uiDispatch({ type: "SET_PANEL_WIDTH", width: entries[0].contentRect.width });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [uiDispatch]);

  const tilePx = Math.max(
    200,
    Math.floor((ui.panelWidth - (ui.gridColumns - 1) * GRID_GAP_PX) / ui.gridColumns)
  );

  const blocks = groupPhotosByDay(session.photos, ui.workingTimezone);
  const orderedIds = flatOrderedIds(blocks);

  const photoById = useCallback(
    (id: string) => session.photos.find((p) => p.id === id) ?? null,
    [session.photos]
  );

  const handleDrop = useCallback(
    (draggingIds: string[], target: DropTarget) => {
      const draggingPhotos = draggingIds.flatMap((id) => {
        const p = photoById(id);
        return p ? [p] : [];
      });

      let targetPhoto = null;
      let neighborBefore = null;
      let neighborAfter = null;

      if (target.kind === "photo") {
        targetPhoto = photoById(target.photoId);
      } else {
        const { gap } = target;
        neighborBefore = gap.beforeId ? photoById(gap.beforeId) : null;
        neighborAfter = gap.afterId ? photoById(gap.afterId) : null;
      }

      const result = computeInheritance(
        draggingPhotos,
        target,
        targetPhoto,
        neighborBefore,
        neighborAfter,
      );

      for (const [id, meta] of result.changes) {
        dispatch({ type: "SET_PENDING", ids: [id], changes: meta });
      }

      const withoutDragging = orderedIds.filter((id) => !draggingIds.includes(id));
      let insertIdx: number;

      if (target.kind === "photo") {
        const targetIdx = withoutDragging.indexOf(target.photoId);
        insertIdx = targetIdx >= 0 ? targetIdx + 1 : withoutDragging.length;
      } else {
        const { gap } = target;
        if (gap.afterId) {
          const afterIdx = withoutDragging.indexOf(gap.afterId);
          insertIdx = afterIdx >= 0 ? afterIdx : withoutDragging.length;
        } else if (gap.beforeId) {
          const beforeIdx = withoutDragging.indexOf(gap.beforeId);
          insertIdx = beforeIdx >= 0 ? beforeIdx + 1 : withoutDragging.length;
        } else {
          insertIdx = withoutDragging.length;
        }
      }

      const newOrder = [
        ...withoutDragging.slice(0, insertIdx),
        ...draggingIds,
        ...withoutDragging.slice(insertIdx),
      ];

      dispatch({ type: "REORDER_PHOTOS", orderedIds: newOrder });
      tauriCommands
        .reorderPhotos(newOrder)
        .catch((err) => console.error("[reorderPhotos]", err));

      if (result.cameraConflict) {
        setCameraConflict(result.cameraConflict);
      }
    },
    [orderedIds, photoById, dispatch]
  );

  const handleSelectSingle = useCallback(
    (id: string) => dispatch({ type: "SELECT_SINGLE", id }),
    [dispatch]
  );

  const { dragState, dragHandlers, dragCompletedRef } = useDragDrop({
    orderedIds,
    selectedIds: session.selectedIds,
    dayBlocks: blocks,
    onDrop: handleDrop,
    onSelectSingle: handleSelectSingle,
  });

  function handleTileClick(photoId: string, e: React.MouseEvent) {
    // mouseup after a drag fires a click event on the source tile — suppress it.
    if (dragCompletedRef.current) {
      dragCompletedRef.current = false;
      return;
    }
    if (e.shiftKey && lastClickedId) {
      dispatch({ type: "SELECT_RANGE", fromId: lastClickedId, toId: photoId, orderedIds });
    } else if (e.metaKey || e.ctrlKey) {
      dispatch({ type: "TOGGLE_SELECT", id: photoId });
    } else {
      dispatch({ type: "SELECT_SINGLE", id: photoId });
    }
    setLastClickedId(photoId);
  }

  function inspectorHasFocus() {
    return !!document.getElementById("inspector-panel")?.contains(document.activeElement);
  }

  useEffect(() => {
    if (session.selectedGpxId && gpxSectionRef.current) {
      gpxSectionRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [session.selectedGpxId]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        dispatch({ type: "SELECT_ALL" });
      } else if (e.key === "Escape") {
        dispatch({ type: "DESELECT_ALL" });
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);

  return (
    <div
      ref={containerRef}
      className={styles.container}
      style={{
        ["--tile-size" as string]: `${tilePx}px`,
        ["--map-panel-height" as string]: `${ui.mapPanelHeight}px`,
      }}
      onMouseDown={() => {
        inspectorFocusedAtMouseDown.current = inspectorHasFocus();
      }}
      onClick={() => {
        if (inspectorFocusedAtMouseDown.current) return;
        dispatch({ type: "DESELECT_ALL" });
      }}
    >
      {cameraConflict && (
        <CameraConflictDialog
          conflict={cameraConflict}
          onResolve={(choice) => {
            if (choice !== null) {
              dispatch({ type: "SET_PENDING", ids: cameraConflict.draggingIds, changes: choice });
            }
            setCameraConflict(null);
          }}
        />
      )}
      {session.photos.length === 0 ? (
        <div className={styles.empty}>
          <span>No photos imported</span>
          <span className="text-xs">Click "Import Photos" to get started</span>
        </div>
      ) : (
        <div className={styles.gridLayer}>
          {blocks.map((block) => (
            <div key={block.dateKey} className={styles.dayBlock}>
              <DayBlockHeader label={block.label} count={block.photos.length} />
              <div className="photo-grid">
                {block.photos.map((photo) => (
                  <PhotoTile
                    key={photo.id}
                    photo={photo}
                    tilePx={tilePx}
                    isSelected={session.selectedIds.has(photo.id)}
                    isDragging={dragState.draggingIds.includes(photo.id)}
                    dropZone={
                      dragState.overTileId === photo.id ? dragState.overZone : null
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTileClick(photo.id, e);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      tauriCommands.showPhotoContextMenu(
                        photo.filePath,
                        photo.fileStatus === "missing"
                      );
                    }}
                    {...dragHandlers(photo.id)}
                  />
                ))}
              </div>
            </div>
          ))}
          {session.gpxFiles.length > 0 && (
            <div ref={gpxSectionRef} className={styles.gpxSection}>
              <div className={styles.gpxSectionLabel}>GPX Files</div>
              <div className={styles.gpxTiles}>
                {session.gpxFiles.map((gpx) => (
                  <GpxTile
                    key={gpx.id}
                    gpxFile={gpx}
                    isSelected={session.selectedGpxId === gpx.id}
                    onSelect={(id) => dispatch({ type: "SELECT_GPX", id })}
                    onRemove={(id) => {
                      tauriCommands.removeGpx(id).catch(console.error);
                      dispatch({ type: "REMOVE_GPX", id });
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
