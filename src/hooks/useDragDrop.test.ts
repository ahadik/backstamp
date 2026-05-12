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

function reactMouseEvent(opts: {
  button?: number;
  clientX?: number;
  clientY?: number;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
} = {}) {
  return {
    button: opts.button ?? 0,
    clientX: opts.clientX ?? 50,
    clientY: opts.clientY ?? 50,
    shiftKey: opts.shiftKey ?? false,
    metaKey: opts.metaKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    preventDefault: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function domMouseEvent(type: string, opts: { clientX?: number; clientY?: number } = {}) {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.clientX ?? 50,
    clientY: opts.clientY ?? 50,
  });
}

// Create a fake tile element for elementFromPoint mocking
function makeTileEl(photoId: string, relX = 0.5): HTMLElement {
  const el = document.createElement("div");
  el.dataset.photoId = photoId;
  const width = 100;
  const left = 0;
  el.getBoundingClientRect = () => ({
    left,
    width,
    top: 0,
    height: 100,
    right: left + width,
    bottom: 100,
    x: left,
    y: 0,
    toJSON: () => ({}),
  });
  // clientX that hits this element at the given relX
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (el as any)._hitX = left + relX * width;
  return el;
}

// jsdom doesn't implement elementFromPoint — define it so vi.spyOn can mock it.
beforeAll(() => {
  if (!document.elementFromPoint) {
    Object.defineProperty(document, "elementFromPoint", {
      value: () => null,
      configurable: true,
      writable: true,
    });
  }
});

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
  const { result, unmount } = renderHook(() => useDragDrop(params));
  return { result, onDrop, onSelectSingle, unmount };
}

