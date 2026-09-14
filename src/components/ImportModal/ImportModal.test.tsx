import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ImportModal } from "./ImportModal";

describe("ImportModal", () => {
  describe("when isOpen is false", () => {
    it("renders nothing", () => {
      const { container } = render(
        <ImportModal isOpen={false} done={0} total={0} errors={[]} onDismiss={vi.fn()} />,
      );
      expect(container.firstChild).toBeNull();
    });
  });

  describe("when isOpen is true", () => {
    it("renders the Importing Photos heading", () => {
      render(<ImportModal isOpen done={0} total={5} errors={[]} onDismiss={vi.fn()} />);
      expect(screen.getByText("Importing Photos")).toBeInTheDocument();
    });

    it("uses refresh wording for the refresh variant", () => {
      render(<ImportModal isOpen variant="refresh" done={0} total={5} errors={[]} onDismiss={vi.fn()} />);
      expect(screen.getByText("Refreshing Metadata")).toBeInTheDocument();
    });

    it("reports how many photos were refreshed when a refresh is cancelled", () => {
      render(
        <ImportModal isOpen variant="refresh" done={2} total={5} isComplete isCancelled errors={["x"]} onDismiss={vi.fn()} />,
      );
      expect(screen.getByText("Refresh Cancelled")).toBeInTheDocument();
      expect(screen.getByText(/2 of 5 refreshed/)).toBeInTheDocument();
    });

    it("shows done / total count", () => {
      render(<ImportModal isOpen done={2} total={5} errors={[]} onDismiss={vi.fn()} />);
      expect(screen.getByText("2 of 5")).toBeInTheDocument();
    });

    it("renders error strings when errors are present", () => {
      render(
        <ImportModal
          isOpen
          done={1}
          total={2}
          errors={["photo.heic: no preview", "photo2.cr3: decode failed"]}
          onDismiss={vi.fn()}
        />,
      );
      const errorLog = document.querySelector("pre");
      expect(errorLog?.textContent).toContain("photo.heic: no preview");
      expect(errorLog?.textContent).toContain("photo2.cr3: decode failed");
    });

    it("does not show the Done button while import is in progress", () => {
      render(<ImportModal isOpen done={2} total={5} errors={[]} onDismiss={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    });

    it("shows the Done button when complete with errors", () => {
      render(
        <ImportModal isOpen done={3} total={3} errors={["one error"]} onDismiss={vi.fn()} />,
      );
      expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    });

    it("does not show the Done button when complete with no errors", () => {
      render(<ImportModal isOpen done={3} total={3} errors={[]} onDismiss={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "Done" })).not.toBeInTheDocument();
    });

    it("calls onDismiss when Done button is clicked", async () => {
      const onDismiss = vi.fn();
      render(
        <ImportModal isOpen done={2} total={2} errors={["err"]} onDismiss={onDismiss} />,
      );
      await userEvent.click(screen.getByRole("button", { name: "Done" }));
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it("auto-dismisses after 600ms when complete with no errors", () => {
      vi.useFakeTimers();
      const onDismiss = vi.fn();
      render(<ImportModal isOpen done={3} total={3} errors={[]} onDismiss={onDismiss} />);
      expect(onDismiss).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(600));
      expect(onDismiss).toHaveBeenCalledOnce();
      vi.useRealTimers();
    });

    it("shows a Cancel button while import is in progress", () => {
      render(
        <ImportModal isOpen done={2} total={5} errors={[]} onCancel={vi.fn()} onDismiss={vi.fn()} />,
      );
      expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    });

    it("does not show a Cancel button when onCancel is not provided", () => {
      render(<ImportModal isOpen done={2} total={5} errors={[]} onDismiss={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    });

    it("calls onCancel when Cancel is clicked", async () => {
      const onCancel = vi.fn();
      render(
        <ImportModal isOpen done={2} total={5} errors={[]} onCancel={onCancel} onDismiss={vi.fn()} />,
      );
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onCancel).toHaveBeenCalledOnce();
    });

    it("disables the Cancel button and shows Cancelling while a cancel is pending", () => {
      render(
        <ImportModal
          isOpen
          done={2}
          total={5}
          isCancelling
          errors={[]}
          onCancel={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      expect(screen.getByText("Cancelling Import…")).toBeInTheDocument();
      const button = screen.getByRole("button", { name: "Cancelling…" });
      expect(button).toBeDisabled();
    });

    it("hides the Cancel button once the import is complete", () => {
      render(
        <ImportModal
          isOpen
          done={5}
          total={5}
          isComplete
          errors={["err"]}
          onCancel={vi.fn()}
          onDismiss={vi.fn()}
        />,
      );
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    });

    it("shows the cancelled state and auto-dismisses when cancelled without errors", () => {
      vi.useFakeTimers();
      const onDismiss = vi.fn();
      render(
        <ImportModal
          isOpen
          done={2}
          total={5}
          isComplete
          isCancelled
          errors={[]}
          onCancel={vi.fn()}
          onDismiss={onDismiss}
        />,
      );
      expect(screen.getByText("Import Cancelled")).toBeInTheDocument();
      expect(screen.getByText("Imported photos removed")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
      act(() => vi.advanceTimersByTime(600));
      expect(onDismiss).toHaveBeenCalledOnce();
      vi.useRealTimers();
    });

    it("does not auto-dismiss when complete but errors are present", () => {
      vi.useFakeTimers();
      const onDismiss = vi.fn();
      render(
        <ImportModal isOpen done={3} total={3} errors={["error"]} onDismiss={onDismiss} />,
      );
      act(() => vi.advanceTimersByTime(1000));
      expect(onDismiss).not.toHaveBeenCalled();
      vi.useRealTimers();
    });
  });
});
