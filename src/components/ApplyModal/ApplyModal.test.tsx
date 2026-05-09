import { render, screen, act } from "@testing-library/react";
import { vi, beforeEach, afterEach, describe, it, expect } from "vitest";
import { ApplyModal } from "./ApplyModal";
import type { ApplyPhase } from "./ApplyModal";

vi.mock("../../lib/tauri", () => ({
  tauriCommands: {
    applyCancel: vi.fn().mockResolvedValue(undefined),
  },
}));

const onCancel = vi.fn();
const onDismiss = vi.fn();

beforeEach(() => {
  onCancel.mockClear();
  onDismiss.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ApplyModal — idle phase", () => {
  it("renders nothing when phase is idle", () => {
    const { container } = render(
      <ApplyModal phase={{ type: "idle" }} onCancel={onCancel} onDismiss={onDismiss} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ApplyModal — applying phase", () => {
  const phase: ApplyPhase = { type: "applying", done: 3, total: 10, errors: [] };

  it("shows progress count", () => {
    render(<ApplyModal phase={phase} onCancel={onCancel} onDismiss={onDismiss} />);
    expect(screen.getByText(/writing 3 of 10/i)).toBeTruthy();
  });

  it("shows a Cancel button", () => {
    render(<ApplyModal phase={phase} onCancel={onCancel} onDismiss={onDismiss} />);
    expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
  });

  it("does not show a Dismiss button", () => {
    render(<ApplyModal phase={phase} onCancel={onCancel} onDismiss={onDismiss} />);
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
  });
});

describe("ApplyModal — undoing phase", () => {
  const phase: ApplyPhase = { type: "undoing", done: 2, total: 5 };

  it("shows undo progress count", () => {
    render(<ApplyModal phase={phase} onCancel={onCancel} onDismiss={onDismiss} />);
    expect(screen.getByText(/undoing 2 of 5/i)).toBeTruthy();
  });

  it("does not show a Cancel button", () => {
    render(<ApplyModal phase={phase} onCancel={onCancel} onDismiss={onDismiss} />);
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
  });
});

describe("ApplyModal — complete with no errors", () => {
  const phase: ApplyPhase = { type: "complete", errors: [] };

  it("shows success message", () => {
    render(<ApplyModal phase={phase} onCancel={onCancel} onDismiss={onDismiss} />);
    expect(screen.getByText(/all photos written successfully/i)).toBeTruthy();
  });

  it("auto-dismisses after 1500ms", () => {
    render(<ApplyModal phase={phase} onCancel={onCancel} onDismiss={onDismiss} />);
    expect(onDismiss).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1500); });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("does not auto-dismiss before 1500ms", () => {
    render(<ApplyModal phase={phase} onCancel={onCancel} onDismiss={onDismiss} />);
    act(() => { vi.advanceTimersByTime(1499); });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("ApplyModal — complete with errors", () => {
  const phase: ApplyPhase = {
    type: "complete",
    errors: [
      { photoId: "p1", filePath: "/photos/img1.jpg", error: "Permission denied" },
      { photoId: "p2", filePath: "/photos/img2.jpg", error: "File not found" },
    ],
  };

  it("shows error count in title", () => {
    render(<ApplyModal phase={phase} onCancel={onCancel} onDismiss={onDismiss} />);
    expect(screen.getByText(/2 file\(s\) could not be written/i)).toBeTruthy();
  });

  it("lists each failed file path", () => {
    render(<ApplyModal phase={phase} onCancel={onCancel} onDismiss={onDismiss} />);
    expect(screen.getByText("/photos/img1.jpg")).toBeTruthy();
    expect(screen.getByText("/photos/img2.jpg")).toBeTruthy();
  });

  it("lists error messages", () => {
    render(<ApplyModal phase={phase} onCancel={onCancel} onDismiss={onDismiss} />);
    expect(screen.getByText("Permission denied")).toBeTruthy();
    expect(screen.getByText("File not found")).toBeTruthy();
  });

  it("shows a Dismiss button", () => {
    render(<ApplyModal phase={phase} onCancel={onCancel} onDismiss={onDismiss} />);
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeTruthy();
  });

  it("does not auto-dismiss", () => {
    render(<ApplyModal phase={phase} onCancel={onCancel} onDismiss={onDismiss} />);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("ApplyModal — cancelled phase", () => {
  const phase: ApplyPhase = { type: "cancelled" };

  it("shows cancellation message", () => {
    render(<ApplyModal phase={phase} onCancel={onCancel} onDismiss={onDismiss} />);
    expect(screen.getByText(/changes cancelled/i)).toBeTruthy();
  });

  it("shows a Dismiss button", () => {
    render(<ApplyModal phase={phase} onCancel={onCancel} onDismiss={onDismiss} />);
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeTruthy();
  });

  it("does not show a Cancel button", () => {
    render(<ApplyModal phase={phase} onCancel={onCancel} onDismiss={onDismiss} />);
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
  });
});
