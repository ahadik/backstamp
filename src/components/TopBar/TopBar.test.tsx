import { render, screen } from "@testing-library/react";
import { vi, beforeEach, describe, it, expect } from "vitest";
import { TopBar } from "./TopBar";
import type { SessionState } from "../../state/SessionContext";
import type { ApplyPhase } from "../ApplyModal/ApplyModal";

vi.mock("../../state/SessionContext", () => ({
  useSession: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  tauriCommands: {
    applyChanges: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue({ canRollback: false, failedFiles: [] }),
    resetPhotos: vi.fn().mockResolvedValue({ failedFiles: [] }),
    loadSession: vi.fn().mockResolvedValue({ photos: [], canRollback: false }),
  },
}));

vi.mock("../../lib/applyUtils", () => ({
  buildApplyPayload: vi.fn(() => ({ changes: {} })),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (src: string) => src,
}));

vi.mock("../common/ConfirmDialog/ConfirmDialog", () => ({
  ConfirmDialog: () => null,
}));

import { useSession } from "../../state/SessionContext";

const mockDispatch = vi.fn();

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
    applyInProgress: false,
    canRollback: false,
    ...sessionOverrides,
  };
  vi.mocked(useSession).mockReturnValue({ state: base, dispatch: mockDispatch });
  render(<TopBar applyPhase={phase} setApplyPhase={vi.fn()} onOpenSettings={vi.fn()} />);
}

beforeEach(() => {
  mockDispatch.mockClear();
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
  it("is disabled when canRollback is false", () => {
    setup({ canRollback: false });
    expect(screen.getByRole("button", { name: /roll back/i })).toBeDisabled();
  });

  it("is enabled when canRollback is true", () => {
    setup({ canRollback: true });
    expect(screen.getByRole("button", { name: /roll back/i })).not.toBeDisabled();
  });

  it("is disabled when applyInProgress is true, even if canRollback", () => {
    setup({ canRollback: true, applyInProgress: true });
    expect(screen.getByRole("button", { name: /roll back/i })).toBeDisabled();
  });
});

// ── Reset button ─────────────────────────────────────────────────────────────

describe("TopBar — Reset button", () => {
  it("is disabled when there are no photos", () => {
    setup({ photos: [] });
    expect(screen.getByRole("button", { name: /reset/i })).toBeDisabled();
  });

  it("is enabled when photos exist", () => {
    setup({ photos: [makePhoto("a")] });
    expect(screen.getByRole("button", { name: /reset/i })).not.toBeDisabled();
  });

  it("says 'Reset All' when no selection", () => {
    setup({ photos: [makePhoto("a")], selectedIds: new Set() });
    expect(screen.getByRole("button", { name: /reset all/i })).toBeTruthy();
  });

  it("says 'Reset Selected' when photos are selected", () => {
    setup({ photos: [makePhoto("a")], selectedIds: new Set(["a"]) });
    expect(screen.getByRole("button", { name: /reset selected/i })).toBeTruthy();
  });

  it("is disabled when applyInProgress is true", () => {
    setup({ photos: [makePhoto("a")], applyInProgress: true });
    expect(screen.getByRole("button", { name: /reset/i })).toBeDisabled();
  });
});
