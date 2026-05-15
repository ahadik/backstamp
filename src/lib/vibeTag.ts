import Anthropic from "@anthropic-ai/sdk";
import { tauriCommands } from "./tauri";

export interface MetadataProposal {
  capture_date?: string;
  capture_time?: string;
  timezone?: string;
  camera_make?: string;
  camera_model?: string;
  lens?: string;
  film?: { vendor: string; type: string };
  location?: { lat: number; lng: number; display_name: string };
}

export interface VibeTagMessage {
  role: "user" | "assistant";
  content: string;
}

export interface VibeTagDevData {
  rawResponses: Anthropic.Message[];
}

const SYSTEM_PROMPT_TEMPLATE = `You are a photo metadata assistant. Your only job is to interpret the user's description and return a JSON metadata proposal, or respond with the exact string "I couldn't figure out what you meant" if the input cannot be mapped to the available fields.

Today's date: {{ISO_DATE}}
Selected photos: {{COUNT}}
Current metadata: {{JSON_SUMMARY}}

Available fields:
- capture_date: ISO 8601 date (YYYY-MM-DD)
- capture_time: 24-hour time (HH:MM:SS)
- timezone: IANA timezone name
- camera_make: manufacturer string e.g. "Canon"
- camera_model: body string e.g. "EOS R5"
- lens: string
- film: { vendor: string, type: string } e.g. { vendor: "Kodak", type: "Portra 400" }
- location: { lat, lng, display_name } — you MUST call the geocode_location tool for any place name; include the returned iana_timezone as the timezone field

Rules:
- Only include fields the user's input explicitly addresses.
- Do not include explanation or prose in your response.
- If any field value is ambiguous, omit that field rather than guessing.`;

const GEOCODE_TOOL: Anthropic.Tool = {
  name: "geocode_location",
  description:
    "Resolve a place name or address to GPS coordinates and IANA timezone.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "Place name or address to look up.",
      },
    },
    required: ["query"],
  },
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}:\d{2}$/;

export function validateProposal(raw: unknown): MetadataProposal {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Claude returned an invalid response. Please try again.");
  }
  const p = raw as Record<string, unknown>;
  const out: MetadataProposal = {};

  if (p.capture_date !== undefined) {
    if (typeof p.capture_date !== "string" || !DATE_RE.test(p.capture_date)) {
      throw new Error(`Invalid capture_date: expected YYYY-MM-DD.`);
    }
    out.capture_date = p.capture_date;
  }
  if (p.capture_time !== undefined) {
    if (typeof p.capture_time !== "string" || !TIME_RE.test(p.capture_time)) {
      throw new Error(`Invalid capture_time: expected HH:MM:SS.`);
    }
    out.capture_time = p.capture_time;
  }
  if (p.timezone !== undefined) {
    if (typeof p.timezone !== "string") throw new Error("Invalid timezone.");
    out.timezone = p.timezone;
  }
  if (p.camera_make !== undefined) {
    if (typeof p.camera_make !== "string") throw new Error("Invalid camera_make.");
    out.camera_make = p.camera_make;
  }
  if (p.camera_model !== undefined) {
    if (typeof p.camera_model !== "string") throw new Error("Invalid camera_model.");
    if (out.camera_make !== undefined) {
      out.camera_model = p.camera_model;
    }
  }
  if (p.lens !== undefined) {
    if (typeof p.lens !== "string") throw new Error("Invalid lens.");
    out.lens = p.lens;
  }
  if (p.film !== undefined) {
    const film = p.film as Record<string, unknown>;
    if (
      typeof film !== "object" || film === null ||
      typeof film.vendor !== "string" ||
      typeof film.type !== "string"
    ) {
      throw new Error("Invalid film value: expected { vendor, type }.");
    }
    out.film = { vendor: film.vendor, type: film.type };
  }
  if (p.location !== undefined) {
    const loc = p.location as Record<string, unknown>;
    if (
      typeof loc !== "object" || loc === null ||
      typeof loc.lat !== "number" ||
      typeof loc.lng !== "number"
    ) {
      throw new Error("Invalid location: expected { lat, lng }.");
    }
    out.location = {
      lat: loc.lat,
      lng: loc.lng,
      display_name: typeof loc.display_name === "string" ? loc.display_name : "",
    };
  }
  return out;
}

async function geocodeQuery(
  query: string,
  mapboxToken: string
): Promise<{ lat: number; lng: number; display_name: string; iana_timezone: string }> {
  const url = new URL("https://api.mapbox.com/search/geocode/v6/forward");
  url.searchParams.set("q", query);
  url.searchParams.set("access_token", mapboxToken);
  url.searchParams.set("limit", "1");
  const resp = await fetch(url.toString());
  const data = await resp.json();
  const feature = data.features?.[0];
  if (!feature) throw new Error(`No results for "${query}"`);
  const [lng, lat] = feature.geometry.coordinates;
  const display_name = feature.properties.full_address ?? query;
  const iana_timezone = await tauriCommands.resolveTimezone(lat, lng);
  return { lat, lng, display_name, iana_timezone };
}

export async function runVibeTag(
  apiKey: string,
  messages: VibeTagMessage[],
  selectedPhotoCount: number,
  currentMetadataSummary: object,
  mapboxToken: string | null
): Promise<{ proposal: MetadataProposal; devData: VibeTagDevData }> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace(
    "{{ISO_DATE}}",
    new Date().toISOString().slice(0, 10)
  )
    .replace("{{COUNT}}", String(selectedPhotoCount))
    .replace("{{JSON_SUMMARY}}", JSON.stringify(currentMetadataSummary, null, 2));

  const apiMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const rawResponses: Anthropic.Message[] = [];

  let response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    tools: [GEOCODE_TOOL],
    messages: apiMessages,
  });
  rawResponses.push(response);

  let geocodedLocation: { lat: number; lng: number; display_name: string } | null = null;
  let geocodedTimezone: string | null = null;

  // Handle tool use loop
  while (response.stop_reason === "tool_use") {
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      if (toolUse.name === "geocode_location") {
        const input = toolUse.input as { query: string };
        try {
          const result = await geocodeQuery(input.query, mapboxToken ?? "");
          geocodedLocation = { lat: result.lat, lng: result.lng, display_name: result.display_name };
          geocodedTimezone = result.iana_timezone;
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: `Error: ${err}`,
            is_error: true,
          });
        }
      }
    }

    response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: systemPrompt,
      tools: [GEOCODE_TOOL],
      messages: [
        ...apiMessages,
        { role: "assistant", content: response.content },
        { role: "user", content: toolResults },
      ],
    });
    rawResponses.push(response);
  }

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  if (!textBlock) throw new Error("No text response from Claude");

  const text = textBlock.text.trim();
  if (text === "I couldn't figure out what you meant") {
    throw new Error("I couldn't figure out what you meant");
  }

  // Extract JSON (may be wrapped in ```json ... ```)
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
  const jsonStr = jsonMatch ? jsonMatch[1] : text;

  let proposal: MetadataProposal;
  try {
    proposal = validateProposal(JSON.parse(jsonStr));
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error("Claude returned an invalid response. Please try again.");
    }
    throw err instanceof Error ? err : new Error("Claude returned an invalid response. Please try again.");
  }

  // If geocoding ran but Claude omitted the location/timezone from its JSON, inject them.
  if (geocodedLocation && !proposal.location) {
    proposal.location = geocodedLocation;
  }
  if (proposal.location && !proposal.timezone && geocodedTimezone) {
    proposal.timezone = geocodedTimezone;
  }

  return { proposal, devData: { rawResponses } };
}
