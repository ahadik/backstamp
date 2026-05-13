import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { vi, beforeEach, describe, it, expect } from "vitest";
import { VibeTagSection } from "./VibeTagSection";
import type { Photo, Metadata, SessionState } from "../../../state/SessionContext";
import type { UIState } from "../../../state/UIContext";
import type { MetadataProposal } from "../../../lib/vibeTag";

vi.mock("../../../state/SessionContext", () => ({
  useSession: vi.fn(),
}));

vi.mock("../../../state/UIContext", () => ({
  useUI: vi.fn(),
}));

vi.mock("../../../lib/vibeTag", () => ({
  runVibeTag: vi.fn(),
}));

vi.mock("../../../lib/inspectorUtils", () => ({
  deriveFieldValue: vi.fn(() => null),
}));

import { useSession } from "../../../state/SessionContext";
import { useUI } from "../../../state/UIContext";
import { runVibeTag } from "../../../lib/vibeTag";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseMeta: Metadata = {
  captureDate: null, captureTime: null, utcOffset: null, timezone: null,
  gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null,
  lens: null, filmVendor: null, filmType: null,
};

function makePhoto(id = "p1"): Photo {
  return {
    id,
    filePath: `/${id}.jpg`,
    fileStatus: "ok",
    thumbnail: { small: "", large: "" },
    originalMetadata: baseMeta,
    currentMetadata: baseMeta,
    pendingChanges: null,
  };
}

const baseSession: SessionState = {
  photos: [],
  selectedIds: new Set(["p1"]),
  gpxFiles: [],
  selectedGpxId: null,
  applyInProgress: false,
  canRollback: false,
};

const baseUI: UIState = {
  workingTimezone: "America/Los_Angeles",
  gridColumns: 5,
  panelWidth: 800,
  mapPanelHeight: 200,
  mapboxToken: "pk.test",
  claudeApiKey: "sk-ant-test",
};

function setupMocks(
  sessionOverrides: Partial<SessionState> = {},
  uiOverrides: Partial<UIState> = {}
) {
  const sessionDispatch = vi.fn();
  vi.mocked(useSession).mockReturnValue({
    state: { ...baseSession, ...sessionOverrides },
    dispatch: sessionDispatch,
  });
  vi.mocked(useUI).mockReturnValue({
    state: { ...baseUI, ...uiOverrides },
    dispatch: vi.fn(),
  });
  return { sessionDispatch };
}

const onOpenSettings = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

// ── No-key state ──────────────────────────────────────────────────────────────

