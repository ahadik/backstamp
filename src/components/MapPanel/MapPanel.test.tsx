import { render, screen, fireEvent } from "@testing-library/react";
import { vi, beforeEach } from "vitest";
import { MapPanel, buildPhotoGeoJSON } from "./MapPanel";
import type { SessionState } from "../../state/SessionContext";
import type { UIState } from "../../state/UIContext";

const mockMapInstance = {
  on: vi.fn(),
  remove: vi.fn(),
  isStyleLoaded: vi.fn(() => false),
  getSource: vi.fn(() => null),
  getStyle: vi.fn(() => ({ sources: {} })),
  addSource: vi.fn(),
  addLayer: vi.fn(),
};

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
