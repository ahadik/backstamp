import { useCallback, useEffect, useState } from "react";
import { useSession } from "../../state/SessionContext";
import { useUI } from "../../state/UIContext";
import { Modal } from "../common/Modal/Modal";
import { PhotoPreview } from "./PhotoPreview";
import { GpxPreview } from "./GpxPreview";
import {
  selectedPhotosInGridOrder,
  selectedGpxFiles,
  clampIndex,
  isTextEntryTarget,
} from "./previewItems";

/**
 * Quick Look-style preview of the current selection. Space toggles it; with
 * several photos selected the arrow keys step through them. A GPX selection
 * previews as a large interactive map showing every selected route.
 */
export function PreviewModal() {
  const { state: session } = useSession();
  const { state: ui } = useUI();
  const [isOpen, setIsOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const photos = selectedPhotosInGridOrder(
    session.photos,
    session.selectedIds,
    ui.photoFilters,
    ui.workingTimezone
  );
  // Photo and GPX selections are mutually exclusive in the reducer, but if
  // both were ever set the photos win.
  const gpxFiles = photos.length > 0 ? [] : selectedGpxFiles(session.gpxFiles, session.selectedGpxIds);
  const canPreview = photos.length > 0 || gpxFiles.length > 0;
  const photoCount = photos.length;
  const safeIndex = clampIndex(index, photoCount);

  // The selection can change under an open preview (a photo removed, a filter
  // applied); close once there is nothing left to show.
  useEffect(() => {
    if (isOpen && !canPreview) setIsOpen(false);
  }, [isOpen, canPreview]);

  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTextEntryTarget(e.target)) return;

      if (e.key === " ") {
        if (isOpen) {
          setIsOpen(false);
        } else if (canPreview) {
          setIndex(0);
          setIsOpen(true);
        } else {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      if (!isOpen) return;

      if (e.key === "Escape") {
        setIsOpen(false);
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // Arrow keys only step photos; on the GPX map they stay free to pan.
      if (photoCount > 1) {
        const delta =
          e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1
          : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1
          : 0;
        if (delta !== 0) {
          setIndex((i) => clampIndex(i + delta, photoCount));
          e.preventDefault();
          e.stopPropagation();
        }
      }
    }
    // Capture phase, so the grid's own Escape (deselect) and other document
    // listeners never see the keys the preview consumes.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [isOpen, canPreview, photoCount]);

  if (!isOpen || !canPreview) return null;

  return (
    <Modal isOpen onClose={close} closeOnEscape={false}>
      {photos.length > 0 ? (
        <PhotoPreview
          photos={photos}
          index={safeIndex}
          onStep={(delta) => setIndex(clampIndex(safeIndex + delta, photoCount))}
        />
      ) : (
        <GpxPreview
          key={gpxFiles.map((g) => g.id).join(",")}
          gpxFiles={gpxFiles}
          mapboxToken={ui.mapboxToken}
        />
      )}
    </Modal>
  );
}
