import { render, screen, fireEvent } from "@testing-library/react";
import { vi, beforeEach, describe, it, expect } from "vitest";
import {
  DateTimeSection,
  parseTimeInput,
  formatTimeDisplay,
} from "./DateTimeSection";
import type { Photo, Metadata, SessionState } from "../../../state/SessionContext";

vi.mock("../../../state/SessionContext", () => ({
  useSession: vi.fn(),
}));

import { useSession } from "../../../state/SessionContext";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const baseMetadata: Metadata = {
  captureDate: null, captureTime: null, utcOffset: null, timezone: null,
  gpsLat: null, gpsLng: null, cameraMake: null, cameraModel: null, lens: null, filmVendor: null, filmType: null,
};

const emptySessionState: SessionState = {
  photos: [], selectedIds: new Set(), gpxFiles: [], selectedGpxId: null,
  applyInProgress: false, canRollback: false, metadataHistory: [],
};

const mockDispatch = vi.fn();

function setupMock() {
  vi.mocked(useSession).mockReturnValue({
    state: emptySessionState,
    dispatch: mockDispatch,
  });
}

function makePhoto(metadata: Partial<Metadata> = {}): Photo {
  const m = { ...baseMetadata, ...metadata };
  return {
    id: "p1", filePath: "/p1.jpg", fileStatus: "ok",
    thumbnail: { small: "/s.jpg", large: "/l.jpg" },
    originalMetadata: m, currentMetadata: m, pendingChanges: null,
  };
}

function dateInput(): HTMLInputElement {
  return document.querySelector('input[type="date"]') as HTMLInputElement;
}

beforeEach(() => {
  mockDispatch.mockClear();
  setupMock();
});

// ── parseTimeInput ────────────────────────────────────────────────────────────

describe("parseTimeInput", () => {
  it("returns null for empty / whitespace input", () => {
    expect(parseTimeInput("")).toBeNull();
    expect(parseTimeInput("   ")).toBeNull();
  });

  it("parses bare hour (24h)", () => {
    expect(parseTimeInput("9")).toBe("09:00:00");
    expect(parseTimeInput("14")).toBe("14:00:00");
    expect(parseTimeInput("0")).toBe("00:00:00");
  });

  it("parses HH:MM", () => {
    expect(parseTimeInput("9:30")).toBe("09:30:00");
    expect(parseTimeInput("14:30")).toBe("14:30:00");
    expect(parseTimeInput("00:00")).toBe("00:00:00");
    expect(parseTimeInput("23:59")).toBe("23:59:00");
  });

  it("parses HH:MM:SS", () => {
    expect(parseTimeInput("9:30:45")).toBe("09:30:45");
    expect(parseTimeInput("23:59:59")).toBe("23:59:59");
  });

  it("parses 12h AM", () => {
    expect(parseTimeInput("9am")).toBe("09:00:00");
    expect(parseTimeInput("12am")).toBe("00:00:00");
    expect(parseTimeInput("9:30am")).toBe("09:30:00");
    expect(parseTimeInput("9:30 am")).toBe("09:30:00");
    expect(parseTimeInput("9:30 AM")).toBe("09:30:00");
  });

  it("parses 12h PM", () => {
    expect(parseTimeInput("9pm")).toBe("21:00:00");
    expect(parseTimeInput("12pm")).toBe("12:00:00");
    expect(parseTimeInput("9:30pm")).toBe("21:30:00");
    expect(parseTimeInput("9:30 PM")).toBe("21:30:00");
  });

  it("returns null for hour >= 24 (24h mode)", () => {
    expect(parseTimeInput("24")).toBeNull();
    expect(parseTimeInput("25:00")).toBeNull();
  });

  it("returns null for hour > 12 in AM mode", () => {
    expect(parseTimeInput("13am")).toBeNull();
  });

  it("returns null for PM hour that overflows past 23", () => {
    expect(parseTimeInput("13pm")).toBeNull();
  });

  it("returns null for out-of-range minutes or seconds", () => {
    expect(parseTimeInput("9:60")).toBeNull();
    expect(parseTimeInput("9:30:60")).toBeNull();
  });

  it("returns null for unrecognised strings", () => {
    expect(parseTimeInput("abc")).toBeNull();
    expect(parseTimeInput("noon")).toBeNull();
    expect(parseTimeInput("1:2:3:4")).toBeNull();
  });
});

// ── formatTimeDisplay ─────────────────────────────────────────────────────────

