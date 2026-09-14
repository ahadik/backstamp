import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import { vi, beforeEach, describe, it, expect } from "vitest";
import { FloatingControls } from "./FloatingControls";
import type { SessionState } from "../../../state/SessionContext";

vi.mock("../../../state/SessionContext", () => ({
  useSession: vi.fn(),
}));

vi.mock("../../../state/UIContext", () => ({
  useUI: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (src: string) => src }));

// Capture backend event handlers so tests can drive the refresh lifecycle.
const eventHandlers = new Map<string, (e: { payload: unknown }) => void>();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, handler: (e: { payload: unknown }) => void) => {
    eventHandlers.set(name, handler);
    return Promise.resolve(() => eventHandlers.delete(name));
  }),
}));

vi.mock("../../../lib/tauri", () => ({
  tauriCommands: {
    refreshPhotos: vi.fn().mockResolvedValue(undefined),
    refreshCancel: vi.fn().mockResolvedValue(undefined),
    removePhotos: vi.fn().mockResolvedValue(undefined),
    loadSession: vi.fn().mockResolvedValue({ photos: [], gpxFiles: [], canRollback: false, workingTimezone: "America/Los_Angeles", gridColumns: 5, mapPanelHeight: 200 }),
  },
}));

vi.mock("./FilterControls", () => ({ FilterControls: () => null }));
vi.mock("./GridSizeControl", () => ({ GridSizeControl: () => null }));

vi.mock("../../common/ConfirmDialog/ConfirmDialog", () => ({
  ConfirmDialog: ({ title, confirmLabel, cancelLabel = "Cancel", onConfirm, onCancel }: any) => (
    <div role="dialog">
      <span>{title}</span>
      <button onClick={onConfirm}>{confirmLabel}</button>
      <button onClick={onCancel}>{cancelLabel}</button>
    </div>
  ),
}));

import { useSession } from "../../../state/SessionContext";
import { useUI } from "../../../state/UIContext";
import { tauriCommands } from "../../../lib/tauri";

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

function setup(sessionOverrides: Partial<SessionState> = {}) {
  const base: SessionState = {
    photos: [],
    selectedIds: new Set(),
    gpxFiles: [],
    selectedGpxIds: new Set(),
    applyInProgress: false,
    canRollback: false,
    metadataHistory: [],
    ...sessionOverrides,
  };
  vi.mocked(useSession).mockReturnValue({ state: base, dispatch: mockDispatch });
  vi.mocked(useUI).mockReturnValue({
    state: { workingTimezone: "America/Los_Angeles" } as any,
    dispatch: vi.fn(),
  });
  render(<FloatingControls onImportPaths={vi.fn()} />);
}

beforeEach(() => {
  mockDispatch.mockClear();
  vi.mocked(tauriCommands.refreshPhotos).mockClear();
  vi.mocked(tauriCommands.refreshCancel).mockClear();
  vi.mocked(tauriCommands.loadSession).mockClear();
  eventHandlers.clear();
});

describe("FloatingControls — Refresh from Disk button", () => {
  const refreshButton = () => screen.getByRole("button", { name: /refresh from disk/i });

  it("is disabled when there are no photos", () => {
    setup({ photos: [] });
    expect(refreshButton()).toBeDisabled();
  });

  it("is enabled when photos exist", () => {
    setup({ photos: [makePhoto("a")] });
    expect(refreshButton()).not.toBeDisabled();
  });

  it("is disabled while an apply is in progress", () => {
    setup({ photos: [makePhoto("a")], applyInProgress: true });
    expect(refreshButton()).toBeDisabled();
  });

  it("asks for confirmation before refreshing", () => {
    setup({ photos: [makePhoto("a"), makePhoto("b")] });
    fireEvent.click(refreshButton());
    expect(screen.getByText(/refresh metadata from disk\?/i)).toBeInTheDocument();
    expect(vi.mocked(tauriCommands.refreshPhotos)).not.toHaveBeenCalled();
  });

  it("does NOT refresh when the confirmation is cancelled", () => {
    setup({ photos: [makePhoto("a")] });
    fireEvent.click(refreshButton());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /cancel/i }));
    expect(vi.mocked(tauriCommands.refreshPhotos)).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("calls refreshPhotos on confirm", async () => {
    setup({ photos: [makePhoto("a")] });
    fireEvent.click(refreshButton());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^refresh$/i }));
    await waitFor(() => {
      expect(vi.mocked(tauriCommands.refreshPhotos)).toHaveBeenCalledTimes(1);
    });
  });

  it("shows progress while the backend refreshes and disables the button", async () => {
    setup({ photos: [makePhoto("a", { captureDate: "2024-01-01" })] });
    await waitFor(() => expect(eventHandlers.has("refresh:start")).toBe(true));

    act(() => eventHandlers.get("refresh:start")!({ payload: { total: 3 } }));
    expect(screen.getByText("Refreshing Metadata")).toBeInTheDocument();
    expect(refreshButton()).toBeDisabled();

    act(() =>
      eventHandlers.get("refresh:progress")!({
        payload: { done: 2, total: 3, error: "/b.jpg: file not found" },
      }),
    );
    expect(screen.getByText(/2 of 3/)).toBeInTheDocument();
    expect(screen.getByText("/b.jpg: file not found")).toBeInTheDocument();
  });

  it("reloads the session and dispatches REFRESH_PHOTOS when the backend completes", async () => {
    vi.mocked(tauriCommands.loadSession).mockResolvedValueOnce({
      photos: [{
        id: "a",
        filePath: "/a.jpg",
        fileStatus: "ok",
        thumbnailSmall: "/t/a_s.jpg",
        thumbnailLarge: "/t/a_l.jpg",
        originalMetadata: { ...nullMeta, lens: "fresh" },
        currentMetadata: { ...nullMeta, lens: "fresh" },
        pendingChanges: null,
      }],
      gpxFiles: [],
      canRollback: false,
      workingTimezone: "America/Los_Angeles",
      gridColumns: 5,
      mapPanelHeight: 200,
    });
    setup({ photos: [makePhoto("a", { lens: "edited" })], canRollback: true });
    await waitFor(() => expect(eventHandlers.has("refresh:complete")).toBe(true));

    act(() => eventHandlers.get("refresh:start")!({ payload: { total: 1 } }));
    await act(async () => {
      await eventHandlers.get("refresh:complete")!({
        payload: { total: 1, refreshed: 1, cancelled: false },
      });
    });

    expect(vi.mocked(tauriCommands.loadSession)).toHaveBeenCalledTimes(1);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "REFRESH_PHOTOS",
      photos: [expect.objectContaining({ id: "a", currentMetadata: { ...nullMeta, lens: "fresh" }, pendingChanges: null })],
      canRollback: false,
    });
  });

  it("asks the backend to stop when Cancel is clicked mid-refresh", async () => {
    setup({ photos: [makePhoto("a")] });
    await waitFor(() => expect(eventHandlers.has("refresh:start")).toBe(true));
    act(() => eventHandlers.get("refresh:start")!({ payload: { total: 2 } }));

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(vi.mocked(tauriCommands.refreshCancel)).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Cancelling Refresh…")).toBeInTheDocument();
  });
});
