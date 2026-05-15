import { render, screen } from "@testing-library/react";
import { vi, beforeEach, describe, it, expect } from "vitest";
import { TopBar } from "./TopBar";
import type { SessionState } from "../../state/SessionContext";
import type { ApplyPhase } from "../ApplyModal/ApplyModal";

vi.mock("../../state/SessionContext", () => ({
  useSession: vi.fn(),
}));

vi.mock("../../state/UIContext", () => ({
  useUI: vi.fn(),
}));

vi.mock("../../state/DevLogContext", () => ({
  useDevLog: vi.fn(() => ({ entries: [], isOpen: false, open: vi.fn(), close: vi.fn(), clear: vi.fn() })),
}));

vi.mock("../../lib/tauri", () => ({
  tauriCommands: {
    applyChanges: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue({ canRollback: false, failedFiles: [] }),
    resetPhotos: vi.fn().mockResolvedValue({ failedFiles: [] }),
    loadSession: vi.fn().mockResolvedValue({ photos: [], gpxFiles: [], canRollback: false, workingTimezone: "America/Los_Angeles", gridColumns: 5, mapPanelHeight: 200 }),
    clearSession: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../lib/applyUtils", () => ({
  buildApplyPayload: vi.fn(() => ({ changes: {} })),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (src: string) => src,
}));

vi.mock("../common/ConfirmDialog/ConfirmDialog", () => ({
  ConfirmDialog: ({ title, confirmLabel, cancelLabel = "Cancel", onConfirm, onCancel }: any) => (
    <div role="dialog">
      <span>{title}</span>
      <button onClick={onConfirm}>{confirmLabel}</button>
      <button onClick={onCancel}>{cancelLabel}</button>
    </div>
  ),
}));

import { useSession } from "../../state/SessionContext";
import { useUI } from "../../state/UIContext";

const mockDispatch = vi.fn();
const mockUiDispatch = vi.fn();

const defaultUiState = {
  workingTimezone: "America/Los_Angeles",
  gridColumns: 5,
  panelWidth: 800,
  mapPanelHeight: 200,
  mapboxToken: null,
  googleMapsKey: null,
  claudeApiKey: null,
  error: null,
};

const nullMeta = {
  captureDate: null, captureTime: null, utcOffset: null, timezone: null,
  gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null, lens: null, filmVendor: null, filmType: null,
};

function makePhoto(id: string, pendingChanges: object | null = null) {
  return {
    id,
    filePath: `/${id}.jpg`,
    fileStatus: "ok" as const,
    thumbnail: { small: "", large: "" },
    originalMetadata: nullMeta,
    currentMetadata: nullMeta,
    pendingChanges,
  };
}

function setup(sessionOverrides: Partial<SessionState> = {}, phase: ApplyPhase = { type: "idle" }) {
  const base: SessionState = {
    photos: [],
    selectedIds: new Set(),
    gpxFiles: [],
    selectedGpxId: null,
    applyInProgress: false,
    canRollback: false,
    ...sessionOverrides,
  };
  vi.mocked(useSession).mockReturnValue({ state: base, dispatch: mockDispatch });
  vi.mocked(useUI).mockReturnValue({ state: defaultUiState, dispatch: mockUiDispatch });
  render(<TopBar applyPhase={phase} setApplyPhase={vi.fn()} onOpenSettings={vi.fn()} />);
}

beforeEach(() => {
  mockDispatch.mockClear();
  mockUiDispatch.mockClear();
  vi.mocked(tauriCommands.clearSession).mockClear();
});

// ── Photo count ───────────────────────────────────────────────────────────────

describe("TopBar — photo count", () => {
  it("shows singular 'photo' for exactly 1 photo", () => {
    setup({ photos: [makePhoto("a")] });
    expect(screen.getByText("1 photo")).toBeTruthy();
  });

  it("shows plural 'photos' for 0 photos", () => {
    setup({ photos: [] });
    expect(screen.getByText("0 photos")).toBeTruthy();
  });

  it("shows plural 'photos' for 3 photos", () => {
    setup({ photos: [makePhoto("a"), makePhoto("b"), makePhoto("c")] });
    expect(screen.getByText("3 photos")).toBeTruthy();
  });
});

// ── Apply button ──────────────────────────────────────────────────────────────

describe("TopBar — Apply button", () => {
  it("is disabled when no photos have pending changes", () => {
    setup({ photos: [makePhoto("a")] });
    expect(screen.getByRole("button", { name: /apply/i })).toBeDisabled();
  });

  it("is enabled when at least one photo has pending changes", () => {
    setup({ photos: [makePhoto("a", { captureDate: "2024-01-01" })] });
    expect(screen.getByRole("button", { name: /apply/i })).not.toBeDisabled();
  });

  it("is disabled when applyInProgress is true", () => {
    setup({
      photos: [makePhoto("a", { captureDate: "2024-01-01" })],
      applyInProgress: true,
    });
    expect(screen.getByRole("button", { name: /apply/i })).toBeDisabled();
  });
});

// ── Roll Back button ──────────────────────────────────────────────────────────

describe("TopBar — Roll Back button", () => {
  function openUndoMenu() {
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
  }

  it("is disabled when canRollback is false", () => {
    setup({ canRollback: false, photos: [makePhoto("a")] });
    openUndoMenu();
    expect(screen.getByRole("button", { name: /roll back/i })).toBeDisabled();
  });

  it("is enabled when canRollback is true", () => {
    setup({ canRollback: true });
    openUndoMenu();
    expect(screen.getByRole("button", { name: /roll back/i })).not.toBeDisabled();
  });

  it("is disabled when applyInProgress is true, even if canRollback", () => {
    setup({ canRollback: true, applyInProgress: true });
    expect(screen.getByRole("button", { name: /undo/i })).toBeDisabled();
  });
});

// ── Reset button ─────────────────────────────────────────────────────────────

describe("TopBar — Reset button", () => {
  function openUndoMenu() {
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));
  }

  it("is disabled when there are no photos", () => {
    setup({ photos: [] });
    // Undo button itself is disabled when no photos and canRollback is false
    expect(screen.getByRole("button", { name: /undo/i })).toBeDisabled();
  });

  it("is enabled when photos exist", () => {
    setup({ photos: [makePhoto("a")] });
    openUndoMenu();
    expect(screen.getByRole("button", { name: /reset all/i })).not.toBeDisabled();
  });

  it("says 'Reset All' when no selection", () => {
    setup({ photos: [makePhoto("a")], selectedIds: new Set() });
    openUndoMenu();
    expect(screen.getByRole("button", { name: /reset all/i })).toBeTruthy();
  });

  it("says 'Reset Selected' when photos are selected", () => {
    setup({ photos: [makePhoto("a")], selectedIds: new Set(["a"]) });
    openUndoMenu();
    expect(screen.getByRole("button", { name: /reset selected/i })).toBeTruthy();
  });

  it("is disabled when applyInProgress is true", () => {
    setup({ photos: [makePhoto("a")], applyInProgress: true });
    // Undo button itself is disabled when busy, preventing access to Reset
    expect(screen.getByRole("button", { name: /undo/i })).toBeDisabled();
  });
});

