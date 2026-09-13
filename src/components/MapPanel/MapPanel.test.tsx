import { render, screen, fireEvent } from "@testing-library/react";
import { vi, beforeEach } from "vitest";
import { MapPanel, buildPhotoGeoJSON } from "./MapPanel";
import type { SessionState } from "../../state/SessionContext";
import type { UIState } from "../../state/UIContext";

const mockMapInstance = {
  on: vi.fn(),
  once: vi.fn(),
  remove: vi.fn(),
  isStyleLoaded: vi.fn(() => false),
  getSource: vi.fn((_id: string): unknown => null),
  getStyle: vi.fn(() => ({ sources: {} })),
  getLayer: vi.fn((_id: string): unknown => undefined),
  addSource: vi.fn(),
  addLayer: vi.fn(),
  removeLayer: vi.fn(),
  removeSource: vi.fn(),
  flyTo: vi.fn(),
};

// Invoke and clear every deferred sync queued via map.once("idle", ...)
function flushIdleCallbacks() {
  const cbs = mockMapInstance.once.mock.calls
    .filter(([event]) => event === "idle")
    .map(([, cb]) => cb as () => void);
  mockMapInstance.once.mockClear();
  cbs.forEach((cb) => cb());
}

vi.mock("mapbox-gl", () => {
  return {
    default: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Map: function (this: any) { return mockMapInstance; },
      accessToken: "",
    },
  };
});

vi.mock("mapbox-gl/dist/mapbox-gl.css", () => ({}));

vi.mock("../../state/SessionContext", () => ({
  useSession: vi.fn(),
}));

vi.mock("../../state/UIContext", () => ({
  useUI: vi.fn(),
}));

import { useSession } from "../../state/SessionContext";
import { useUI } from "../../state/UIContext";

const nullMeta = {
  captureDate: null,
  captureTime: null,
  utcOffset: null,
  timezone: null,
  gpsLat: null,
  gpsLng: null,
  cameraMake: null,
  cameraModel: null,
  lens: null,
  filmVendor: null,
  filmType: null,
};

const emptySession: SessionState = {
  photos: [],
  selectedIds: new Set(),
  gpxFiles: [], selectedGpxId: null,
  applyInProgress: false,
  canRollback: false,
  metadataHistory: [],
};

const defaultUI: UIState = {
  workingTimezone: "America/Los_Angeles",
  gridColumns: 5,
  panelWidth: 800,
  mapPanelHeight: 200,
  mapboxToken: null,
  googleMapsKey: null,
  claudeApiKey: null,
  error: null,
};

