import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import { FilterControls } from "./FilterControls";
import type { SessionState, Photo, Metadata } from "../../../state/SessionContext";
import type { UIState } from "../../../state/UIContext";
import { cameraKeyOf } from "../../../state/selectors";

vi.mock("../../../state/SessionContext", () => ({
  useSession: vi.fn(),
}));

vi.mock("../../../state/UIContext", () => ({
  useUI: vi.fn(),
}));

import { useSession } from "../../../state/SessionContext";
import { useUI } from "../../../state/UIContext";

const nullMeta: Metadata = {
  captureDate: null, captureTime: null, utcOffset: null, timezone: null,
  gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null, lens: null, filmVendor: null, filmType: null,
};

function makePhoto(id: string, overrides: Partial<Metadata> = {}): Photo {
  return {
    id,
    filePath: `/photos/${id}.jpg`,
    fileStatus: "ok",
    thumbnail: { small: "", large: "" },
    originalMetadata: { ...nullMeta, ...overrides },
    currentMetadata: { ...nullMeta, ...overrides },
    pendingChanges: null,
  };
}

const emptySessionState: SessionState = {
  photos: [],
  selectedIds: new Set(),
  gpxFiles: [],
  selectedGpxId: null,
  applyInProgress: false,
  canRollback: false,
  metadataHistory: [],
};

const defaultUIState: UIState = {
  workingTimezone: "America/Los_Angeles",
  gridColumns: 5,
  panelWidth: 800,
  mapPanelHeight: 200,
  photoFilters: { dateAfter: null, dateBefore: null, cameras: null },
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
  vi.mocked(useSession).mockReturnValue({
    state: { ...emptySessionState, ...sessionOverrides },
    dispatch: vi.fn(),
  });
  vi.mocked(useUI).mockReturnValue({
    state: { ...defaultUIState, ...uiOverrides },
    dispatch: uiDispatch,
  });
  return { uiDispatch };
}

const photos = [
  makePhoto("a", { captureDate: "2024-03-14", cameraMake: "Canon", cameraModel: "EOS R5" }),
  makePhoto("b", { captureDate: "2024-03-16", cameraMake: "Nikon", cameraModel: "F3" }),
  makePhoto("c"),
];

describe("FilterControls", () => {
  it("renders nothing when there are no photos", () => {
    setupMocks();
    const { container } = render(<FilterControls />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows Time and Camera dropdown buttons when photos exist", () => {
    setupMocks({ photos });
    render(<FilterControls />);
    expect(screen.getByText(/Time/)).toBeInTheDocument();
    expect(screen.getByText(/Camera/)).toBeInTheDocument();
  });

  it("opens the camera panel listing values from the full photo set", () => {
    setupMocks({ photos });
    render(<FilterControls />);
    fireEvent.click(screen.getByText(/Camera/));
    expect(screen.getByText("Canon EOS R5")).toBeInTheDocument();
    expect(screen.getByText("Nikon F3")).toBeInTheDocument();
    expect(screen.getByText("No camera")).toBeInTheDocument();
  });

  it("dispatches a camera filter when a value is checked", () => {
    const { uiDispatch } = setupMocks({ photos });
    render(<FilterControls />);
    fireEvent.click(screen.getByText(/Camera/));
    fireEvent.click(screen.getByText("Canon EOS R5"));
    expect(uiDispatch).toHaveBeenCalledWith({
      type: "SET_PHOTO_FILTERS",
      filters: { cameras: [cameraKeyOf(photos[0].currentMetadata)] },
    });
  });

  it("clears the camera filter when the last value is unchecked", () => {
    const key = cameraKeyOf(photos[0].currentMetadata);
    const { uiDispatch } = setupMocks(
      { photos },
      { photoFilters: { dateAfter: null, dateBefore: null, cameras: [key] } },
    );
    render(<FilterControls />);
    fireEvent.click(screen.getByText(/Camera/));
    fireEvent.click(screen.getByText("Canon EOS R5"));
    expect(uiDispatch).toHaveBeenCalledWith({
      type: "SET_PHOTO_FILTERS",
      filters: { cameras: null },
    });
  });

  it("defaults the time panel to the first and last photo dates", () => {
    setupMocks({ photos });
    render(<FilterControls />);
    fireEvent.click(screen.getByText(/Time/));
    expect(screen.getByLabelText("On or after")).toHaveValue("2024-03-14");
    expect(screen.getByLabelText("On or before")).toHaveValue("2024-03-16");
  });

  it("shows the set filter value over the default", () => {
    setupMocks(
      { photos },
      { photoFilters: { dateAfter: "2024-03-15", dateBefore: null, cameras: null } },
    );
    render(<FilterControls />);
    fireEvent.click(screen.getByText(/Time/));
    expect(screen.getByLabelText("On or after")).toHaveValue("2024-03-15");
    expect(screen.getByLabelText("On or before")).toHaveValue("2024-03-16");
  });

  it("dispatches date filters from the time panel", () => {
    const { uiDispatch } = setupMocks({ photos });
    render(<FilterControls />);
    fireEvent.click(screen.getByText(/Time/));
    const afterInput = screen.getByLabelText("On or after");
    fireEvent.change(afterInput, { target: { value: "2024-03-15" } });
    expect(uiDispatch).toHaveBeenCalledWith({
      type: "SET_PHOTO_FILTERS",
      filters: { dateAfter: "2024-03-15" },
    });
  });

  it("resets the time panel via its Reset button", () => {
    const { uiDispatch } = setupMocks(
      { photos },
      { photoFilters: { dateAfter: "2024-03-15", dateBefore: null, cameras: null } },
    );
    render(<FilterControls />);
    fireEvent.click(screen.getByText(/Time/));
    fireEvent.click(screen.getByText("Reset"));
    expect(uiDispatch).toHaveBeenCalledWith({
      type: "SET_PHOTO_FILTERS",
      filters: { dateAfter: null, dateBefore: null },
    });
  });

  it("shows the global clear button only when a filter is active, and resets all", () => {
    setupMocks({ photos });
    const { unmount } = render(<FilterControls />);
    expect(screen.queryByText("Clear Filters")).not.toBeInTheDocument();
    unmount();

    const { uiDispatch } = setupMocks(
      { photos },
      { photoFilters: { dateAfter: "2024-03-15", dateBefore: null, cameras: null } },
    );
    render(<FilterControls />);
    fireEvent.click(screen.getByText("Clear Filters"));
    expect(uiDispatch).toHaveBeenCalledWith({ type: "RESET_PHOTO_FILTERS" });
  });
});
