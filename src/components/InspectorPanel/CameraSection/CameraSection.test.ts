import { sortedEntries } from "./CameraSection";
import type { CorpusEntry } from "../../../state/CorpusContext";

function entry(value: string, lastUsed: number | null = null, useCount = 0): CorpusEntry {
  return { value, isBuiltin: false, lastUsed, useCount };
}

describe("sortedEntries", () => {
  it("returns an empty array unchanged", () => {
    expect(sortedEntries([])).toEqual([]);
  });

  it("returns a single entry unchanged", () => {
    const e = entry("Nikon F3", 1000);
    expect(sortedEntries([e])).toEqual([e]);
  });

  it("does not mutate the original array", () => {
    const original = [entry("B"), entry("A")];
    sortedEntries(original);
    expect(original[0].value).toBe("B");
  });

  // ── Entries with lastUsed ─────────────────────────────────────────────────

  it("sorts entries with lastUsed most-recent first", () => {
    const entries = [
      entry("old", 1000),
      entry("newest", 3000),
      entry("middle", 2000),
    ];
    const result = sortedEntries(entries).map((e) => e.value);
    expect(result).toEqual(["newest", "middle", "old"]);
  });

  // ── Entries without lastUsed ──────────────────────────────────────────────

  it("sorts entries without lastUsed alphabetically", () => {
    const entries = [entry("Zeiss"), entry("Nikon"), entry("Canon")];
    const result = sortedEntries(entries).map((e) => e.value);
    expect(result).toEqual(["Canon", "Nikon", "Zeiss"]);
  });

  it("is case-sensitive in alphabetical sort (localeCompare)", () => {
    const entries = [entry("portra"), entry("Kodak"), entry("ilford")];
    const result = sortedEntries(entries);
    // localeCompare is locale-aware; just verify the sort is deterministic and stable
    expect(result).toHaveLength(3);
    const sorted = [...entries].sort((a, b) => a.value.localeCompare(b.value));
    expect(result.map((e) => e.value)).toEqual(sorted.map((e) => e.value));
  });

  // ── Mixed: some with lastUsed, some without ───────────────────────────────

  it("places all entries with lastUsed before entries without", () => {
    const entries = [
      entry("no-use-B"),
      entry("used-old", 500),
      entry("no-use-A"),
      entry("used-new", 900),
    ];
    const result = sortedEntries(entries).map((e) => e.value);
    expect(result).toEqual(["used-new", "used-old", "no-use-A", "no-use-B"]);
  });

  it("sorts the used group desc and the unused group alpha independently", () => {
    const entries = [
      entry("Zeiss 50mm", null),
      entry("Canon 50mm", 200),
      entry("Nikon 50mm", null),
      entry("Leica 50mm", 100),
      entry("Voigtländer 50mm", 300),
    ];
    const result = sortedEntries(entries).map((e) => e.value);
    expect(result).toEqual([
      "Voigtländer 50mm",  // lastUsed 300
      "Canon 50mm",        // lastUsed 200
      "Leica 50mm",        // lastUsed 100
      "Nikon 50mm",        // alphabetical
      "Zeiss 50mm",        // alphabetical
    ]);
  });
});
