import type { Metadata, Photo } from "../state/SessionContext";

/**
 * Returns the shared field value if every selected photo agrees, or 'multiple'
 * if the values differ. A mix of set and unset values also reads as 'multiple':
 * an unset value is a state of its own, not mere absence, so a selection where
 * some photos have a value and others don't must not display that value as if
 * it were shared. Returns null if all values are null or the selection is empty.
 */
export function deriveFieldValue<T>(
  photos: Photo[],
  getter: (m: Metadata) => T | null
): T | "multiple" | null {
  if (photos.length === 0) return null;

  const values = photos.map((p) => getter(p.currentMetadata));
  const first = values[0];
  const allSame = values.every((v) => {
    if (typeof v === "object" && v !== null) {
      return JSON.stringify(v) === JSON.stringify(first);
    }
    return v === first;
  });

  return allSame ? first : "multiple";
}

export function buildPendingChange(
  field: keyof Metadata,
  value: Metadata[keyof Metadata]
): Partial<Metadata> {
  return { [field]: value } as Partial<Metadata>;
}

/**
 * Commit whatever the user is mid-typing in the inspector by blurring the
 * focused control; every inspector input saves on blur. Call this before a
 * selection change so the edit lands on the photos it was typed for. Needed
 * because photo tiles prevent the default mousedown (for drag tracking), which
 * would otherwise have blurred the input for us.
 */
export function commitInspectorEdits(): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return;
  if (!document.getElementById("inspector-panel")?.contains(active)) return;
  active.blur();
}
