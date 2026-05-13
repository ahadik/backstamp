import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateProposal, runVibeTag } from "./vibeTag";
import type { MetadataProposal, VibeTagMessage } from "./vibeTag";

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = { create: mockCreate };
  }
  return { default: MockAnthropic };
});

vi.mock("./tauri", () => ({
  tauriCommands: {
    resolveTimezone: vi.fn().mockResolvedValue("America/Los_Angeles"),
  },
}));

// ─── validateProposal ────────────────────────────────────────────────────────

describe("validateProposal — valid inputs", () => {
  it("returns {} for empty object", () => {
    expect(validateProposal({})).toEqual({});
  });

  it("accepts valid capture_date", () => {
    expect(validateProposal({ capture_date: "2025-03-15" })).toEqual({
      capture_date: "2025-03-15",
    });
  });

  it("accepts full valid proposal with all fields", () => {
    const raw = {
      capture_date: "2025-03-15",
      capture_time: "14:30:00",
      timezone: "America/New_York",
      camera_make: "Canon",
      camera_model: "EOS R5",
      lens: "RF 50mm f/1.2",
      film: { vendor: "Kodak", type: "Portra 400" },
      location: { lat: 37.7749, lng: -122.4194, display_name: "San Francisco" },
    };
    const result = validateProposal(raw);
    expect(result).toEqual(raw);
  });

  it("omits camera_model when camera_make is absent", () => {
    const result = validateProposal({ camera_model: "EOS R5" });
    expect(result).not.toHaveProperty("camera_model");
  });

  it("includes camera_model when camera_make is also present", () => {
    const result = validateProposal({ camera_make: "Canon", camera_model: "EOS R5" });
    expect(result).toEqual({ camera_make: "Canon", camera_model: "EOS R5" });
  });
});

describe("validateProposal — invalid inputs", () => {
  it("throws for a string", () => {
    expect(() => validateProposal("hello")).toThrow();
  });

  it("throws for null", () => {
    expect(() => validateProposal(null)).toThrow();
  });

  it("throws for an array", () => {
    expect(() => validateProposal([])).toThrow();
  });

  it("throws for capture_date with slashes", () => {
    expect(() => validateProposal({ capture_date: "2024/03/15" })).toThrow(
      /capture_date/
    );
  });

  it("throws for capture_date without separators", () => {
    expect(() => validateProposal({ capture_date: "20240315" })).toThrow(
      /capture_date/
    );
  });

  it("throws for capture_time missing seconds", () => {
    expect(() => validateProposal({ capture_time: "14:30" })).toThrow(
      /capture_time/
    );
  });

  it("throws for capture_time with extra field", () => {
    expect(() => validateProposal({ capture_time: "14:30:00:00" })).toThrow(
      /capture_time/
    );
  });

  it("throws for film missing type", () => {
    expect(() => validateProposal({ film: { vendor: "Kodak" } })).toThrow(/film/);
  });

  it("throws for film as string", () => {
    expect(() => validateProposal({ film: "Kodak Portra 400" })).toThrow(/film/);
  });

  it("throws for location with string lat", () => {
    expect(() =>
      validateProposal({ location: { lat: "37.7", lng: -122.4 } })
    ).toThrow(/location/);
  });
});

// ─── runVibeTag ──────────────────────────────────────────────────────────────

import { tauriCommands } from "./tauri";

beforeEach(() => {
  vi.clearAllMocks();
});

const baseMessages: VibeTagMessage[] = [{ role: "user", content: "taken in Paris" }];

function makeTextResponse(text: string) {
  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text }],
  };
}

describe("runVibeTag", () => {
  it("single-turn success returns parsed proposal", async () => {
    mockCreate.mockResolvedValue(
      makeTextResponse('{"capture_date":"2025-03-15"}')
    );
    const result = await runVibeTag("key", baseMessages, 1, {}, null);
    expect(result).toEqual<MetadataProposal>({ capture_date: "2025-03-15" });
  });

  it("throws with Claude's error string when Claude cannot interpret input", async () => {
    mockCreate.mockResolvedValue(
      makeTextResponse("I couldn't figure out what you meant")
    );
    await expect(runVibeTag("key", baseMessages, 1, {}, null)).rejects.toThrow(
      "I couldn't figure out what you meant"
    );
  });

  it("throws 'invalid response' for malformed JSON", async () => {
    mockCreate.mockResolvedValue(makeTextResponse("not json"));
    await expect(runVibeTag("key", baseMessages, 1, {}, null)).rejects.toThrow(
      /invalid response/i
    );
  });

  it("extracts JSON from code fence", async () => {
    mockCreate.mockResolvedValue(
      makeTextResponse('```json\n{"capture_time":"14:30:00"}\n```')
    );
    const result = await runVibeTag("key", baseMessages, 1, {}, null);
    expect(result).toEqual<MetadataProposal>({ capture_time: "14:30:00" });
  });

  it("handles tool-use turn for geocoding and returns location in proposal", async () => {
    const fakeCoords = { lat: 48.8566, lng: 2.3522, display_name: "Paris, France" };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            geometry: { coordinates: [fakeCoords.lng, fakeCoords.lat] },
            properties: { full_address: fakeCoords.display_name },
          },
        ],
      }),
    });

    mockCreate
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "geocode_location",
            input: { query: "Paris" },
          },
        ],
      })
      .mockResolvedValueOnce(
        makeTextResponse(
          JSON.stringify({
            location: {
              lat: fakeCoords.lat,
              lng: fakeCoords.lng,
              display_name: fakeCoords.display_name,
            },
          })
        )
      );

    const result = await runVibeTag("key", baseMessages, 1, {}, "pk.test");

    expect(tauriCommands.resolveTimezone).toHaveBeenCalledWith(
      fakeCoords.lat,
      fakeCoords.lng
    );
    expect(result.location).toEqual({
      lat: fakeCoords.lat,
      lng: fakeCoords.lng,
      display_name: fakeCoords.display_name,
    });
    expect(result.timezone).toBe("America/Los_Angeles");
  });

  it("injects location from geocode result when Claude omits it from the JSON", async () => {
    const fakeCoords = { lat: 48.8566, lng: 2.3522, display_name: "Paris, France" };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        features: [
          {
            geometry: { coordinates: [fakeCoords.lng, fakeCoords.lat] },
            properties: { full_address: fakeCoords.display_name },
          },
        ],
      }),
    });

    mockCreate
      .mockResolvedValueOnce({
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "tool-1",
            name: "geocode_location",
            input: { query: "Paris" },
          },
        ],
      })
      // Claude calls the tool but forgets to include location in the final JSON
      .mockResolvedValueOnce(makeTextResponse(JSON.stringify({ capture_date: "2025-03-15" })));

    const result = await runVibeTag("key", baseMessages, 1, {}, "pk.test");

    expect(result.location).toEqual({
      lat: fakeCoords.lat,
      lng: fakeCoords.lng,
      display_name: fakeCoords.display_name,
    });
    expect(result.timezone).toBe("America/Los_Angeles");
    expect(result.capture_date).toBe("2025-03-15");
  });
});
