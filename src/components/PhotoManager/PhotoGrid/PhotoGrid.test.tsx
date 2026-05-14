import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { PhotoGrid } from "./PhotoGrid";
import type { SessionState } from "../../../state/SessionContext";
import type { UIState } from "../../../state/UIContext";

vi.mock("../../../state/SessionContext", () => ({
  useSession: vi.fn(),
}));

vi.mock("../../../state/UIContext", () => ({
  useUI: vi.fn(),
}));

import { useSession } from "../../../state/SessionContext";
import { useUI } from "../../../state/UIContext";

const emptySessionState: SessionState = {
  photos: [],
  selectedIds: new Set(),
  gpxFiles: [], selectedGpxId: null,
  applyInProgress: false,
  canRollback: false,
};

const defaultUIState: UIState = {
  workingTimezone: "America/Los_Angeles",
  gridColumns: 5,
  panelWidth: 800,
  mapPanelHeight: 200,
  mapboxToken: null,
  claudeApiKey: null,
  error: null,
};

function setupMocks(
  sessionOverrides: Partial<SessionState> = {},
  uiOverrides: Partial<UIState> = {},
) {
  vi.mocked(useSession).mockReturnValue({
    state: { ...emptySessionState, ...sessionOverrides },
    dispatch: vi.fn(),
  });
  vi.mocked(useUI).mockReturnValue({
    state: { ...defaultUIState, ...uiOverrides },
    dispatch: vi.fn(),
  });
}

describe("PhotoGrid", () => {
  it("shows the empty state when there are no photos", () => {
    setupMocks();
    render(<PhotoGrid />);
    expect(screen.getByText("No photos imported")).toBeInTheDocument();
  });

  it("does not show the empty state when photos are present", () => {
    setupMocks({
      photos: [
        {
          id: "p1",
          filePath: "/p1.jpg",
          fileStatus: "ok",
          thumbnail: { small: "/s.jpg", large: "/l.jpg" },
          originalMetadata: {
            captureDate: null, captureTime: null, utcOffset: null, timezone: null,
            gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null, lens: null, filmVendor: null, filmType: null,
          },
          currentMetadata: {
            captureDate: null, captureTime: null, utcOffset: null, timezone: null,
            gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null, lens: null, filmVendor: null, filmType: null,
          },
          pendingChanges: null,
        },
      ],
    });
    render(<PhotoGrid />);
    expect(screen.queryByText("No photos imported")).not.toBeInTheDocument();
  });

  it("renders one PhotoTile per photo", () => {
    setupMocks({
      photos: [
        {
          id: "p1", filePath: "/p1.jpg", fileStatus: "ok",
          thumbnail: { small: "/s1.jpg", large: "/l1.jpg" },
          originalMetadata: { captureDate: null, captureTime: null, utcOffset: null, timezone: null, gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null, lens: null, filmVendor: null, filmType: null },
          currentMetadata: { captureDate: null, captureTime: null, utcOffset: null, timezone: null, gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null, lens: null, filmVendor: null, filmType: null },
          pendingChanges: null,
        },
        {
          id: "p2", filePath: "/p2.jpg", fileStatus: "ok",
          thumbnail: { small: "/s2.jpg", large: "/l2.jpg" },
          originalMetadata: { captureDate: null, captureTime: null, utcOffset: null, timezone: null, gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null, lens: null, filmVendor: null, filmType: null },
          currentMetadata: { captureDate: null, captureTime: null, utcOffset: null, timezone: null, gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null, lens: null, filmVendor: null, filmType: null },
          pendingChanges: null,
        },
      ],
    });
    render(<PhotoGrid />);
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });
});
