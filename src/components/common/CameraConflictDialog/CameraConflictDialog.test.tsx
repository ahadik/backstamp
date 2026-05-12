import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { CameraConflictDialog } from "./CameraConflictDialog";
import type { CameraConflict } from "../../../hooks/useMetadataInheritance";

const optionBefore = {
  cameraMake: "Nikon",
  cameraModel: "Z9",
  lens: "Nikon Z 50mm f/1.8 S",
  filmVendor: null,
  filmType: null,
};

const optionAfter = {
  cameraMake: "Canon",
  cameraModel: "EOS R5",
  lens: null,
  filmVendor: "Kodak",
  filmType: "Portra 400",
};

const conflict: CameraConflict = {
  draggingIds: ["p1", "p2"],
  optionBefore,
  optionAfter,
};

describe("CameraConflictDialog", () => {
  it("renders both option summaries", () => {
    render(<CameraConflictDialog conflict={conflict} onResolve={vi.fn()} />);
    expect(screen.getByText(/Nikon Z9/)).toBeInTheDocument();
    expect(screen.getByText(/Canon EOS R5/)).toBeInTheDocument();
  });

  it("renders Before and After labels", () => {
    render(<CameraConflictDialog conflict={conflict} onResolve={vi.fn()} />);
    expect(screen.getByText("Before")).toBeInTheDocument();
    expect(screen.getByText("After")).toBeInTheDocument();
  });

  it("clicking Before calls onResolve with optionBefore", async () => {
    const onResolve = vi.fn();
    render(<CameraConflictDialog conflict={conflict} onResolve={onResolve} />);
    await userEvent.click(screen.getByText("Before").closest("button")!);
    expect(onResolve).toHaveBeenCalledWith(optionBefore);
  });

  it("clicking After calls onResolve with optionAfter", async () => {
    const onResolve = vi.fn();
    render(<CameraConflictDialog conflict={conflict} onResolve={onResolve} />);
    await userEvent.click(screen.getByText("After").closest("button")!);
    expect(onResolve).toHaveBeenCalledWith(optionAfter);
  });

  it("clicking Don't set calls onResolve with null", async () => {
    const onResolve = vi.fn();
    render(<CameraConflictDialog conflict={conflict} onResolve={onResolve} />);
    await userEvent.click(screen.getByText("Don't set"));
    expect(onResolve).toHaveBeenCalledWith(null);
  });

  it("does not render a Cancel button", () => {
    render(<CameraConflictDialog conflict={conflict} onResolve={vi.fn()} />);
    expect(screen.queryByText("Cancel")).not.toBeInTheDocument();
  });
});
