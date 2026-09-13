import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { UIProvider } from "../../../state/UIContext";
import { ErrorModal } from "./ErrorModal";
import { reportError } from "../../../lib/errors";

// End-to-end path for issue #8: a rejected backend command reported via
// reportError must surface in the ErrorModal (UIProvider registers the
// handler), since production builds have no console or DevLog.
describe("ErrorModal", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderModal() {
    return render(
      <UIProvider>
        <ErrorModal />
      </UIProvider>
    );
  }

  it("is hidden until an error is reported", () => {
    renderModal();
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
  });

  it("shows a reported backend failure and dismisses on click", () => {
    renderModal();

    act(() => {
      reportError("Failed to save date/time edits", "exiftool exited with status 1");
    });

    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(
      screen.getByText(/Failed to save date\/time edits/)
    ).toBeInTheDocument();
    expect(screen.getByText(/exiftool exited with status 1/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Dismiss"));
    expect(screen.queryByText("Error")).not.toBeInTheDocument();
  });
});
