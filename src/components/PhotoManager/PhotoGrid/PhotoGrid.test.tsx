import { render, screen, fireEvent } from "@testing-library/react";
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
  gpxFiles: [], selectedGpxIds: new Set(),
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
  const dispatch = vi.fn();
  vi.mocked(useSession).mockReturnValue({
    state: { ...emptySessionState, ...sessionOverrides },
    dispatch,
  });
  vi.mocked(useUI).mockReturnValue({
    state: { ...defaultUIState, ...uiOverrides },
    dispatch: vi.fn(),
  });
  return dispatch;
}

const nullMeta = { captureDate: null, captureTime: null, utcOffset: null, timezone: null, gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null, lens: null, filmVendor: null, filmType: null };
const photoP1 = {
  id: "p1", filePath: "/p1.jpg", fileStatus: "ok" as const,
  thumbnail: { small: "/s1.jpg", large: "/l1.jpg" },
  originalMetadata: nullMeta, currentMetadata: nullMeta, pendingChanges: null,
};

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

  describe("committing inspector edits before a selection change", () => {
    function renderWithInspectorInput() {
      const onBlur = vi.fn();
      render(
        <>
          <div id="inspector-panel">
            <input data-testid="field" onBlur={onBlur} />
          </div>
          <PhotoGrid />
        </>
      );
      const field = screen.getByTestId("field");
      field.focus();
      return { field, onBlur };
    }

    it("blurs a focused inspector field before selecting a clicked tile", () => {
      const dispatch = setupMocks({ photos: [photoP1] });
      const { field, onBlur } = renderWithInspectorInput();
      const order: string[] = [];
      onBlur.mockImplementation(() => order.push("blur"));
      dispatch.mockImplementation((a: { type: string }) => order.push(a.type));

      fireEvent.click(screen.getByRole("img"));

      expect(order).toEqual(["blur", "SELECT_SINGLE"]);
      expect(document.activeElement).not.toBe(field);
    });

    it("leaves ⌘A to the focused inspector field instead of selecting all photos", () => {
      const dispatch = setupMocks({ photos: [photoP1] });
      renderWithInspectorInput();
      fireEvent.keyDown(document, { key: "a", metaKey: true });
      expect(dispatch).not.toHaveBeenCalled();
    });

    it("still selects all photos with ⌘A when the inspector is not focused", () => {
      const dispatch = setupMocks({ photos: [photoP1] });
      render(<PhotoGrid />);
      fireEvent.keyDown(document, { key: "a", metaKey: true });
      expect(dispatch).toHaveBeenCalledWith({ type: "SELECT_ALL", ids: ["p1"] });
    });
  });
});
