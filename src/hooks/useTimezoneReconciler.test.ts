import { renderHook, waitFor } from "@testing-library/react";
import { vi, beforeEach, describe, it, expect } from "vitest";
import type { Photo, Metadata, SessionState } from "../state/SessionContext";

vi.mock("../state/SessionContext", () => ({ useSession: vi.fn() }));
vi.mock("../lib/tauri", () => ({
  tauriCommands: {
    resolveTimezone: vi.fn(),
    setPendingChanges: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock("../lib/errors", () => ({ reportError: vi.fn() }));

import { useSession } from "../state/SessionContext";
import { tauriCommands } from "../lib/tauri";
import { useTimezoneReconciler } from "./useTimezoneReconciler";

const nullMetadata: Metadata = {
  captureDate: null, captureTime: null, utcOffset: null, timezone: null,
  gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null, lens: null,
  filmVendor: null, filmType: null,
};

const mockDispatch = vi.fn();
const resolveTimezone = vi.mocked(tauriCommands.resolveTimezone);
const setPendingChanges = vi.mocked(tauriCommands.setPendingChanges);

function photo(id: string, meta: Partial<Metadata>, pending: Partial<Metadata> | null): Photo {
  const m = { ...nullMetadata, ...meta };
  return {
    id, filePath: `/${id}.jpg`, fileStatus: "ok",
    thumbnail: { small: "/s.jpg", large: "/l.jpg" },
    originalMetadata: nullMetadata, currentMetadata: m, pendingChanges: pending,
  };
}

function mount(photos: Photo[]) {
  const state: SessionState = {
    photos, selectedIds: new Set(), gpxFiles: [], selectedGpxIds: new Set(),
    applyInProgress: false, canRollback: false, metadataHistory: [],
  };
  vi.mocked(useSession).mockReturnValue({ state, dispatch: mockDispatch });
  return renderHook(() => useTimezoneReconciler());
}

const denver = { gpsLat: 39.74, gpsLng: -104.99 };

beforeEach(() => {
  vi.clearAllMocks();
  resolveTimezone.mockResolvedValue("America/Denver");
});

describe("useTimezoneReconciler", () => {
  it("fills the zone when a date lands on an edited photo that has a location", async () => {
    mount([photo("a", { ...denver, captureDate: "2026-07-03" }, { captureDate: "2026-07-03" })]);
    await waitFor(() => expect(mockDispatch).toHaveBeenCalledWith({
      type: "SET_PENDING", ids: ["a"], changes: { timezone: "America/Denver" },
    }));
    expect(resolveTimezone).toHaveBeenCalledWith(denver.gpsLat, denver.gpsLng);
    expect(setPendingChanges).toHaveBeenCalledWith(["a"], [{ field: "timezone", value: "America/Denver" }]);
  });

  it("fills the zone when a location lands on an edited photo that has a date", async () => {
    mount([photo("a", { ...denver, captureDate: "2026-07-03" }, { gpsLat: denver.gpsLat, gpsLng: denver.gpsLng })]);
    await waitFor(() => expect(mockDispatch).toHaveBeenCalledTimes(1));
  });

  it("leaves pristine imports alone", async () => {
    mount([photo("a", { ...denver, captureDate: "2026-07-03" }, null)]);
    await Promise.resolve();
    expect(resolveTimezone).not.toHaveBeenCalled();
  });

  it("waits for a date before resolving", async () => {
    mount([photo("a", denver, { gpsLat: denver.gpsLat, gpsLng: denver.gpsLng })]);
    await Promise.resolve();
    expect(resolveTimezone).not.toHaveBeenCalled();
  });

  it("never overrides a zone the photo already has", async () => {
    mount([photo("a", { ...denver, captureDate: "2026-07-03", timezone: "Asia/Tokyo" }, { captureDate: "2026-07-03" })]);
    await Promise.resolve();
    expect(resolveTimezone).not.toHaveBeenCalled();
  });

  it("asks once per location, even across re-renders and empty answers", async () => {
    resolveTimezone.mockResolvedValue("");
    const { rerender } = mount([photo("a", { ...denver, captureDate: "2026-07-03" }, { captureDate: "2026-07-03" })]);
    await waitFor(() => expect(resolveTimezone).toHaveBeenCalledTimes(1));
    rerender();
    await Promise.resolve();
    expect(resolveTimezone).toHaveBeenCalledTimes(1);
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("drops a late answer when the photo was given a zone meanwhile", async () => {
    let settle: (tz: string) => void = () => {};
    resolveTimezone.mockReturnValue(new Promise((r) => { settle = r; }));
    const before = photo("a", { ...denver, captureDate: "2026-07-03" }, { captureDate: "2026-07-03" });
    const { rerender } = mount([before]);
    await waitFor(() => expect(resolveTimezone).toHaveBeenCalledTimes(1));

    const after = photo("a", { ...denver, captureDate: "2026-07-03", timezone: "Asia/Tokyo" }, { timezone: "Asia/Tokyo" });
    const state: SessionState = {
      photos: [after], selectedIds: new Set(), gpxFiles: [], selectedGpxIds: new Set(),
      applyInProgress: false, canRollback: false, metadataHistory: [],
    };
    vi.mocked(useSession).mockReturnValue({ state, dispatch: mockDispatch });
    rerender();
    settle("America/Denver");
    await Promise.resolve();
    await Promise.resolve();
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
