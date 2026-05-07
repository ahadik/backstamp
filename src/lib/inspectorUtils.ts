import type { Metadata, Photo } from "../state/SessionContext";

/**
 * Returns the shared field value if all selected photos agree, 'multiple' if two or more
 * distinct non-null values exist, or null if all values are null (or the selection is empty).
 */
export function deriveFieldValue<T>(
  photos: Photo[],
  getter: (m: Metadata) => T | null
): T | "multiple" | null {
  if (photos.length === 0) return null;

  const values = photos.map((p) => getter(p.currentMetadata));
  const nonNull = values.filter((v) => v !== null) as T[];

  if (nonNull.length === 0) return null;

  const first = nonNull[0];
  const allSame = nonNull.every((v) => {
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