// Helper: simulate a full drag from mousedown → mousemove (start) → mousemove → mouseup
function simulateDrag(opts: {
  sourceId: string;
  targetEl: HTMLElement;
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
}) {
  const { sourceId, targetEl, result, startX = 10, startY = 10, endX = 50, endY = 50 } = opts;

  vi.spyOn(document, "elementFromPoint").mockReturnValue(targetEl);
  // querySelector returns null — ghost creation is skipped in jsdom, drag state still updates
  vi.spyOn(document, "querySelector").mockReturnValue(null);

  act(() => {
    result.current.dragHandlers(sourceId).onMouseDown(reactMouseEvent({ clientX: startX, clientY: startY }));
  });
  // Move beyond 5px threshold to start drag
  act(() => { document.dispatchEvent(domMouseEvent("mousemove", { clientX: startX + 10, clientY: startY + 10 })); });
  // Move to target
  act(() => { document.dispatchEvent(domMouseEvent("mousemove", { clientX: endX, clientY: endY })); });
  // Release
  act(() => { document.dispatchEvent(domMouseEvent("mouseup", { clientX: endX, clientY: endY })); });

  vi.restoreAllMocks();
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

// ─── onMouseDown ──────────────────────────────────────────────────────────────

describe("useDragDrop — dragHandlers.onMouseDown", () => {
  it("ignores non-primary button clicks", () => {
    const { result } = setup();
    act(() => result.current.dragHandlers("p1").onMouseDown(reactMouseEvent({ button: 2 })));
    // No drag pending — no state change, no move needed
    act(() => { document.dispatchEvent(domMouseEvent("mousemove", { clientX: 100, clientY: 100 })); });
    expect(result.current.dragState.draggingIds).toHaveLength(0);
  });

  it("ignores shift+click (reserved for range selection)", () => {
    const { result } = setup();
    act(() => result.current.dragHandlers("p1").onMouseDown(reactMouseEvent({ shiftKey: true })));
    act(() => { document.dispatchEvent(domMouseEvent("mousemove", { clientX: 100, clientY: 100 })); });
    expect(result.current.dragState.draggingIds).toHaveLength(0);
  });

  it("ignores cmd+click (reserved for toggle selection)", () => {
    const { result } = setup();
    act(() => result.current.dragHandlers("p1").onMouseDown(reactMouseEvent({ metaKey: true })));
    act(() => { document.dispatchEvent(domMouseEvent("mousemove", { clientX: 100, clientY: 100 })); });
    expect(result.current.dragState.draggingIds).toHaveLength(0);
  });

  it("prevents default to suppress text selection during drag", () => {
    const { result } = setup();
    const e = reactMouseEvent();
    act(() => result.current.dragHandlers("p1").onMouseDown(e));
    expect(e.preventDefault).toHaveBeenCalled();
  });
});

// ─── drag threshold ───────────────────────────────────────────────────────────

describe("useDragDrop — drag threshold", () => {
  it("does not start drag until mouse moves more than 5px", () => {
    const { result } = setup();
    act(() => result.current.dragHandlers("p1").onMouseDown(reactMouseEvent({ clientX: 10, clientY: 10 })));
    // Move only 3px — below threshold
    act(() => { document.dispatchEvent(domMouseEvent("mousemove", { clientX: 13, clientY: 10 })); });
    expect(result.current.dragState.draggingIds).toHaveLength(0);
  });

  it("starts drag once mouse moves more than 5px", () => {
    vi.spyOn(document, "querySelector").mockReturnValue(null);
    const { result } = setup();
    act(() => result.current.dragHandlers("p1").onMouseDown(reactMouseEvent({ clientX: 10, clientY: 10 })));
    act(() => { document.dispatchEvent(domMouseEvent("mousemove", { clientX: 20, clientY: 10 })); });
    expect(result.current.dragState.draggingIds).toContain("p1");
    vi.restoreAllMocks();
  });

  it("uses all selected IDs when dragged photo is selected", () => {
    vi.spyOn(document, "querySelector").mockReturnValue(null);
    const { result } = setup({ selectedIds: new Set(["p1", "p2"]) });
    act(() => result.current.dragHandlers("p1").onMouseDown(reactMouseEvent({ clientX: 0, clientY: 0 })));
    act(() => { document.dispatchEvent(domMouseEvent("mousemove", { clientX: 20, clientY: 0 })); });
    expect(result.current.dragState.draggingIds).toContain("p1");
    expect(result.current.dragState.draggingIds).toContain("p2");
    vi.restoreAllMocks();
  });

  it("uses only the dragged photo when it is not in the selection", () => {
    vi.spyOn(document, "querySelector").mockReturnValue(null);
    const { result } = setup({ selectedIds: new Set(["p2"]) });
    act(() => result.current.dragHandlers("p1").onMouseDown(reactMouseEvent({ clientX: 0, clientY: 0 })));
    act(() => { document.dispatchEvent(domMouseEvent("mousemove", { clientX: 20, clientY: 0 })); });
    expect(result.current.dragState.draggingIds).toEqual(["p1"]);
    vi.restoreAllMocks();
  });
});

// ─── drop target construction ─────────────────────────────────────────────────

describe("useDragDrop — drop target construction", () => {
  it("produces { kind: 'photo' } when dropping on the center of a tile", () => {
    const { result, onDrop } = setup();
    const targetEl = makeTileEl("p2", 0.5);
    simulateDrag({ sourceId: "p1", targetEl, result });
    expect(onDrop).toHaveBeenCalledWith(["p1"], { kind: "photo", photoId: "p2" });
  });

  it("produces gap-before when dropping on the left 20% of a tile", () => {
    const { result, onDrop } = setup();
    const targetEl = makeTileEl("p2", 0.1); // relX = 0.1 < 0.2
    simulateDrag({ sourceId: "p1", targetEl, result, endX: 10, endY: 50 });
    expect(onDrop).toHaveBeenCalledWith(["p1"], {
      kind: "gap",
      gap: { beforeId: "p1", afterId: "p2", dayKey: "2024-03-15" },
    });
  });

  it("produces gap-after when dropping on the right 20% of a tile", () => {
    const { result, onDrop } = setup();
    const targetEl = makeTileEl("p2", 0.9); // relX = 0.9 > 0.8
    simulateDrag({ sourceId: "p1", targetEl, result, endX: 90, endY: 50 });
    expect(onDrop).toHaveBeenCalledWith(["p1"], {
      kind: "gap",
      gap: { beforeId: "p2", afterId: "p3", dayKey: "2024-03-15" },
    });
  });

  it("gap-before on the first photo has beforeId: null", () => {
    const { result, onDrop } = setup();
    const targetEl = makeTileEl("p1", 0.1);
    simulateDrag({ sourceId: "p2", targetEl, result, endX: 10, endY: 50 });
    expect(onDrop).toHaveBeenCalledWith(["p2"], {
      kind: "gap",
      gap: { beforeId: null, afterId: "p1", dayKey: "2024-03-15" },
    });
  });

  it("gap-after on the last photo has afterId: null", () => {
    const { result, onDrop } = setup();
    const targetEl = makeTileEl("p3", 0.9);
    simulateDrag({ sourceId: "p1", targetEl, result, endX: 90, endY: 50 });
    expect(onDrop).toHaveBeenCalledWith(["p1"], {
      kind: "gap",
      gap: { beforeId: "p3", afterId: null, dayKey: "2024-03-15" },
    });
  });

  it("does not call onDrop when dropping a single photo onto itself", () => {
    const { result, onDrop } = setup();
    const targetEl = makeTileEl("p1", 0.5); // same photo as source
    simulateDrag({ sourceId: "p1", targetEl, result });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("does not call onDrop when released over empty space (no tile found)", () => {
    const { result, onDrop } = setup();
    vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
    vi.spyOn(document, "querySelector").mockReturnValue(null);

    act(() => result.current.dragHandlers("p1").onMouseDown(reactMouseEvent({ clientX: 10, clientY: 10 })));
    act(() => { document.dispatchEvent(domMouseEvent("mousemove", { clientX: 25, clientY: 10 })); });
    act(() => { document.dispatchEvent(domMouseEvent("mouseup", { clientX: 25, clientY: 10 })); });

    expect(onDrop).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("resets drag state after a successful drop", () => {
    const { result } = setup();
    const targetEl = makeTileEl("p2", 0.5);
    simulateDrag({ sourceId: "p1", targetEl, result });
    expect(result.current.dragState).toEqual({
      draggingIds: [],
      overTileId: null,
      overZone: null,
    });
  });
});

// ─── dragCompletedRef ─────────────────────────────────────────────────────────

describe("useDragDrop — dragCompletedRef", () => {
  it("is set to true after a drag completes", () => {
    const { result } = setup();
    vi.spyOn(document, "querySelector").mockReturnValue(null);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(null);

    act(() => result.current.dragHandlers("p1").onMouseDown(reactMouseEvent({ clientX: 0, clientY: 0 })));
    act(() => { document.dispatchEvent(domMouseEvent("mousemove", { clientX: 20, clientY: 0 })); });
    act(() => { document.dispatchEvent(domMouseEvent("mouseup", { clientX: 20, clientY: 0 })); });

    expect(result.current.dragCompletedRef.current).toBe(true);
    vi.restoreAllMocks();
  });

  it("is not set when the mouse is released before the drag threshold", () => {
    const { result } = setup();
    act(() => result.current.dragHandlers("p1").onMouseDown(reactMouseEvent({ clientX: 0, clientY: 0 })));
    act(() => { document.dispatchEvent(domMouseEvent("mouseup", { clientX: 2, clientY: 0 })); });
    expect(result.current.dragCompletedRef.current).toBe(false);
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
    const targetEl = makeTileEl("c", 0.1);
    simulateDrag({ sourceId: "a", targetEl, result, endX: 10 });
    expect(onDrop).toHaveBeenCalledWith(
      ["a"],
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
    const targetEl = makeTileEl("orphan", 0.1);
    simulateDrag({ sourceId: "a", targetEl, result, endX: 10 });
    expect(onDrop).toHaveBeenCalledWith(
      ["a"],
      expect.objectContaining({
        gap: expect.objectContaining({ dayKey: "no-date" }),
      }),
    );
  });
});
