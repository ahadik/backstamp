import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { vi, beforeEach, describe, it, expect } from "vitest";
import { SettingsModal } from "./SettingsModal";
import type { UIState } from "../../state/UIContext";

vi.mock("../../state/UIContext", () => ({
  useUI: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  tauriCommands: {
    setApiKey: vi.fn().mockResolvedValue(undefined),
    deleteApiKey: vi.fn().mockResolvedValue(undefined),
  },
}));

import { useUI } from "../../state/UIContext";
import { tauriCommands } from "../../lib/tauri";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseUI: UIState = {
  workingTimezone: "America/Los_Angeles",
  gridColumns: 5,
  panelWidth: 800,
  mapPanelHeight: 200,
  mapboxToken: null,
  googleMapsKey: null,
  claudeApiKey: null,
  error: null,
};

function setupMocks(uiOverrides: Partial<UIState> = {}) {
  const dispatch = vi.fn();
  vi.mocked(useUI).mockReturnValue({
    state: { ...baseUI, ...uiOverrides },
    dispatch,
  });
  return { dispatch };
}

const onClose = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Rendering ─────────────────────────────────────────────────────────────────

describe("rendering", () => {
  it("renders both API key sections", () => {
    setupMocks();
    render(<SettingsModal onClose={onClose} />);
    expect(screen.getByText("Mapbox API Key")).toBeInTheDocument();
    expect(screen.getByText("Anthropic API Key")).toBeInTheDocument();
  });

  it("displays masked key when savedValue is set", () => {
    setupMocks({ mapboxToken: "pk.eyJ1IjoiYWxleCIsImEiOiJjbTkiMTIzNDU2Nzg5" });
    render(<SettingsModal onClose={onClose} />);
    // The masked value should contain bullet characters
    expect(screen.getByText(/••/)).toBeInTheDocument();
  });

  it("does not render Remove button when savedValue is null", () => {
    setupMocks({ mapboxToken: null, claudeApiKey: null });
    render(<SettingsModal onClose={onClose} />);
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });

  it("renders Remove button when savedValue is set", () => {
    setupMocks({ mapboxToken: "pk.test" });
    render(<SettingsModal onClose={onClose} />);
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });
});

// ── Save on blur ──────────────────────────────────────────────────────────────

describe("save on blur", () => {
  it("calls setApiKey with trimmed value on blur after typing", async () => {
    setupMocks();
    const { container } = render(<SettingsModal onClose={onClose} />);
    // First input (password) is the Mapbox key field
    const mapboxInput = container.querySelectorAll("input")[0] as HTMLInputElement;
    fireEvent.change(mapboxInput, { target: { value: "  pk.newkey  " } });
    await act(async () => { fireEvent.blur(mapboxInput); });
    expect(tauriCommands.setApiKey).toHaveBeenCalledWith("mapbox_token", "pk.newkey");
  });

  it("does not call setApiKey when clearing input on blur", async () => {
    setupMocks({ mapboxToken: "pk.existing" });
    const { container } = render(<SettingsModal onClose={onClose} />);
    const mapboxInput = container.querySelectorAll("input")[0] as HTMLInputElement;
    // Focus triggers isDirty
    fireEvent.focus(mapboxInput);
    // Clear the value
    fireEvent.change(mapboxInput, { target: { value: "" } });
    await act(async () => { fireEvent.blur(mapboxInput); });
    expect(tauriCommands.setApiKey).not.toHaveBeenCalled();
  });
});

// ── Remove ────────────────────────────────────────────────────────────────────

describe("Remove", () => {
  it("calls deleteApiKey and dispatches SET_MAPBOX_TOKEN null", async () => {
    const { dispatch } = setupMocks({ mapboxToken: "pk.test" });
    render(<SettingsModal onClose={onClose} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    });
    expect(tauriCommands.deleteApiKey).toHaveBeenCalledWith("mapbox_token");
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_MAPBOX_TOKEN", token: null });
  });

  it("calls deleteApiKey and dispatches SET_CLAUDE_API_KEY null", async () => {
    const { dispatch } = setupMocks({ claudeApiKey: "sk-ant-test" });
    render(<SettingsModal onClose={onClose} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    });
    expect(tauriCommands.deleteApiKey).toHaveBeenCalledWith("claude_api_key");
    expect(dispatch).toHaveBeenCalledWith({ type: "SET_CLAUDE_API_KEY", key: null });
  });
});

// ── Test button ───────────────────────────────────────────────────────────────

describe("test button", () => {
  it("shows ✓ Valid badge on success", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 200 });
    setupMocks({ mapboxToken: "pk.test" });
    render(<SettingsModal onClose={onClose} />);
    const testBtns = screen.getAllByRole("button", { name: /^test$/i });
    await act(async () => { fireEvent.click(testBtns[0]); });
    await waitFor(() => expect(screen.getByText("✓ Valid")).toBeInTheDocument());
  });

  it("shows ✗ Invalid badge on failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ status: 401 });
    setupMocks({ claudeApiKey: "sk-ant-bad" });
    render(<SettingsModal onClose={onClose} />);
    const testBtns = screen.getAllByRole("button", { name: /^test$/i });
    // index 2 = Anthropic key Test button (Mapbox=0, Google Maps=1, Anthropic=2)
    await act(async () => { fireEvent.click(testBtns[2]); });
    await waitFor(() => expect(screen.getByText("✗ Invalid")).toBeInTheDocument());
  });

  it("test button is disabled when no key is stored and input is empty", () => {
    setupMocks({ mapboxToken: null, claudeApiKey: null });
    render(<SettingsModal onClose={onClose} />);
    const testBtns = screen.getAllByRole("button", { name: /^test$/i });
    testBtns.forEach((btn) => expect(btn).toBeDisabled());
  });
});

// ── Show / Hide toggle ────────────────────────────────────────────────────────

describe("show/hide toggle", () => {
  it("changes input type to text on Show click", () => {
    setupMocks({ mapboxToken: "pk.test" });
    const { container } = render(<SettingsModal onClose={onClose} />);
    const showBtn = screen.getAllByRole("button", { name: /show key/i })[0];
    fireEvent.click(showBtn);
    expect((container.querySelectorAll("input")[0] as HTMLInputElement).type).toBe("text");
  });

  it("button label becomes Hide after clicking Show", () => {
    setupMocks({ mapboxToken: "pk.test" });
    render(<SettingsModal onClose={onClose} />);
    const showBtn = screen.getAllByRole("button", { name: /show key/i })[0];
    fireEvent.click(showBtn);
    expect(screen.getAllByRole("button", { name: /hide key/i })[0]).toBeInTheDocument();
  });

  it("reverts input type to password on Hide click", () => {
    setupMocks({ mapboxToken: "pk.test" });
    const { container } = render(<SettingsModal onClose={onClose} />);
    const showBtn = screen.getAllByRole("button", { name: /show key/i })[0];
    fireEvent.click(showBtn);
    const hideBtn = screen.getAllByRole("button", { name: /hide key/i })[0];
    fireEvent.click(hideBtn);
    expect((container.querySelectorAll("input")[0] as HTMLInputElement).type).toBe("password");
  });
});

// ── Escape to close ───────────────────────────────────────────────────────────

describe("escape to close", () => {
  it("calls onClose when Escape is pressed", () => {
    setupMocks();
    render(<SettingsModal onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