// ── Clear Session button ──────────────────────────────────────────────────────

import { fireEvent, waitFor, within } from "@testing-library/react";
import { tauriCommands } from "../../lib/tauri";

describe("TopBar — Clear Session button", () => {
  it("is disabled when no photos and no GPX files", () => {
    setup({ photos: [], gpxFiles: [] });
    expect(screen.getByRole("button", { name: /clear session/i })).toBeDisabled();
  });

  it("is enabled when photos exist", () => {
    setup({ photos: [makePhoto("a")] });
    expect(screen.getByRole("button", { name: /clear session/i })).not.toBeDisabled();
  });

  it("is enabled when only GPX files exist", () => {
    setup({ photos: [], gpxFiles: [{ id: "g1", filePath: "/g.gpx", addedAt: 0, trackPoints: [], thumbnailPath: null }] });
    expect(screen.getByRole("button", { name: /clear session/i })).not.toBeDisabled();
  });

  it("shows confirmation dialog after click", () => {
    setup({ photos: [makePhoto("a")] });
    fireEvent.click(screen.getByRole("button", { name: /clear session/i }));
    expect(screen.getByText(/clear session\?/i)).toBeInTheDocument();
  });

  it("calls clearSession and dispatches CLEAR_SESSION on confirm", async () => {
    setup({ photos: [makePhoto("a")] });
    fireEvent.click(screen.getByRole("button", { name: /clear session/i }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^clear session$/i }));
    await waitFor(() => {
      expect(vi.mocked(tauriCommands.clearSession)).toHaveBeenCalledTimes(1);
      expect(mockDispatch).toHaveBeenCalledWith({ type: "CLEAR_SESSION" });
    });
  });

  it("does NOT call clearSession when cancelled", () => {
    setup({ photos: [makePhoto("a")] });
    fireEvent.click(screen.getByRole("button", { name: /clear session/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(vi.mocked(tauriCommands.clearSession)).not.toHaveBeenCalled();
  });
});
