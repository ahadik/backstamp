import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { formatErrorMessage, reportError, setErrorHandler } from "./errors";

describe("formatErrorMessage", () => {
  it("passes through plain strings (Tauri command rejections)", () => {
    expect(formatErrorMessage("exiftool exited with status 1")).toBe(
      "exiftool exited with status 1"
    );
  });

  it("uses the message of Error instances", () => {
    expect(formatErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("serialises plain objects", () => {
    expect(formatErrorMessage({ code: 42 })).toBe('{"code":42}');
  });

  it("falls back to String() for unserialisable values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatErrorMessage(circular)).toBe("[object Object]");
  });
});

describe("reportError", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    setErrorHandler(null);
    vi.restoreAllMocks();
  });

  it("forwards context and formatted error to the registered handler", () => {
    const handler = vi.fn();
    setErrorHandler(handler);
    reportError("Failed to save edits", "disk full");
    expect(handler).toHaveBeenCalledWith("Failed to save edits\n\ndisk full");
  });

  it("always logs to console.error", () => {
    reportError("Failed to save edits", "disk full");
    expect(console.error).toHaveBeenCalledWith("Failed to save edits:", "disk full");
  });

  it("does not throw when no handler is registered", () => {
    expect(() => reportError("Failed to save edits", "disk full")).not.toThrow();
  });

  it("stops forwarding after the handler is unregistered", () => {
    const handler = vi.fn();
    setErrorHandler(handler);
    setErrorHandler(null);
    reportError("Failed to save edits", "disk full");
    expect(handler).not.toHaveBeenCalled();
  });
});
