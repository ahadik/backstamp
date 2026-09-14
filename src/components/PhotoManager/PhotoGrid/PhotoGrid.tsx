import { useEffect, useRef, useState, useCallback } from "react";
import { useSession } from "../../../state/SessionContext";
import { useUI } from "../../../state/UIContext";
import {
  groupPhotosByDay,
  flatOrderedIds,
  filterPhotos,
  hasActiveFilters,
} from "../../../state/selectors";
import { useDragDrop } from "../../../hooks/useDragDrop";
import {
  computeInheritance,
  parseDropSettings,
  DEFAULT_DROP_SETTINGS,
  type DropSettings,
} from "../../../hooks/useMetadataInheritance";
import { tauriCommands } from "../../../lib/tauri";
import { reportError } from "../../../lib/errors";
import { commitInspectorEdits } from "../../../lib/inspectorUtils";
import { DropSettingsDialog, type PendingDrop } from "../../common/DropSettingsDialog/DropSettingsDialog";
import { DayBlockHeader } from "./DayBlockHeader";
import { GpxTile } from "./GpxTile";
import { PhotoTile } from "./PhotoTile";
import styles from "./PhotoGrid.module.css";
import type { DropTarget, DropModifiers } from "../../../hooks/useDragDrop";

const GRID_GAP_PX = 8;

