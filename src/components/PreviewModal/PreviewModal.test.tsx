import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PreviewModal } from "./PreviewModal";
import type { SessionState, Photo, GpxFile, Metadata } from "../../state/SessionContext";
import type { UIState } from "../../state/UIContext";

const mockMap = {
  on: vi.fn(),
  remove: vi.fn(),
  addSource: vi.fn(),
  addLayer: vi.fn(),
};
const mapCtor = vi.fn((_opts: unknown) => mockMap);


vi.mock("mapbox-gl", () => {
  class LngLatBounds {
    coords: Array<[number, number]> = [];
    extend(c: [number, number]) {
      this.coords.push(c);
      return this;
    }
  }
  return {
    default: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Map: function (this: any, opts: unknown) { return mapCtor(opts); },

      LngLatBounds,
      accessToken: "",
    },
  };
});
vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

vi.mock("../../state/SessionContext", () => ({ useSession: vi.fn() }));
vi.mock("../../state/UIContext", () => ({ useUI: vi.fn() }));

import { useSession } from "../../state/SessionContext";
import { useUI } from "../../state/UIContext";

const nullMeta: Metadata = {
  captureDate: null, captureTime: null, utcOffset: null, timezone: null,
  gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null,
  lens: null, filmVendor: null, filmType: null,
};

function makePhoto(id: string, time: string, overrides: Partial<Photo> = {}): Photo {
  const meta = { ...nullMeta, captureDate: "2026-05-01", captureTime: time, utcOffset: "+00:00" };
  return {
    id,
    filePath: `/photos/${id}.jpg`,
    fileStatus: "ok",
    thumbnail: { small: `/t/${id}_s.jpg`, large: `/t/${id}_l.jpg` },
    originalMetadata: meta,
    currentMetadata: meta,
    pendingChanges: null,
    ...overrides,
  };
}

function makeGpx(id: string, trackPoints: GpxFile["trackPoints"] = []): GpxFile {
  return { id, filePath: `/gpx/${id}.gpx`, addedAt: 0, trackPoints, thumbnailPath: null, timezone: null };
}

const baseSession: SessionState = {
  photos: [],
  selectedIds: new Set(),
  gpxFiles: [],
  selectedGpxIds: new Set(),
  applyInProgress: false,
  canRollback: false,
  metadataHistory: [],
};

const baseUI: UIState = {
  workingTimezone: "UTC",
  gridColumns: 5,
  panelWidth: 800,
  mapPanelHeight: 200,
  photoFilters: { dateAfter: null, dateBefore: null, cameras: null },
  mapboxToken: "pk.test",
  googleMapsKey: null,
  claudeApiKey: null,
  error: null,
};

function setup(session: Partial<SessionState> = {}, ui: Partial<UIState> = {}) {
  vi.mocked(useSession).mockReturnValue({ state: { ...baseSession, ...session }, dispatch: vi.fn() });
  vi.mocked(useUI).mockReturnValue({ state: { ...baseUI, ...ui }, dispatch: vi.fn() });
  return render(<PreviewModal />);
}

const three = [makePhoto("a", "08:00:00"), makePhoto("b", "09:00:00"), makePhoto("c", "10:00:00")];

