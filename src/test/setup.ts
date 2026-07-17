import "@testing-library/jest-dom";
import { vi } from "vitest";

// Stub Tauri's IPC layer. Components fire fire-and-forget commands (e.g.
// setPendingChanges) as side effects; without a runtime, the real invoke()
// dereferences an undefined `window.__TAURI_INTERNALS__` and rejects, which the
// call sites' `.catch(console.error)` then dumps to the test console. Provide a
// no-op runtime so those calls resolve quietly. Tests that assert on specific
// commands mock `../lib/tauri` or `@tauri-apps/api/core` directly; a module mock
// takes precedence over this global, so this does not interfere with them.
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: vi.fn(() => Promise.resolve()),
  transformCallback: vi.fn(() => 0),
  convertFileSrc: (path: string) => path,
};

window.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}