describe("no-key state", () => {
  it("renders API key required message when claudeApiKey is null", () => {
    setupMocks({}, { claudeApiKey: null });
    render(<VibeTagSection selectedPhotos={[makePhoto()]} onOpenSettings={onOpenSettings} />);
    expect(screen.getByText(/A Claude API key is required/i)).toBeInTheDocument();
  });

  it("Open Settings button calls onOpenSettings", () => {
    setupMocks({}, { claudeApiKey: null });
    render(<VibeTagSection selectedPhotos={[makePhoto()]} onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByRole("button", { name: /open settings/i }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});

// ── Empty selection ───────────────────────────────────────────────────────────

describe("empty selection state", () => {
  it("renders 'Select photos' message when selectedPhotos is empty", () => {
    setupMocks();
    render(<VibeTagSection selectedPhotos={[]} onOpenSettings={onOpenSettings} />);
    expect(screen.getByText(/select photos to use vibe tag/i)).toBeInTheDocument();
  });
});

// ── Normal state ──────────────────────────────────────────────────────────────

describe("normal state", () => {
  it("chat input is visible and enabled", () => {
    setupMocks();
    render(<VibeTagSection selectedPhotos={[makePhoto()]} onOpenSettings={onOpenSettings} />);
    const input = screen.getByRole("textbox");
    expect(input).toBeInTheDocument();
    expect(input).not.toBeDisabled();
  });

  it("send button is disabled when input is empty", () => {
    setupMocks();
    render(<VibeTagSection selectedPhotos={[makePhoto()]} onOpenSettings={onOpenSettings} />);
    expect(screen.getByRole("button", { name: "→" })).toBeDisabled();
  });

  it("pressing Enter on empty input does not call runVibeTag", () => {
    setupMocks();
    render(<VibeTagSection selectedPhotos={[makePhoto()]} onOpenSettings={onOpenSettings} />);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(runVibeTag).not.toHaveBeenCalled();
  });
});

// ── Submit flow ───────────────────────────────────────────────────────────────

describe("submit flow", () => {
  const mockProposal: MetadataProposal = { capture_date: "2025-03-15" };

  it("calls runVibeTag with correct args on Enter", async () => {
    vi.mocked(runVibeTag).mockResolvedValue(mockProposal);
    setupMocks();
    render(<VibeTagSection selectedPhotos={[makePhoto()]} onOpenSettings={onOpenSettings} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "taken in Paris" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(runVibeTag).toHaveBeenCalledWith(
      "sk-ant-test",
      expect.arrayContaining([{ role: "user", content: "taken in Paris" }]),
      1,
      expect.any(Object),
      "pk.test"
    );
  });

  it("shows loading state while request is in flight", async () => {
    let resolve!: (v: MetadataProposal) => void;
    vi.mocked(runVibeTag).mockReturnValue(new Promise((r) => { resolve = r; }));
    setupMocks();
    const { container } = render(<VibeTagSection selectedPhotos={[makePhoto()]} onOpenSettings={onOpenSettings} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "test" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("textbox")).toBeDisabled());
    // While loading, spinner is shown inside the send button (no text "→")
    expect(container.querySelector("[class*='spinner']")).toBeInTheDocument();
    resolve(mockProposal);
  });

  it("shows proposal summary with Accept and Follow Up after success", async () => {
    vi.mocked(runVibeTag).mockResolvedValue(mockProposal);
    setupMocks();
    render(<VibeTagSection selectedPhotos={[makePhoto()]} onOpenSettings={onOpenSettings} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "taken in Paris" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await waitFor(() => expect(screen.getByRole("button", { name: /accept/i })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /follow up/i })).toBeInTheDocument();
    expect(screen.getByText(/2025-03-15/)).toBeInTheDocument();
  });
});

// ── Accept ────────────────────────────────────────────────────────────────────

describe("Accept", () => {
  it("dispatches SET_PENDING and clears proposal + messages", async () => {
    const mockProposal: MetadataProposal = { capture_date: "2025-03-15" };
    vi.mocked(runVibeTag).mockResolvedValue(mockProposal);
    const { sessionDispatch } = setupMocks();
    const photo = makePhoto();
    render(<VibeTagSection selectedPhotos={[photo]} onOpenSettings={onOpenSettings} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "taken in Paris" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    await waitFor(() => screen.getByRole("button", { name: /accept/i }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /accept/i }));
    });

    expect(sessionDispatch).toHaveBeenCalledWith({
      type: "SET_PENDING",
      ids: [photo.id],
      changes: expect.objectContaining({ captureDate: "2025-03-15" }),
    });
    expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();
  });
});

// ── Follow Up ─────────────────────────────────────────────────────────────────

describe("Follow Up", () => {
  it("clears proposal but retains messages for next submit", async () => {
    const mockProposal: MetadataProposal = { capture_date: "2025-03-15" };
    vi.mocked(runVibeTag).mockResolvedValue(mockProposal);
    setupMocks();
    render(<VibeTagSection selectedPhotos={[makePhoto()]} onOpenSettings={onOpenSettings} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "taken in Paris" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    await waitFor(() => screen.getByRole("button", { name: /follow up/i }));

    vi.mocked(runVibeTag).mockResolvedValue({ capture_time: "12:00:00" });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /follow up/i }));
    });

    expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();

    // Next submit should include prior conversation history
    fireEvent.change(input, { target: { value: "and at noon" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });

    await waitFor(() => expect(runVibeTag).toHaveBeenCalledTimes(2));
    const secondCallMessages = vi.mocked(runVibeTag).mock.calls[1][1];
    expect(secondCallMessages.length).toBeGreaterThan(1);
  });
});

// ── Error state ───────────────────────────────────────────────────────────────

describe("error state", () => {
  it("renders error message and re-enables input when runVibeTag throws", async () => {
    vi.mocked(runVibeTag).mockRejectedValue(new Error("I couldn't figure out what you meant"));
    setupMocks();
    render(<VibeTagSection selectedPhotos={[makePhoto()]} onOpenSettings={onOpenSettings} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "???" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });

    await waitFor(() =>
      expect(screen.getByText(/I couldn't figure out what you meant/)).toBeInTheDocument()
    );
    expect(screen.getByRole("textbox")).not.toBeDisabled();
  });
});

// ── Selection change clears conversation ──────────────────────────────────────

describe("selection change clears conversation", () => {
  it("clears messages, proposal, and error when selectedIds changes", async () => {
    vi.mocked(runVibeTag).mockRejectedValue(new Error("oops"));
    const { rerender } = render(
      <VibeTagSection selectedPhotos={[makePhoto("p1")]} onOpenSettings={onOpenSettings} />
    );

    // Trigger an error first
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "test" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    await waitFor(() => expect(screen.getByText(/oops/)).toBeInTheDocument());

    // Simulate selection change by changing selectedIds in context
    vi.mocked(useSession).mockReturnValue({
      state: { ...baseSession, selectedIds: new Set(["p2"]) },
      dispatch: vi.fn(),
    });
    rerender(
      <VibeTagSection selectedPhotos={[makePhoto("p2")]} onOpenSettings={onOpenSettings} />
    );

    expect(screen.queryByText(/oops/)).not.toBeInTheDocument();
  });
});