function setupMocks(
  sessionOverrides: Partial<SessionState> = {},
  uiOverrides: Partial<UIState> = {},
) {
  const uiDispatch = vi.fn();
  const onOpenSettings = vi.fn();
  vi.mocked(useSession).mockReturnValue({
    state: { ...emptySession, ...sessionOverrides },
    dispatch: vi.fn(),
  });
  vi.mocked(useUI).mockReturnValue({
    state: { ...defaultUI, ...uiOverrides },
    dispatch: uiDispatch,
  });
  return { uiDispatch, onOpenSettings };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MapPanel", () => {
  it("shows token prompt when mapboxToken is null", () => {
    const { onOpenSettings } = setupMocks();
    render(<MapPanel onOpenSettings={onOpenSettings} />);
    expect(
      screen.getByText("A Mapbox API key is required to enable the map.")
    ).toBeInTheDocument();
  });

  it("shows Open Settings button in no-key state", () => {
    const { onOpenSettings } = setupMocks();
    render(<MapPanel onOpenSettings={onOpenSettings} />);
    expect(screen.getByRole("button", { name: "Open Settings" })).toBeInTheDocument();
  });

  it("calls onOpenSettings when Open Settings button is clicked", () => {
    const { onOpenSettings } = setupMocks();
    render(<MapPanel onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Settings" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("does not show token prompt when mapboxToken is set", () => {
    const { onOpenSettings } = setupMocks({}, { mapboxToken: "pk.test" });
    render(<MapPanel onOpenSettings={onOpenSettings} />);
    expect(
      screen.queryByText("A Mapbox API key is required to enable the map.")
    ).not.toBeInTheDocument();
  });

  it("renders map container div when token is present", () => {
    const { onOpenSettings } = setupMocks({}, { mapboxToken: "pk.test" });
    const { container } = render(<MapPanel onOpenSettings={onOpenSettings} />);
    expect(container.querySelector("[class*='map']")).toBeInTheDocument();
  });

  it("shows secret-token prompt instead of map when token starts with sk. (Bug #2/#3)", () => {
    const { onOpenSettings } = setupMocks({}, { mapboxToken: "sk.eyJleHByaXZhdGU" });
    render(<MapPanel onOpenSettings={onOpenSettings} />);
    expect(screen.getByText(/secret token/i)).toBeInTheDocument();
    // The Open Settings button must be reachable so the user can fix the token.
    const btn = screen.getByRole("button", { name: "Open Settings" });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  describe("gpx layer sync (Issue #25)", () => {
    const gpxFile = {
      id: "g1",
      filePath: "/tracks/hike.gpx",
      addedAt: 1,
      trackPoints: [{ lat: 37.77, lng: -122.42, timestamp: 1000 }],
      thumbnailPath: null,
      timezone: null,
    };

    it("removes gpx layers on session clear even while the style is mid-load", () => {
      // isStyleLoaded() stays false throughout (the mock default), simulating a
      // map still streaming tiles — the sync must defer, not drop.
      const { onOpenSettings } = setupMocks(
        { gpxFiles: [gpxFile] },
        { mapboxToken: "pk.test" }
      );
      const { rerender } = render(<MapPanel onOpenSettings={onOpenSettings} />);
      flushIdleCallbacks();
      expect(mockMapInstance.addSource).toHaveBeenCalledWith(
        "gpx-g1",
        expect.objectContaining({ type: "geojson" })
      );
      expect(mockMapInstance.addLayer).toHaveBeenCalledWith(
        expect.objectContaining({ id: "gpx-line-g1" }),
        undefined
      );

      // Clear the session: gpxFiles goes empty while the style is still not loaded.
      mockMapInstance.getLayer.mockImplementation((id: string) =>
        id === "gpx-line-g1" ? {} : undefined
      );
      mockMapInstance.getSource.mockImplementation((id: string) =>
        id === "gpx-g1" ? {} : null
      );
      setupMocks({ gpxFiles: [] }, { mapboxToken: "pk.test" });
      rerender(<MapPanel onOpenSettings={onOpenSettings} />);
      flushIdleCallbacks();

      expect(mockMapInstance.removeLayer).toHaveBeenCalledWith("gpx-line-g1");
      expect(mockMapInstance.removeSource).toHaveBeenCalledWith("gpx-g1");
    });
  });

  describe("drag handle", () => {
    it("dispatches SET_MAP_PANEL_HEIGHT when dragging upward", () => {
      const { uiDispatch, onOpenSettings } = setupMocks({}, { mapPanelHeight: 200 });
      const { container } = render(<MapPanel onOpenSettings={onOpenSettings} />);
      const dragHandle = container.querySelector(
        "[class*='resizeZone']"
      ) as HTMLElement;
      fireEvent.mouseDown(dragHandle, { clientY: 100 });
      fireEvent.mouseMove(window, { clientY: 70 });
      expect(uiDispatch).toHaveBeenCalledWith({
        type: "SET_MAP_PANEL_HEIGHT",
        height: 230,
      });
    });
  });
});

describe("buildPhotoGeoJSON", () => {
  it("excludes photos without GPS coordinates", () => {
    const photos = [
      {
        id: "p1",
        filePath: "/p1.jpg",
        fileStatus: "ok" as const,
        thumbnail: { small: "", large: "" },
        originalMetadata: nullMeta,
        currentMetadata: { ...nullMeta, gpsLat: null, gpsLng: null },
        pendingChanges: null,
      },
    ];
    const result = buildPhotoGeoJSON(photos);
    expect(result.features).toHaveLength(0);
  });

  it("includes photos with GPS coordinates as Point features", () => {
    const photos = [
      {
        id: "p2",
        filePath: "/p2.jpg",
        fileStatus: "ok" as const,
        thumbnail: { small: "", large: "" },
        originalMetadata: nullMeta,
        currentMetadata: { ...nullMeta, gpsLat: 37.7749, gpsLng: -122.4194 },
        pendingChanges: null,
      },
    ];
    const result = buildPhotoGeoJSON(photos);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].geometry).toEqual({
      type: "Point",
      coordinates: [-122.4194, 37.7749],
    });
  });

  it("sets properties.id from the photo id", () => {
    const photos = [
      {
        id: "photo-123",
        filePath: "/p.jpg",
        fileStatus: "ok" as const,
        thumbnail: { small: "", large: "" },
        originalMetadata: nullMeta,
        currentMetadata: { ...nullMeta, gpsLat: 35.6762, gpsLng: 139.6503 },
        pendingChanges: null,
      },
    ];
    const result = buildPhotoGeoJSON(photos);
    expect(result.features[0].properties?.id).toBe("photo-123");
  });

  it("only includes photos where both gpsLat and gpsLng are non-null", () => {
    const photos = [
      {
        id: "has-both",
        filePath: "/a.jpg",
        fileStatus: "ok" as const,
        thumbnail: { small: "", large: "" },
        originalMetadata: nullMeta,
        currentMetadata: { ...nullMeta, gpsLat: 1.0, gpsLng: 2.0 },
        pendingChanges: null,
      },
      {
        id: "lat-only",
        filePath: "/b.jpg",
        fileStatus: "ok" as const,
        thumbnail: { small: "", large: "" },
        originalMetadata: nullMeta,
        currentMetadata: { ...nullMeta, gpsLat: 1.0, gpsLng: null },
        pendingChanges: null,
      },
    ];
    const result = buildPhotoGeoJSON(photos);
    expect(result.features).toHaveLength(1);
    expect(result.features[0].properties?.id).toBe("has-both");
  });
});
