import { vi, describe, it, expect, beforeEach } from "vitest";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));

// Import after mock registration so the module picks up the mock
const { tauriCommands } = await import("./tauri");

describe("tauriCommands", () => {
  beforeEach(() => {
    mockInvoke.mockClear();
  });

  it("loadSession invokes load_session with no extra args", async () => {
    mockInvoke.mockResolvedValue({});
    await tauriCommands.loadSession();
    expect(mockInvoke).toHaveBeenCalledWith("load_session");
  });

  it("clearSession invokes clear_session", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriCommands.clearSession();
    expect(mockInvoke).toHaveBeenCalledWith("clear_session");
  });

  it("importPhotos passes paths array", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriCommands.importPhotos(["/a.jpg", "/b.jpg"]);
    expect(mockInvoke).toHaveBeenCalledWith("import_photos", {
      paths: ["/a.jpg", "/b.jpg"],
    });
  });

  it("removePhotos passes ids array", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriCommands.removePhotos(["id-1", "id-2"]);
    expect(mockInvoke).toHaveBeenCalledWith("remove_photos", {
      ids: ["id-1", "id-2"],
    });
  });

  it("getThumbnail passes photoId", async () => {
    mockInvoke.mockResolvedValue("/path/to/thumb.jpg");
    await tauriCommands.getThumbnail("uuid-123");
    expect(mockInvoke).toHaveBeenCalledWith("get_thumbnail", {
      photoId: "uuid-123",
    });
  });

  it("rollback invokes rollback with no extra args", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await tauriCommands.rollback();
    expect(mockInvoke).toHaveBeenCalledWith("rollback");
  });

  it("applyChanges passes payload", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const payload = { changes: { "photo-1": { captureDate: "2024-01-01" } } };
    await tauriCommands.applyChanges(payload);
    expect(mockInvoke).toHaveBeenCalledWith("apply_changes", { payload });
  });
});
