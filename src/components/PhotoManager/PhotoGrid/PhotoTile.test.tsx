import { render, screen } from "@testing-library/react";
import { PhotoTile } from "./PhotoTile";
import type { Photo, Metadata } from "../../../state/SessionContext";

const nullMeta: Metadata = {
  captureDate: null, captureTime: null, utcOffset: null, timezone: null,
  gpsLat: null, gpsLng: null, cameraBody: null, lens: null, film: null,
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
});