function press(key: string, init: KeyboardEventInit = {}) {
  fireEvent.keyDown(document.body, { key, ...init });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PreviewModal", () => {
  it("renders nothing until space is pressed", () => {
    setup({ photos: three, selectedIds: new Set(["a"]) });
    expect(screen.queryByTestId("preview-frame")).not.toBeInTheDocument();
  });

  it("ignores space when nothing is selected", () => {
    setup({ photos: three });
    press(" ");
    expect(screen.queryByTestId("preview-frame")).not.toBeInTheDocument();
  });

  it("opens on space showing the large thumbnail and file name", () => {
    setup({ photos: three, selectedIds: new Set(["b"]) });
    press(" ");
    const img = screen.getByAltText("b.jpg") as HTMLImageElement;
    expect(img.src).toContain("/t/b_l.jpg");
    expect(screen.getByText("b.jpg")).toBeInTheDocument();
    // A single photo gets no counter and no arrows.
    expect(screen.queryByText(/of 1/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Next photo")).not.toBeInTheDocument();
  });

  it("closes on a second space press", () => {
    setup({ photos: three, selectedIds: new Set(["a"]) });
    press(" ");
    expect(screen.getByTestId("preview-frame")).toBeInTheDocument();
    press(" ");
    expect(screen.queryByTestId("preview-frame")).not.toBeInTheDocument();
  });

  it("closes on Escape without letting the grid see the key", () => {
    setup({ photos: three, selectedIds: new Set(["a"]) });
    const bubbleListener = vi.fn();
    document.addEventListener("keydown", bubbleListener);
    press(" ");
    press("Escape");
    expect(screen.queryByTestId("preview-frame")).not.toBeInTheDocument();
    const escapes = bubbleListener.mock.calls.filter(([e]) => (e as KeyboardEvent).key === "Escape");
    expect(escapes).toHaveLength(0);
    document.removeEventListener("keydown", bubbleListener);
  });

  it("closes when the backdrop is clicked, not the image", () => {
    setup({ photos: three, selectedIds: new Set(["a"]) });
    press(" ");
    fireEvent.click(screen.getByAltText("a.jpg"));
    expect(screen.getByTestId("preview-frame")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("preview-frame").parentElement!);
    expect(screen.queryByTestId("preview-frame")).not.toBeInTheDocument();
  });

  it("steps through a multi-selection in grid order with the arrow keys and stops at the ends", () => {
    // Selection set is in click order; grid order is by capture time.
    setup({ photos: [three[2], three[0], three[1]], selectedIds: new Set(["c", "a", "b"]) });
    press(" ");
    expect(screen.getByAltText("a.jpg")).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();

    press("ArrowRight");
    expect(screen.getByAltText("b.jpg")).toBeInTheDocument();
    expect(screen.getByText("2 of 3")).toBeInTheDocument();

    press("ArrowDown");
    expect(screen.getByAltText("c.jpg")).toBeInTheDocument();
    press("ArrowRight");
    expect(screen.getByText("3 of 3")).toBeInTheDocument();

    press("ArrowLeft");
    press("ArrowUp");
    press("ArrowLeft");
    expect(screen.getByAltText("a.jpg")).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
  });

  it("steps with the on-screen arrows, disabling them at the ends", () => {
    setup({ photos: three, selectedIds: new Set(["a", "b"]) });
    press(" ");
    const prev = screen.getByLabelText("Previous photo") as HTMLButtonElement;
    const next = screen.getByLabelText("Next photo") as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    fireEvent.click(next);
    expect(screen.getByAltText("b.jpg")).toBeInTheDocument();
    expect(next.disabled).toBe(true);
    expect(prev.disabled).toBe(false);
  });

  it("leaves space alone while typing in a field", () => {
    setup({ photos: three, selectedIds: new Set(["a"]) });
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: " " });
    expect(screen.queryByTestId("preview-frame")).not.toBeInTheDocument();
    input.remove();
  });

  it("ignores space with a modifier held", () => {
    setup({ photos: three, selectedIds: new Set(["a"]) });
    press(" ", { metaKey: true });
    expect(screen.queryByTestId("preview-frame")).not.toBeInTheDocument();
  });

  it("shows a placeholder for a missing file", () => {
    const missing = makePhoto("m", "08:00:00", { fileStatus: "missing" });
    setup({ photos: [missing], selectedIds: new Set(["m"]) });
    press(" ");
    expect(screen.getByText("File not found")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("closes when the selection disappears underneath it", () => {
    const { rerender } = setup({ photos: three, selectedIds: new Set(["a"]) });
    press(" ");
    expect(screen.getByTestId("preview-frame")).toBeInTheDocument();
    vi.mocked(useSession).mockReturnValue({ state: { ...baseSession, photos: three }, dispatch: vi.fn() });
    rerender(<PreviewModal />);
    expect(screen.queryByTestId("preview-frame")).not.toBeInTheDocument();
  });

  describe("GPX selection", () => {
    const track1 = makeGpx("t1", [{ lat: 37.7, lng: -122.4, timestamp: 1 }, { lat: 37.8, lng: -122.3, timestamp: 2 }]);
    const track2 = makeGpx("t2", [{ lat: 40.7, lng: -74.0, timestamp: 1 }]);

    it("opens a map framed on every selected route and lists them", () => {
      setup({ gpxFiles: [track1, track2], selectedGpxIds: new Set(["t1", "t2"]) });
      press(" ");
      expect(screen.getByTestId("gpx-preview-map")).toBeInTheDocument();
      expect(screen.getByText("t1.gpx")).toBeInTheDocument();
      expect(screen.getByText("t2.gpx")).toBeInTheDocument();

      expect(mapCtor).toHaveBeenCalledTimes(1);
      const opts = mapCtor.mock.calls[0][0] as unknown as { bounds: { coords: unknown[] } };
      expect(opts.bounds.coords).toEqual([[-122.4, 37.7], [-122.3, 37.8], [-74.0, 40.7]]);

      const styleLoad = mockMap.on.mock.calls.find(([evt]) => evt === "style.load")![1] as () => void;
      act(() => styleLoad());
      expect(mockMap.addLayer).toHaveBeenCalledTimes(2);
      const colors = mockMap.addLayer.mock.calls.map(([layer]) => (layer as { paint: { "line-color": string } }).paint["line-color"]);
      expect(new Set(colors).size).toBe(2);
    });

    it("does not consume arrow keys so the map can pan", () => {
      setup({ gpxFiles: [track1], selectedGpxIds: new Set(["t1"]) });
      press(" ");
      const evt = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
      document.body.dispatchEvent(evt);
      expect(evt.defaultPrevented).toBe(false);
    });

    it("tears the map down on close", () => {
      setup({ gpxFiles: [track1], selectedGpxIds: new Set(["t1"]) });
      press(" ");
      press("Escape");
      expect(mockMap.remove).toHaveBeenCalledTimes(1);
    });

    it("asks for a Mapbox key when none is saved", () => {
      setup({ gpxFiles: [track1], selectedGpxIds: new Set(["t1"]) }, { mapboxToken: null });
      press(" ");
      expect(screen.getByText(/Mapbox API key is required/)).toBeInTheDocument();
      expect(mapCtor).not.toHaveBeenCalled();
    });
  });
});