describe("formatTimeDisplay", () => {
  it("formats midnight as 12:00 AM", () => {
    expect(formatTimeDisplay("00:00:00")).toBe("12:00 AM");
  });

  it("formats noon as 12:00 PM", () => {
    expect(formatTimeDisplay("12:00:00")).toBe("12:00 PM");
  });

  it("formats AM times", () => {
    expect(formatTimeDisplay("09:30:00")).toBe("9:30 AM");
    expect(formatTimeDisplay("11:59:00")).toBe("11:59 AM");
    expect(formatTimeDisplay("01:05:00")).toBe("1:05 AM");
  });

  it("formats PM times", () => {
    expect(formatTimeDisplay("13:30:00")).toBe("1:30 PM");
    expect(formatTimeDisplay("23:59:00")).toBe("11:59 PM");
    expect(formatTimeDisplay("18:00:00")).toBe("6:00 PM");
  });
});

// ── DateTimeSection component ─────────────────────────────────────────────────

describe("DateTimeSection", () => {
  it("shows empty state when no photos are selected", () => {
    render(<DateTimeSection selectedPhotos={[]} />);
    expect(screen.getByText("No photos selected")).toBeInTheDocument();
  });

  // ── Date field ──────────────────────────────────────────────────────────────

  describe("date field", () => {
    it("shows --/--/---- overlay when no date is set", () => {
      render(<DateTimeSection selectedPhotos={[makePhoto()]} />);
      expect(screen.getByText("--/--/----")).toBeInTheDocument();
    });

    it("does not show the overlay when a date is set", () => {
      render(<DateTimeSection selectedPhotos={[makePhoto({ captureDate: "2024-01-15" })]} />);
      expect(screen.queryByText("--/--/----")).not.toBeInTheDocument();
    });

    it("dispatches SET_PENDING with the selected date on valid change", () => {
      render(<DateTimeSection selectedPhotos={[makePhoto({ captureDate: "2024-01-15", captureTime: "09:00:00" })]} />);
      fireEvent.change(dateInput(), { target: { value: "2024-06-01" } });
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_PENDING",
        ids: ["p1"],
        changes: { captureDate: "2024-06-01" },
      });
    });

    it("also initialises captureTime to 00:00:00 when the photo has no time", () => {
      render(<DateTimeSection selectedPhotos={[makePhoto()]} />);
      fireEvent.change(dateInput(), { target: { value: "2024-06-01" } });
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_PENDING",
        ids: ["p1"],
        changes: { captureDate: "2024-06-01", captureTime: "00:00:00" },
      });
    });

    it("does not dispatch when onChange fires with an empty value (mid-edit browser state)", () => {
      render(<DateTimeSection selectedPhotos={[makePhoto({ captureDate: "2024-01-15" })]} />);
      fireEvent.change(dateInput(), { target: { value: "" } });
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it("dispatches captureDate: null on blur when the field is empty and a date was set", () => {
      render(<DateTimeSection selectedPhotos={[makePhoto({ captureDate: "2024-01-15" })]} />);
      const input = dateInput();
      input.value = ""; // simulate browser clearing without triggering React onChange
      fireEvent.blur(input);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_PENDING",
        ids: ["p1"],
        changes: { captureDate: null },
      });
    });

    it("does not dispatch on blur when the field is empty and no date was set", () => {
      render(<DateTimeSection selectedPhotos={[makePhoto()]} />);
      fireEvent.blur(dateInput());
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  // ── Time field ──────────────────────────────────────────────────────────────

  describe("time field", () => {
    function timeInput(): HTMLInputElement {
      return screen.getByPlaceholderText("--") as HTMLInputElement;
    }

    it("shows -- placeholder when no time is set", () => {
      render(<DateTimeSection selectedPhotos={[makePhoto()]} />);
      expect(screen.getByPlaceholderText("--")).toBeInTheDocument();
    });

    it("displays the time in 12h format when a time is set", () => {
      render(<DateTimeSection selectedPhotos={[makePhoto({ captureTime: "13:30:00" })]} />);
      expect(screen.getByDisplayValue("1:30 PM")).toBeInTheDocument();
    });

    it("dispatches the parsed time on blur with a valid input", () => {
      render(<DateTimeSection selectedPhotos={[makePhoto()]} />);
      const input = timeInput();
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "9:30am" } });
      fireEvent.blur(input);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_PENDING",
        ids: ["p1"],
        changes: { captureTime: "09:30:00" },
      });
    });

    it("dispatches captureTime: null on blur with an unrecognised string", () => {
      render(<DateTimeSection selectedPhotos={[makePhoto({ captureTime: "09:30:00" })]} />);
      const input = screen.getByDisplayValue("9:30 AM") as HTMLInputElement;
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "not-a-time" } });
      fireEvent.blur(input);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_PENDING",
        ids: ["p1"],
        changes: { captureTime: null },
      });
    });

    it("dispatches captureTime: null on blur with an empty string", () => {
      render(<DateTimeSection selectedPhotos={[makePhoto({ captureTime: "09:30:00" })]} />);
      const input = screen.getByDisplayValue("9:30 AM") as HTMLInputElement;
      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "" } });
      fireEvent.blur(input);
      expect(mockDispatch).toHaveBeenCalledWith({
        type: "SET_PENDING",
        ids: ["p1"],
        changes: { captureTime: null },
      });
    });
  });
});