export function PhotoGrid() {
  const { state: session, dispatch } = useSession();
  const { state: ui, dispatch: uiDispatch } = useUI();
  const containerRef = useRef<HTMLDivElement>(null);
  const gpxSectionRef = useRef<HTMLDivElement>(null);
  const inspectorFocusedAtMouseDown = useRef(false);
  const [lastClickedId, setLastClickedId] = useState<string | null>(null);
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null);

  // Remembered per-drop-kind dialog choices, restored from the session settings
  // table. Loaded lazily; until then ⌘-drops use the defaults (= old behavior).
  const cloneSettingsRef = useRef<DropSettings>(DEFAULT_DROP_SETTINGS);
  const gapSettingsRef = useRef<DropSettings>(DEFAULT_DROP_SETTINGS);

  useEffect(() => {
    // A missing or unreadable preference silently falls back to defaults.
    tauriCommands.getSetting("ui.dropSettings.clone")
      .then((raw) => { cloneSettingsRef.current = parseDropSettings(raw); })
      .catch(() => {});
    tauriCommands.getSetting("ui.dropSettings.gap")
      .then((raw) => { gapSettingsRef.current = parseDropSettings(raw); })
      .catch(() => {});
  }, []);

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

  const filtersActive = hasActiveFilters(ui.photoFilters);
  const visiblePhotos = filterPhotos(session.photos, ui.photoFilters, ui.workingTimezone);
  const blocks = groupPhotosByDay(visiblePhotos, ui.workingTimezone);
  // Visible ids drive drop targets, shift-select ranges, and ⌘A.
  const orderedIds = flatOrderedIds(blocks);
  // Reordering splices into the full order so photos hidden by a filter keep
  // their positions instead of being dropped from the session.
  const allOrderedIds = filtersActive
    ? flatOrderedIds(groupPhotosByDay(session.photos, ui.workingTimezone))
    : orderedIds;

  const photoById = useCallback(
    (id: string) => session.photos.find((p) => p.id === id) ?? null,
    [session.photos]
  );

  // Commits a drop: writes the inherited metadata and reorders the grid.
  // Nothing is persisted before this runs, so a cancelled dialog is a no-op.
  const applyDrop = useCallback(
    (drop: PendingDrop, settings: DropSettings) => {
      const { draggingIds, target } = drop;
      const changes = computeInheritance(
        drop.draggingPhotos,
        target,
        drop.targetPhoto,
        drop.neighborBefore,
        drop.neighborAfter,
        settings,
      );

      const batchUpdates: Array<{ id: string; changes: Partial<import("../../../state/SessionContext").Metadata> }> = [];
      for (const [id, meta] of changes) {
        batchUpdates.push({ id, changes: meta });
        const fields = Object.entries(meta).map(([field, value]) => ({
          field,
          value: value == null ? null : String(value),
        }));
        tauriCommands.setPendingChanges([id], fields)
          .catch((err) => reportError("Failed to save photo edits", err));
      }
      if (batchUpdates.length > 0) {
        dispatch({ type: "SET_PENDING_BATCH", updates: batchUpdates });
      }

      const withoutDragging = allOrderedIds.filter((id) => !draggingIds.includes(id));
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
        .catch((err) => reportError("Failed to save the new photo order", err));
    },
    [allOrderedIds, dispatch]
  );

  const handleDrop = useCallback(
    (draggingIds: string[], target: DropTarget, modifiers: DropModifiers) => {
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

      const drop: PendingDrop = {
        draggingIds,
        draggingPhotos,
        target,
        targetPhoto,
        neighborBefore,
        neighborAfter,
      };

      // No Date drops only clear date/time — nothing to configure, no dialog.
      const isNoDate = target.kind === "gap" && target.gap.dayKey === "no-date";
      if (isNoDate || modifiers.metaKey) {
        const remembered =
          target.kind === "photo" ? cloneSettingsRef.current : gapSettingsRef.current;
        applyDrop(drop, remembered);
        return;
      }

      setPendingDrop(drop);
    },
    [photoById, applyDrop]
  );

  const handleSelectSingle = useCallback(
    (id: string) => {
      commitInspectorEdits();
      dispatch({ type: "SELECT_SINGLE", id });
    },
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
    // Save any half-typed inspector edit against the outgoing selection first.
    commitInspectorEdits();
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

  const hasGpxSelection = session.selectedGpxIds.size > 0;
  useEffect(() => {
    if (hasGpxSelection && gpxSectionRef.current) {
      gpxSectionRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [hasGpxSelection]);


  // ⌘A selects what's on screen, so an active filter never selects hidden photos.
  const orderedIdsRef = useRef(orderedIds);
  orderedIdsRef.current = orderedIds;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Inside an inspector field ⌘A means "select all text", like Escape
      // there means "close this control" rather than "deselect photos".
      if (inspectorHasFocus()) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "a") {
        e.preventDefault();
        dispatch({ type: "SELECT_ALL", ids: orderedIdsRef.current });
      } else if (e.key === "Escape") {
        dispatch({ type: "DESELECT_ALL" });
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);

  // Drop photos a filter just hid from the selection — otherwise inspector
  // edits would keep applying to photos the user can no longer see.
  useEffect(() => {
    if (!filtersActive) return;
    const visible = new Set(visiblePhotos.map((p) => p.id));
    const kept = [...session.selectedIds].filter((id) => visible.has(id));
    if (kept.length !== session.selectedIds.size) {
      dispatch({ type: "SELECT_ALL", ids: kept });
    }
  }, [filtersActive, visiblePhotos, session.selectedIds, dispatch]);

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
      {pendingDrop && (
        <DropSettingsDialog
          drop={pendingDrop}
          initialSettings={
            pendingDrop.target.kind === "photo"
              ? cloneSettingsRef.current
              : gapSettingsRef.current
          }
          onResolve={(settings) => {
            setPendingDrop(null);
            if (!settings) return; // cancelled — the drop never happened
            const kind = pendingDrop.target.kind === "photo" ? "clone" : "gap";
            const ref = kind === "clone" ? cloneSettingsRef : gapSettingsRef;
            ref.current = settings;
            tauriCommands
              .setSetting(`ui.dropSettings.${kind}`, JSON.stringify(settings))
              .catch((err) => reportError("Failed to save the drop preferences", err));
            applyDrop(pendingDrop, settings);
          }}
        />
      )}
      {session.photos.length === 0 ? (
        <div className={styles.empty}>
          <span>No photos imported</span>
          <span className="text-xs">Click "Import Photos" to get started</span>
        </div>
      ) : visiblePhotos.length === 0 ? (
        <div className={styles.empty}>
          <span>No photos match the current filters</span>
          <span className="text-xs">Adjust or clear the filters in the top bar</span>
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
                    isSelected={session.selectedGpxIds.has(gpx.id)}
                    onSelect={(id, e) => {
                      commitInspectorEdits();
                      dispatch({
                        type: "SELECT_GPX",
                        id,
                        mode: e.shiftKey ? "shift" : e.metaKey || e.ctrlKey ? "cmd" : "single",
                      });
                    }}

                    onRemove={(id) => {
                      tauriCommands.removeGpx(id)
                        .catch((err) => reportError("Failed to remove the GPX file", err));
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
