import { renderHook, act } from "@testing-library/react";
import { useDragDrop } from "./useDragDrop";
import type { DayBlock } from "../state/selectors";
import type { Photo, Metadata } from "../state/SessionContext";

const nullMeta: Metadata = {
  captureDate: null, captureTime: null, utcOffset: null, timezone: null,
  gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null, lens: null, filmVendor: null, filmType: null,
};

function makePhoto(id: string): Photo {
  return {
    id,
    filePath: `/photos/${id}.jpg`,
    fileStatus: "ok",
    thumbnail: { small: "", large: "" },
    originalMetadata: nullMeta,
    currentMetadata: nullMeta,
    pendingChanges: null,
  };
}

function makeDayBlock(dateKey: string, photoIds: string[]): DayBlock {
  return { dateKey, label: dateKey, photos: photoIds.map(makePhoto) };
}

function mockDrag(opts: {
  clientX?: number;
  relatedTarget?: Node | null;
  dataIds?: string;
  rectLeft?: number;
  rectWidth?: number;
  containsRelated?: boolean;
} = {}) {
  const {
    clientX = 50,
    relatedTarget = null,
    dataIds = "",
    rectLeft = 0,
    rectWidth = 100,
    containsRelated = false,
  } = opts;

  return {
    clientX,
    relatedTarget,
    currentTarget: {
      getBoundingClientRect: () => ({ left: rectLeft, width: rectWidth }),
      contains: (_n: unknown) => containsRelated,
    },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    dataTransfer: {
      effectAllowed: "move",
      dropEffect: "move",
      getData: vi.fn().mockReturnValue(dataIds),
      setData: vi.fn(),
    },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const THREE_IDS = ["p1", "p2", "p3"];
const DEFAULT_BLOCKS = [makeDayBlock("2024-03-15", THREE_IDS)];

function setup(overrides: {
  orderedIds?: string[];
  selectedIds?: Set<string>;
  dayBlocks?: DayBlock[];
} = {}) {
  const onDrop = vi.fn();
  const onSelectSingle = vi.fn();
  const params = {
    orderedIds: THREE_IDS,
    selectedIds: new Set<string>(),
    dayBlocks: DEFAULT_BLOCKS,
    onDrop,
    onSelectSingle,
    ...overrides,
  };
  const { result } = renderHook(() => useDragDrop(params));
  return { result, onDrop, onSelectSingle };
}

// ─── initial state ────────────────────────────────────────────────────────────

describe("useDragDrop — initial state", () => {
  it("starts with no drag active", () => {
    const { result } = setup();
    expect(result.current.dragState).toEqual({
      draggingIds: [],
      overTileId: null,
      overZone: null,
    });
  });
});

// ─── dragHandlers ─────────────────────────────────────────────────────────────

describe("useDragDrop — dragHandlers.onDragStart", () => {
  it("uses all selected IDs when the dragged photo is selected", () => {
    const { result } = setup({ selectedIds: new Set(["p1", "p2"]) });
    act(() => result.current.dragHandlers("p1").onDragStart(mockDrag()));
    expect(result.current.dragState.draggingIds).toHaveLength(2);
    expect(result.current.dragState.draggingIds).toContain("p1");
    expect(result.current.dragState.draggingIds).toContain("p2");
  });

  it("uses only the clicked photo when it is not selected", () => {
    const { result, onSelectSingle } = setup({ selectedIds: new Set(["p2"]) });
    act(() => result.current.dragHandlers("p1").onDragStart(mockDrag()));
    expect(result.current.dragState.draggingIds).toEqual(["p1"]);
    expect(onSelectSingle).toHaveBeenCalledWith("p1");
  });

  it("does not call onSelectSingle when the photo is already selected", () => {
    const { result, onSelectSingle } = setup({ selectedIds: new Set(["p1"]) });
    act(() => result.current.dragHandlers("p1").onDragStart(mockDrag()));
    expect(onSelectSingle).not.toHaveBeenCalled();
  });
});

describe("useDragDrop — dragHandlers.onDragEnd", () => {
  it("resets all drag state", () => {
    const { result } = setup({ selectedIds: new Set(["p1"]) });
    act(() => result.current.dragHandlers("p1").onDragStart(mockDrag()));
    act(() => result.current.dragHandlers("p1").onDragEnd());
    expect(result.current.dragState).toEqual({
      draggingIds: [],
      overTileId: null,
      overZone: null,
    });
  });
});

// ─── tileDropProps.onDragOver — zone detection ───────────────────────────────

describe("useDragDrop — onDragOver zone detection", () => {
  it("classifies the left 20% as gap-before", () => {
    const { result } = setup();
    // relX = 10/100 = 0.10 < 0.2
    act(() => result.current.tileDropProps("p2").onDragOver(mockDrag({ clientX: 10, rectWidth: 100 })));
    expect(result.current.dragState.overZone).toBe("gap-before");
    expect(result.current.dragState.overTileId).toBe("p2");
  });

  it("classifies the center as on-photo", () => {
    const { result } = setup();
    // relX = 50/100 = 0.5
    act(() => result.current.tileDropProps("p2").onDragOver(mockDrag({ clientX: 50, rectWidth: 100 })));
    expect(result.current.dragState.overZone).toBe("on-photo");
  });

  it("classifies the right 20% as gap-after", () => {
    const { result } = setup();
    // relX = 90/100 = 0.90 > 0.8
    act(() => result.current.tileDropProps("p2").onDragOver(mockDrag({ clientX: 90, rectWidth: 100 })));
    expect(result.current.dragState.overZone).toBe("gap-after");
  });

  it("boundary: relX exactly 0.2 is on-photo", () => {
    const { result } = setup();
    act(() => result.current.tileDropProps("p2").onDragOver(mockDrag({ clientX: 20, rectWidth: 100 })));
    expect(result.current.dragState.overZone).toBe("on-photo");
  });

  it("boundary: relX exactly 0.8 is on-photo", () => {
    const { result } = setup();
    act(() => result.current.tileDropProps("p2").onDragOver(mockDrag({ clientX: 80, rectWidth: 100 })));
    expect(result.current.dragState.overZone).toBe("on-photo");
  });
});

// ─── tileDropProps.onDragLeave ────────────────────────────────────────────────

describe("useDragDrop — onDragLeave", () => {
  it("clears overTileId when relatedTarget is outside the tile", () => {
    const { result } = setup();
    act(() => result.current.tileDropProps("p2").onDragOver(mockDrag({ clientX: 50 })));
    act(() => result.current.tileDropProps("p2").onDragLeave(
      mockDrag({ relatedTarget: null, containsRelated: false })
    ));
    expect(result.current.dragState.overTileId).toBeNull();
    expect(result.current.dragState.overZone).toBeNull();
  });

  it("keeps overTileId when relatedTarget is a child inside the tile", () => {
    const { result } = setup();
    act(() => result.current.tileDropProps("p2").onDragOver(mockDrag({ clientX: 50 })));
    const childNode = {} as Node;
    act(() => result.current.tileDropProps("p2").onDragLeave(
      mockDrag({ relatedTarget: childNode, containsRelated: true })
    ));
    expect(result.current.dragState.overTileId).toBe("p2");
  });
});

// ─── tileDropProps.onDrop — Finder guard ─────────────────────────────────────

describe("useDragDrop — onDrop Finder guard", () => {
  it("does not call onDrop when there are no in-app IDs (Finder file drag)", () => {
    const { result, onDrop } = setup();
    // Empty getData return + empty ref = Finder drop
    act(() => result.current.tileDropProps("p2").onDrop(mockDrag({ clientX: 50, dataIds: "" })));
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("does not prevent event propagation for Finder drops (so document handler fires)", () => {
    const { result } = setup();
    const e = mockDrag({ clientX: 50, dataIds: "" });
    act(() => result.current.tileDropProps("p2").onDrop(e));
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(e.stopPropagation).not.toHaveBeenCalled();
  });
});

// ─── tileDropProps.onDrop — target construction ──────────────────────────────

describe("useDragDrop — onDrop target construction", () => {
  it("produces { kind: 'photo' } when dropping on center", () => {
    const { result, onDrop } = setup();
    act(() => result.current.tileDropProps("p2").onDrop(
      mockDrag({ clientX: 50, dataIds: "x" })
    ));
    expect(onDrop).toHaveBeenCalledWith(["x"], { kind: "photo", photoId: "p2" });
  });

  it("produces gap-before with correct neighbors for a middle photo", () => {
    const { result, onDrop } = setup();
    // p2 is at index 1 → gap-before: { beforeId: "p1", afterId: "p2" }
    act(() => result.current.tileDropProps("p2").onDrop(
      mockDrag({ clientX: 5, dataIds: "x" })
    ));
    expect(onDrop).toHaveBeenCalledWith(["x"], {
      kind: "gap",
      gap: { beforeId: "p1", afterId: "p2", dayKey: "2024-03-15" },
    });
  });

  it("produces gap-after with correct neighbors for a middle photo", () => {
    const { result, onDrop } = setup();
    // p2 is at index 1 → gap-after: { beforeId: "p2", afterId: "p3" }
    act(() => result.current.tileDropProps("p2").onDrop(
      mockDrag({ clientX: 95, dataIds: "x" })
    ));
    expect(onDrop).toHaveBeenCalledWith(["x"], {
      kind: "gap",
      gap: { beforeId: "p2", afterId: "p3", dayKey: "2024-03-15" },
    });
  });

  it("gap-before on the first photo has beforeId: null", () => {
    const { result, onDrop } = setup();
    act(() => result.current.tileDropProps("p1").onDrop(
      mockDrag({ clientX: 5, dataIds: "x" })
    ));
    expect(onDrop).toHaveBeenCalledWith(["x"], {
      kind: "gap",
      gap: { beforeId: null, afterId: "p1", dayKey: "2024-03-15" },
    });
  });

  it("gap-after on the last photo has afterId: null", () => {
    const { result, onDrop } = setup();
    act(() => result.current.tileDropProps("p3").onDrop(
      mockDrag({ clientX: 95, dataIds: "x" })
    ));
    expect(onDrop).toHaveBeenCalledWith(["x"], {
      kind: "gap",
      gap: { beforeId: "p3", afterId: null, dayKey: "2024-03-15" },
    });
  });

  it("parses multiple comma-separated IDs from dataTransfer", () => {
    const { result, onDrop } = setup();
    act(() => result.current.tileDropProps("p2").onDrop(
      mockDrag({ clientX: 50, dataIds: "p1,p2,p3" })
    ));
    expect(onDrop).toHaveBeenCalledWith(
      ["p1", "p2", "p3"],
      expect.objectContaining({ kind: "photo" }),
    );
  });

  it("clears drag state after a successful drop", () => {
    const { result } = setup();
    act(() => result.current.tileDropProps("p2").onDrop(
      mockDrag({ clientX: 50, dataIds: "x" })
    ));
    expect(result.current.dragState).toEqual({
      draggingIds: [],
      overTileId: null,
      overZone: null,
    });
  });
});

// ─── day key resolution ───────────────────────────────────────────────────────

describe("useDragDrop — day key in gap target", () => {
  it("uses the photo's day block key in gap targets", () => {
    const blocks = [
      makeDayBlock("2024-01-01", ["a", "b"]),
      makeDayBlock("2024-02-01", ["c", "d"]),
    ];
    const { result, onDrop } = setup({
      orderedIds: ["a", "b", "c", "d"],
      dayBlocks: blocks,
    });
    act(() => result.current.tileDropProps("c").onDrop(
      mockDrag({ clientX: 5, dataIds: "x" })
    ));
    expect(onDrop).toHaveBeenCalledWith(
      ["x"],
      expect.objectContaining({
        kind: "gap",
        gap: expect.objectContaining({ dayKey: "2024-02-01" }),
      }),
    );
  });

  it("uses 'no-date' for a photo that belongs to no day block", () => {
    const blocks = [makeDayBlock("2024-01-01", ["a"])];
    const { result, onDrop } = setup({
      orderedIds: ["a", "orphan"],
      dayBlocks: blocks,
    });
    act(() => result.current.tileDropProps("orphan").onDrop(
      mockDrag({ clientX: 5, dataIds: "x" })
    ));
    expect(onDrop).toHaveBeenCalledWith(
      ["x"],
      expect.objectContaining({
        gap: expect.objectContaining({ dayKey: "no-date" }),
      }),
    );
  });
});
