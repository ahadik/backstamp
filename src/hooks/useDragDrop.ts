import { useState, useRef, useCallback } from "react";
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

  const zoneFromEvent = (e: React.DragEvent): DropZone => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    if (relX < 0.2) return "gap-before";
    if (relX > 0.8) return "gap-after";
    return "on-photo";
  };

  const dragHandlers = useCallback(
    (photoId: string) => ({
      draggable: true as const,
      onDragStart: (e: React.DragEvent) => {
        const ids = selectedIds.has(photoId) ? [...selectedIds] : [photoId];
        if (!selectedIds.has(photoId)) onSelectSingle(photoId);
        draggingIdsRef.current = ids;
        setDragState({ draggingIds: ids, overTileId: null, overZone: null });
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", ids.join(","));
      },
      onDragEnd: () => {
        draggingIdsRef.current = [];
        setDragState({ draggingIds: [], overTileId: null, overZone: null });
      },
    }),
    [selectedIds, onSelectSingle]
  );

  const tileDropProps = useCallback(
    (photoId: string) => ({
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        const zone = zoneFromEvent(e);
        setDragState((s) => ({
          ...s,
          overTileId: photoId,
          overZone: zone,
        }));
      },
      onDragLeave: (e: React.DragEvent) => {
        const related = e.relatedTarget as Node | null;
        if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
          setDragState((s) => ({ ...s, overTileId: null, overZone: null }));
        }
      },
      onDrop: (e: React.DragEvent) => {
        const raw = e.dataTransfer.getData("text/plain");
        const ids = raw.length > 0 ? raw.split(",") : draggingIdsRef.current;
        // Not an in-app drag — let Finder file drops bubble to the document handler.
        if (ids.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        const zone = zoneFromEvent(e);
        const target: DropTarget =
          zone === "on-photo"
            ? { kind: "photo", photoId }
            : { kind: "gap", gap: buildGapTarget(photoId, zone) };
        onDrop(ids, target);
        setDragState({ draggingIds: [], overTileId: null, overZone: null });
      },
    }),
    [buildGapTarget, onDrop]
  );

  return { dragState, dragHandlers, tileDropProps };
}
