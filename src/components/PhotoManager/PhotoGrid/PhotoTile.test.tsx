import { render, screen, fireEvent } from "@testing-library/react";
import { vi, beforeEach, describe, it, expect } from "vitest";
import { PhotoTile } from "./PhotoTile";
import type { Photo, Metadata } from "../../../state/SessionContext";

vi.mock("../../../state/SessionContext", () => ({
  useSession: vi.fn(),
}));

vi.mock("../../../lib/tauri", () => ({
  tauriCommands: {
    removePhotos: vi.fn().mockResolvedValue(undefined),
  },
}));

import { useSession } from "../../../state/SessionContext";
import { tauriCommands } from "../../../lib/tauri";

const mockDispatch = vi.fn();

beforeEach(() => {
  mockDispatch.mockClear();
  vi.mocked(tauriCommands.removePhotos).mockClear();
  vi.mocked(useSession).mockReturnValue({
    state: {
      photos: [], selectedIds: new Set(), gpxFiles: [], selectedGpxId: null,
      applyInProgress: false, canRollback: false,
    },
    dispatch: mockDispatch,
  });
});

const nullMeta: Metadata = {
  captureDate: null, captureTime: null, utcOffset: null, timezone: null,
  gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null, lens: null, filmVendor: null, filmType: null,
};

function makePhoto(overrides: Partial<Photo> = {}): Photo {
  return {
    id: "test-id",
    filePath: "/photos/test.jpg",
    fileStatus: "ok",
    thumbnail: { small: "/thumbs/test_small.jpg", large: "/thumbs/test_large.jpg" },
    originalMetadata: nullMeta,
    currentMetadata: nullMeta,
    pendingChanges: null,
    ...overrides,
  };
}

const noop = () => {};
const defaultProps = { isSelected: false, isDragging: false, dropZone: null as null, onClick: noop };

describe("PhotoTile", () => {
  describe("when fileStatus is ok", () => {
    it("renders an img element", () => {
      render(<PhotoTile photo={makePhoto()} tilePx={200} {...defaultProps} />);
      expect(screen.getByRole("img")).toBeInTheDocument();
    });

    it("uses thumbnail.small when tilePx <= 400", () => {
      render(<PhotoTile photo={makePhoto()} tilePx={200} {...defaultProps} />);
      expect(screen.getByRole("img")).toHaveAttribute("src", "/thumbs/test_small.jpg");
    });

    it("uses thumbnail.large when tilePx > 400", () => {
      render(<PhotoTile photo={makePhoto()} tilePx={600} {...defaultProps} />);
      expect(screen.getByRole("img")).toHaveAttribute("src", "/thumbs/test_large.jpg");
    });

    it("uses thumbnail.small at exactly 400px", () => {
      render(<PhotoTile photo={makePhoto()} tilePx={400} {...defaultProps} />);
      expect(screen.getByRole("img")).toHaveAttribute("src", "/thumbs/test_small.jpg");
    });

    it("does not render the missing-file message", () => {
      render(<PhotoTile photo={makePhoto()} tilePx={200} {...defaultProps} />);
      expect(screen.queryByText("File not found")).not.toBeInTheDocument();
    });
  });

  describe("when fileStatus is missing", () => {
    it("renders the File not found text", () => {
      render(<PhotoTile photo={makePhoto({ fileStatus: "missing" })} tilePx={200} {...defaultProps} />);
      expect(screen.getByText("File not found")).toBeInTheDocument();
    });

    it("does not render an img", () => {
      render(<PhotoTile photo={makePhoto({ fileStatus: "missing" })} tilePx={200} {...defaultProps} />);
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });
  });

  describe("pending dot", () => {
    it("is absent when pendingChanges is null", () => {
      const { container } = render(<PhotoTile photo={makePhoto()} tilePx={200} {...defaultProps} />);
      // The pending dot is a <span> with no text content — check via its CSS module class
      // We can detect it by checking the absence of any <span> sibling to the img
      const spans = container.querySelectorAll("span");
      expect(spans).toHaveLength(0);
    });

    it("is present when pendingChanges is non-null", () => {
      const photo = makePhoto({ pendingChanges: { captureDate: "2024-01-01" } });
      const { container } = render(<PhotoTile photo={photo} tilePx={200} {...defaultProps} />);
      const spans = container.querySelectorAll("span");
      expect(spans.length).toBeGreaterThan(0);
    });
  });

  describe("missing file remove button", () => {
    it("is not rendered for ok photos", () => {
      render(<PhotoTile photo={makePhoto()} tilePx={200} {...defaultProps} />);
      expect(screen.queryByTitle("Remove from session")).not.toBeInTheDocument();
    });

    it("is rendered for missing photos", () => {
      render(<PhotoTile photo={makePhoto({ fileStatus: "missing" })} tilePx={200} {...defaultProps} />);
      expect(screen.getByTitle("Remove from session")).toBeInTheDocument();
    });

    it("dispatches REMOVE_PHOTOS with the photo id on click", () => {
      render(<PhotoTile photo={makePhoto({ fileStatus: "missing" })} tilePx={200} {...defaultProps} />);
      fireEvent.click(screen.getByTitle("Remove from session"));
      expect(mockDispatch).toHaveBeenCalledWith({ type: "REMOVE_PHOTOS", ids: ["test-id"] });
    });

    it("calls tauriCommands.removePhotos on click", () => {
      render(<PhotoTile photo={makePhoto({ fileStatus: "missing" })} tilePx={200} {...defaultProps} />);
      fireEvent.click(screen.getByTitle("Remove from session"));
      expect(vi.mocked(tauriCommands.removePhotos)).toHaveBeenCalledWith(["test-id"]);
    });

    it("does not propagate click to the tile", () => {
      const tileClick = vi.fn();
      render(<PhotoTile photo={makePhoto({ fileStatus: "missing" })} tilePx={200} {...defaultProps} onClick={tileClick} />);
      fireEvent.click(screen.getByTitle("Remove from session"));
      expect(tileClick).not.toHaveBeenCalled();
    });
  });
});
