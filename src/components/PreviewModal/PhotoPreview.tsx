import { useEffect, useRef, useState } from "react";
import type { Photo } from "../../state/SessionContext";
import { fileNameOf } from "./previewItems";
import styles from "./PreviewModal.module.css";

// Width/height ratios by thumbnail URL. Once known, a revisited photo lays out
// synchronously on the first render instead of waiting for a load event.
const aspectCache = new Map<string, number>();

/**
 * Aspect ratio of an image, read from the small thumbnail because it is
 * already in the browser cache from the grid. It sizes the stage before the
 * large image has arrived, so the preview appears at its final size at once.
 */
function useImageAspect(src: string | null): number | null {
  const [known, setKnown] = useState<{ src: string; ratio: number } | null>(null);

  useEffect(() => {
    if (!src || aspectCache.has(src)) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!img.naturalHeight) return;
      const ratio = img.naturalWidth / img.naturalHeight;
      aspectCache.set(src, ratio);
      if (!cancelled) setKnown({ src, ratio });
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!src) return null;
  return aspectCache.get(src) ?? (known?.src === src ? known.ratio : null);
}

interface Props {
  photos: Photo[];
  index: number;
  onStep: (delta: 1 | -1) => void;
}

export function PhotoPreview({ photos, index, onStep }: Props) {
  const photo = photos[index];
  const isMissing = photo.fileStatus === "missing";
  const aspect = useImageAspect(isMissing ? null : photo.thumbnail.small);
  const [loadedLarge, setLoadedLarge] = useState<Set<string>>(() => new Set());
  const largeRef = useRef<HTMLImageElement>(null);
  const largeReady = loadedLarge.has(photo.id);
  const name = fileNameOf(photo.filePath);

  const markLargeLoaded = (id: string) =>
    setLoadedLarge((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));

  // A cached large image can finish before React attaches onLoad.
  useEffect(() => {
    const el = largeRef.current;
    if (el && el.complete && el.naturalWidth > 0) markLargeLoaded(photo.id);
  }, [photo.id]);

  // Warm the neighbours so arrowing through the selection is immediate.
  useEffect(() => {
    for (const delta of [1, -1, 2, -2]) {
      const neighbour = photos[index + delta];
      if (neighbour && neighbour.fileStatus === "ok") {
        const img = new Image();
        img.src = neighbour.thumbnail.large;
      }
    }
  }, [photos, index]);

  const stageClass = [
    styles.stage,
    isMissing ? styles.stageMissing : "",
    !isMissing && aspect === null ? styles.stagePending : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div className={styles.frame} data-testid="preview-frame">
        <div className={stageClass} style={{ ["--aspect" as string]: String(aspect ?? 1.5) }}>
          {isMissing ? (
            <div className={styles.missing}>
              <span className="text-lg">?</span>
              <span className="text-sm">File not found</span>
            </div>
          ) : (
            <>
              <img
                key={`small-${photo.id}`}
                className={styles.image}
                src={photo.thumbnail.small}
                alt=""
                aria-hidden
                draggable={false}
              />
              <img
                key={`large-${photo.id}`}
                ref={largeRef}
                className={`${styles.image} ${styles.large}${largeReady ? ` ${styles.ready}` : ""}`}
                src={photo.thumbnail.large}
                alt={name}
                draggable={false}
                onLoad={() => markLargeLoaded(photo.id)}
              />
            </>
          )}
        </div>
        <div className={styles.caption}>
          <span className={styles.name}>{name}</span>
          {photos.length > 1 && (
            <span className={styles.counter}>
              {index + 1} of {photos.length}
            </span>
          )}
        </div>
      </div>
      {photos.length > 1 && (
        <>
          <button
            type="button"
            className={`${styles.nav} ${styles.navPrev}`}
            onClick={() => onStep(-1)}
            disabled={index === 0}
            aria-label="Previous photo"
          >
            ‹
          </button>
          <button
            type="button"
            className={`${styles.nav} ${styles.navNext}`}
            onClick={() => onStep(1)}
            disabled={index === photos.length - 1}
            aria-label="Next photo"
          >
            ›
          </button>
        </>
      )}
    </>
  );
}