// ── Timezone field ────────────────────────────────────────────────────────────

describe("DateTimeSection timezone field", () => {
  function photoWith(id: string, metadata: Partial<Metadata>): Photo {
    const m = { ...baseMetadata, ...metadata };
    return {
      id, filePath: `/${id}.jpg`, fileStatus: "ok",
      thumbnail: { small: "/s.jpg", large: "/l.jpg" },
      originalMetadata: m, currentMetadata: m, pendingChanges: null,
    };
  }

  function tzInput(): HTMLInputElement {
    // The date field also uses a "Multiple Values" placeholder, so target the
    // timezone combobox by its own class rather than by placeholder text.
    return document.querySelector('input[class*="tzInput"]') as HTMLInputElement;
  }

  it("labels the selected zone with the offset for a summer capture date", () => {
    render(<DateTimeSection selectedPhotos={[
      photoWith("p1", { captureDate: "2026-07-03", captureTime: "12:00:00", timezone: "America/Denver" }),
    ]} />);
    expect(tzInput().value).toBe("US Mountain · MDT UTC−6");
  });

  it("labels the same zone differently for a winter capture date", () => {
    render(<DateTimeSection selectedPhotos={[
      photoWith("p1", { captureDate: "2026-01-15", captureTime: "12:00:00", timezone: "America/Denver" }),
    ]} />);
    expect(tzInput().value).toBe("US Mountain · MST UTC−7");
  });

  it("shows a bare zone name when the photo has no date to resolve against", () => {
    render(<DateTimeSection selectedPhotos={[photoWith("p1", { timezone: "America/Denver" })]} />);
    expect(tzInput().value).toBe("US Mountain");
  });

  it("warns when the selection spans multiple timezones", () => {
    render(<DateTimeSection selectedPhotos={[
      photoWith("p1", { captureDate: "2026-07-03", timezone: "America/Denver" }),
      photoWith("p2", { captureDate: "2026-07-03", timezone: "America/New_York" }),
    ]} />);
    expect(screen.getByText("Selection contains multiple timezones")).toBeInTheDocument();
    expect(tzInput().value).toBe("");
    expect(tzInput()).toHaveAttribute("placeholder", "Multiple Values");
  });

  it("does not warn when the selection shares one timezone", () => {
    render(<DateTimeSection selectedPhotos={[
      photoWith("p1", { captureDate: "2026-07-03", timezone: "America/Denver" }),
      photoWith("p2", { captureDate: "2026-07-04", timezone: "America/Denver" }),
    ]} />);
    expect(screen.queryByText("Selection contains multiple timezones")).not.toBeInTheDocument();
  });

  it("offers date-correct offsets in the dropdown", () => {
    render(<DateTimeSection selectedPhotos={[
      photoWith("p1", { captureDate: "2026-07-03", captureTime: "12:00:00" }),
    ]} />);
    fireEvent.focus(tzInput());
    expect(screen.getByText("US Mountain · MDT UTC−6")).toBeInTheDocument();
    expect(screen.getByText("US Arizona · MST UTC−7")).toBeInTheDocument();
  });

  it("drops offsets and explains why when the selection straddles a DST change", () => {
    render(<DateTimeSection selectedPhotos={[
      photoWith("p1", { captureDate: "2026-01-15", captureTime: "12:00:00" }),
      photoWith("p2", { captureDate: "2026-07-03", captureTime: "12:00:00" }),
    ]} />);
    fireEvent.focus(tzInput());
    expect(screen.getByText("US Mountain")).toBeInTheDocument();
    expect(screen.queryByText(/US Mountain ·/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Some offsets hidden — selection spans a daylight saving change")
    ).toBeInTheDocument();
  });

  it("keeps offsets for zones the straddling selection does not affect", () => {
    render(<DateTimeSection selectedPhotos={[
      photoWith("p1", { captureDate: "2026-01-15", captureTime: "12:00:00" }),
      photoWith("p2", { captureDate: "2026-07-03", captureTime: "12:00:00" }),
    ]} />);
    fireEvent.focus(tzInput());
    expect(screen.getByText("Tokyo · UTC+9")).toBeInTheDocument();
  });
});
