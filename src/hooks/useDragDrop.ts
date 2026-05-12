import { useState, useRef, useCallback, useEffect } from "react";
import type { DayBlock } from "../state/selectors";

export type DropZone = "gap-before" | "on-photo" | "gap-after";

export interface GapTarget {
  beforeId: string | null;
  afterId: string | null;
  dayKey: string;
}

export type DropTarget =
  | { kind: "photo"; photoId: string }
  | { kind: "gap"; gap: GapTarget };

export interface DragState {
  draggingIds: string[];
  overTileId: string | null;
  overZone: DropZone | null;
}

interface Params {
  orderedIds: string[];
  selectedIds: Set<string>;
  dayBlocks: DayBlock[];
  onDrop: (draggingIds: string[], target: DropTarget) => void;
  onSelectSingle: (id: string) => void;
}

export function useDragDrop({
  orderedIds,
  selectedIds,
  dayBlocks,
  onDrop,
  onSelectSingle,
}: Params) {
  const [dragState, setDragState] = useState<DragState>({
    draggingIds: [],
    overTileId: null,
    overZone: null,
  });

  const draggingIdsRef = useRef<string[]>([]);
  const overDropRef = useRef<{ tileId: string; zone: DropZone } | null>(null);
  const isDraggingRef = useRef(false);
  const ghostRef = useRef<HTMLElement | null>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const pendingDragRef = useRef<{
    photoId: string;
    startX: number;
    startY: number;
    ids: string[];
  } | null>(null);

  // After a drag completes, the click event still fires on the source tile.
  // This ref lets handleTileClick in PhotoGrid suppress that spurious click.
  const dragCompletedRef = useRef(false);

  // Stable refs to callbacks that change across renders, for use in the
  // document-level effect which has no deps array.
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  const onSelectSingleRef = useRef(onSelectSingle);
  onSelectSingleRef.current = onSelectSingle;

  const findDayKey = useCallback(
    (photoId: string): string => {
      for (const block of dayBlocks) {
        if (block.photos.some((p) => p.id === photoId)) return block.dateKey;
      }
      return "no-date";
    },
    [dayBlocks]
  );

  const buildGapTarget = useCallback(
    (tileId: string, zone: "gap-before" | "gap-after"): GapTarget => {
      const idx = orderedIds.indexOf(tileId);
      const dayKey = findDayKey(tileId);
      if (zone === "gap-before") {
        return {
          beforeId: idx > 0 ? orderedIds[idx - 1] : null,
          afterId: tileId,
          dayKey,
        };
      }
      return {
        beforeId: tileId,
        afterId: idx < orderedIds.length - 1 ? orderedIds[idx + 1] : null,
        dayKey,
      };
    },
    [orderedIds, findDayKey]
  );

  const buildGapTargetRef = useRef(buildGapTarget);
  buildGapTargetRef.current = buildGapTarget;

  // Finds the tile under a CSS-pixel coordinate and updates hover drop state.
  // pointer-events: none on the ghost means elementFromPoint sees through it.
  const updateOverTileFromPoint = useCallback((cssX: number, cssY: number) => {
    if (draggingIdsRef.current.length === 0) return;
    let el = document.elementFromPoint(cssX, cssY) as HTMLElement | null;
    while (el && !el.dataset.photoId) {
      el = el.parentElement;
    }
    if (!el || !el.dataset.photoId) {
      overDropRef.current = null;
      setDragState((s) => ({ ...s, overTileId: null, overZone: null }));
      return;
    }
    const tileId = el.dataset.photoId;
    const rect = el.getBoundingClientRect();
    const relX = (cssX - rect.left) / rect.width;
    const zone: DropZone = relX < 0.2 ? "gap-before" : relX > 0.8 ? "gap-after" : "on-photo";
    overDropRef.current = { tileId, zone };
    setDragState((s) => ({ ...s, overTileId: tileId, overZone: zone }));
  }, []); // stable: only refs + stable setState

  // Document-level mouse handlers drive the entire drag lifecycle.
  // We use mouse events instead of the HTML5 drag API because dragDropEnabled: true
  // causes WKWebView to treat draggable="true" elements as OS window drags.
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const pending = pendingDragRef.current;

      if (pending && !isDraggingRef.current) {
        const dist = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY);
        if (dist < 5) return;

        // Threshold exceeded — begin drag
        pendingDragRef.current = null;
        isDraggingRef.current = true;
        draggingIdsRef.current = pending.ids;
        overDropRef.current = null;
        setDragState({ draggingIds: pending.ids, overTileId: null, overZone: null });

        // Clone source tile to create the drag ghost
        const tileEl = document.querySelector<HTMLElement>(
          `[data-photo-id="${pending.photoId}"]`
        );
        if (tileEl) {
          const rect = tileEl.getBoundingClientRect();
          dragOffsetRef.current = {
            x: pending.startX - rect.left,
            y: pending.startY - rect.top,
          };
          const ghost = tileEl.cloneNode(true) as HTMLElement;
          ghost.style.position = "fixed";
          ghost.style.pointerEvents = "none";
          ghost.style.opacity = "0.75";
          ghost.style.zIndex = "9999";
          ghost.style.margin = "0";
          ghost.style.width = `${rect.width}px`;
          ghost.style.height = `${rect.height}px`;
          ghost.style.left = `${e.clientX - dragOffsetRef.current.x}px`;
          ghost.style.top = `${e.clientY - dragOffsetRef.current.y}px`;
          document.body.appendChild(ghost);
          ghostRef.current = ghost;
        }
        return;
      }

      if (isDraggingRef.current) {
        if (ghostRef.current) {
          ghostRef.current.style.left = `${e.clientX - dragOffsetRef.current.x}px`;
          ghostRef.current.style.top = `${e.clientY - dragOffsetRef.current.y}px`;
        }
        updateOverTileFromPoint(e.clientX, e.clientY);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      pendingDragRef.current = null;
      if (!isDraggingRef.current) return;

      isDraggingRef.current = false;
      dragCompletedRef.current = true;

      if (ghostRef.current) {
        ghostRef.current.parentNode?.removeChild(ghostRef.current);
        ghostRef.current = null;
      }

      updateOverTileFromPoint(e.clientX, e.clientY);

      if (overDropRef.current !== null) {
        const { tileId, zone } = overDropRef.current;
        const ids = draggingIdsRef.current;
        // Skip if dropping a single photo onto itself
        if (!(zone === "on-photo" && ids.length === 1 && ids[0] === tileId) && ids.length > 0) {
          const target: DropTarget =
            zone === "on-photo"
              ? { kind: "photo", photoId: tileId }
              : { kind: "gap", gap: buildGapTargetRef.current(tileId, zone as "gap-before" | "gap-after") };
          onDropRef.current(ids, target);
        }
      }

      overDropRef.current = null;
      draggingIdsRef.current = [];
      setDragState({ draggingIds: [], overTileId: null, overZone: null });
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []); // stable: all mutable state accessed via refs

  const dragHandlers = useCallback(
    (photoId: string) => ({
      onMouseDown: (e: React.MouseEvent) => {
        // Let shift/meta/ctrl clicks pass through for multi-select
        if (e.shiftKey) {
          e.preventDefault(); // prevent text selection on shift+click
          return;
        }
        if (e.button !== 0 || e.metaKey || e.ctrlKey) return;
        e.preventDefault(); // prevent text selection while dragging
        const ids = selectedIds.has(photoId) ? [...selectedIds] : [photoId];
        pendingDragRef.current = { photoId, startX: e.clientX, startY: e.clientY, ids };
      },
    }),
    [selectedIds]
  );

  return { dragState, dragHandlers, dragCompletedRef };
}
