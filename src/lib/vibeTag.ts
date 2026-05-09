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
- location: call the geocode_location tool to resolve a place name to coordinates

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
): Promise<MetadataProposal> {
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

  let response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: systemPrompt,
    tools: [GEOCODE_TOOL],
    messages: apiMessages,
  });

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
    proposal = JSON.parse(jsonStr);
  } catch {
    throw new Error("Claude returned an invalid response. Please try again.");
  }

  return proposal;
}
