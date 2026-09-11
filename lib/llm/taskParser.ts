// Natural-language task intake — the "using an LLM" half of the fleet.
//
// An operator shouldn't have to know that Dock B is node 42. They should be
// able to type "rush a pallet from receiving to Dock B" and have that turn
// into a real task the decentralized auction (lib/simulation/auction.ts)
// bids on exactly like any other. This file is that translation layer.
//
// Same honesty pattern the codebase already uses for edge_infer.py's HOG-vs-
// ONNX detector: a real LLM call when ANTHROPIC_API_KEY is set, and a
// deterministic rule-based fallback when it isn't — so the natural-language
// box still works live at a demo with no network/key, just with less
// flexible phrasing. Both paths return the exact same shape, and both are
// validated against the warehouse's real node graph before anything is
// created — an LLM (or a regex) hallucinating "Dock Z" must not silently
// create a task pointed at a location that doesn't exist.
import type { NodeId, SimulationState } from "@/lib/types";
import { findLocationByLabel, namedLocations, type NamedLocation } from "@/lib/simulation/warehouse";

export interface ParsedTask {
  /** undefined means "let taskServer.createTask() pick a random node", same
   * as calling the existing POST /api/tasks with no body. */
  pickup?: NodeId;
  dropoff?: NodeId;
  urgent: boolean;
  pickupLabel: string | null;
  dropoffLabel: string | null;
  usedLLM: boolean;
  model?: string;
  /** Present when the LLM path ran but degraded to a partial/failed parse
   * — surfaced to the operator rather than silently swallowed. */
  note?: string;
}

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest";
const URGENT_WORDS = /\b(urgent|rush|asap|a\.?s\.?a\.?p\.?|stat|immediately|priority|emergency|hurry)\b/i;

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Pull the first {...} JSON object out of an LLM response, tolerating
 * ```json fences or a stray sentence before/after — models do this often
 * enough that a plain JSON.parse(response) is too brittle to rely on. */
function extractJson(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Resolves whatever label string a parser (LLM or rule-based) produced
 * back to a real node id, refusing anything not in the warehouse's actual
 * gazetteer. This is the guardrail against a hallucinated location. */
function resolveLabel(state: SimulationState, label: unknown): NamedLocation | undefined {
  if (typeof label !== "string" || !label.trim()) return undefined;
  // allow a raw node reference too ("node 42", "@42") for power users
  const nodeRefMatch = label.match(/^\s*@?(?:node\s*)?(\d+)\s*$/i);
  if (nodeRefMatch) {
    const id = Number(nodeRefMatch[1]);
    const node = state.warehouse.nodes.find((n) => n.id === id);
    if (node) return { id: node.id, label: node.label ?? `node ${node.id}`, kind: node.kind };
  }
  return findLocationByLabel(state.warehouse, label);
}

async function parseWithLLM(state: SimulationState, text: string): Promise<ParsedTask | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const locations = namedLocations(state.warehouse);
  const gazetteer = locations.map((l) => `${l.label} (${l.kind})`).join(", ");
  const system =
    `You turn a warehouse operator's free-text request into a task for an autonomous mobile robot fleet.\n` +
    `Known locations in this warehouse (use EXACTLY one of these strings, or null if unclear):\n${gazetteer}\n\n` +
    `Reply with ONLY a JSON object, no prose, no markdown fence:\n` +
    `{"pickupLabel": string|null, "dropoffLabel": string|null, "urgent": boolean}\n` +
    `"pickupLabel"/"dropoffLabel" must each be either null or copied verbatim from the location list above. ` +
    `If the request only names one location, put it in whichever role ("from"/"pickup" vs "to"/"dropoff"/"deliver") the wording implies, and leave the other null.`;

  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 300,
        system,
        messages: [{ role: "user", content: text }],
      }),
    });
  } catch (e) {
    return {
      urgent: URGENT_WORDS.test(text),
      pickupLabel: null,
      dropoffLabel: null,
      usedLLM: true,
      model: DEFAULT_MODEL,
      note: `LLM request failed (${(e as Error).message}) — falling back to rule-based parsing`,
    };
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    return {
      urgent: URGENT_WORDS.test(text),
      pickupLabel: null,
      dropoffLabel: null,
      usedLLM: true,
      model: DEFAULT_MODEL,
      note: `LLM API returned ${resp.status} — falling back to rule-based parsing${body ? `: ${body.slice(0, 200)}` : ""}`,
    };
  }

  const data = (await resp.json()) as { content?: { type: string; text?: string }[] };
  const textBlock = data.content?.find((b) => b.type === "text")?.text ?? "";
  const parsed = extractJson(textBlock) as { pickupLabel?: unknown; dropoffLabel?: unknown; urgent?: unknown } | null;
  if (!parsed) {
    return {
      urgent: URGENT_WORDS.test(text),
      pickupLabel: null,
      dropoffLabel: null,
      usedLLM: true,
      model: DEFAULT_MODEL,
      note: "LLM response wasn't valid JSON — falling back to rule-based parsing",
    };
  }

  const pickup = resolveLabel(state, parsed.pickupLabel);
  const dropoff = resolveLabel(state, parsed.dropoffLabel);
  const notes: string[] = [];
  if (parsed.pickupLabel && !pickup) notes.push(`couldn't match pickup "${String(parsed.pickupLabel)}" to a real location`);
  if (parsed.dropoffLabel && !dropoff) notes.push(`couldn't match dropoff "${String(parsed.dropoffLabel)}" to a real location`);

  return {
    pickup: pickup?.id,
    dropoff: dropoff?.id,
    pickupLabel: pickup?.label ?? null,
    dropoffLabel: dropoff?.label ?? null,
    urgent: typeof parsed.urgent === "boolean" ? parsed.urgent : URGENT_WORDS.test(text),
    usedLLM: true,
    model: DEFAULT_MODEL,
    note: notes.length ? notes.join("; ") : undefined,
  };
}

/** No API key / LLM call degraded: find named locations mentioned in the
 * text by simple substring matching, in order of appearance. First mention
 * is pickup, second is dropoff — unless "to"/"deliver"/"dropoff" clearly
 * precedes one of them, in which case that one wins the dropoff role. */
function parseWithRules(state: SimulationState, text: string): ParsedTask {
  const norm = normalize(text);
  const locations = namedLocations(state.warehouse);

  const mentions: { loc: NamedLocation; index: number }[] = [];
  for (const loc of locations) {
    const idx = norm.indexOf(normalize(loc.label));
    if (idx !== -1) mentions.push({ loc, index: idx });
  }
  mentions.sort((a, b) => a.index - b.index);

  let pickup: NamedLocation | undefined;
  let dropoff: NamedLocation | undefined;

  // dedupe (a label substring of another, e.g. "Dock A" inside nothing here,
  // but be defensive) by node id
  const seen = new Set<number>();
  const uniqueMentions = mentions.filter((m) => (seen.has(m.loc.id) ? false : (seen.add(m.loc.id), true)));

  const toIdx = norm.search(/\b(to|deliver to|drop(?:\s|-)?off(?:\s+at)?|dropoff)\b/);
  const fromIdx = norm.search(/\b(from|pick(?:\s|-)?up(?:\s+at)?|at)\b/);

  if (uniqueMentions.length >= 2) {
    // Prefer explicit "from X ... to Y" ordering when both keywords are present;
    // otherwise just use appearance order (first = pickup, second = dropoff).
    if (fromIdx !== -1 && toIdx !== -1) {
      const byPreposition = [...uniqueMentions].sort((a, b) => {
        const aRole = a.index > fromIdx && (toIdx === -1 || a.index < toIdx) ? 0 : 1;
        const bRole = b.index > fromIdx && (toIdx === -1 || b.index < toIdx) ? 0 : 1;
        return aRole - bRole || a.index - b.index;
      });
      [pickup, dropoff] = byPreposition.map((m) => m.loc);
    } else {
      [pickup, dropoff] = uniqueMentions.map((m) => m.loc);
    }
  } else if (uniqueMentions.length === 1) {
    const only = uniqueMentions[0];
    // "bring/take/send it TO Dock B" => dropoff; "pick up FROM Dock B" => pickup
    if (toIdx !== -1 && (fromIdx === -1 || toIdx < fromIdx || only.index >= toIdx)) {
      dropoff = only.loc;
    } else {
      pickup = only.loc;
    }
  }

  return {
    pickup: pickup?.id,
    dropoff: dropoff?.id,
    pickupLabel: pickup?.label ?? null,
    dropoffLabel: dropoff?.label ?? null,
    urgent: URGENT_WORDS.test(text),
    usedLLM: false,
  };
}

export async function parseNaturalLanguageTask(state: SimulationState, text: string): Promise<ParsedTask> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { urgent: false, pickupLabel: null, dropoffLabel: null, usedLLM: false, note: "empty request" };
  }

  const llmResult = await parseWithLLM(state, trimmed);
  if (llmResult && (llmResult.pickup !== undefined || llmResult.dropoff !== undefined)) {
    return llmResult;
  }
  // No API key, LLM call failed, or the LLM resolved neither location —
  // fall back to the rule-based parser. If the LLM path DID run but only
  // degraded (note set), carry that note forward for transparency.
  const ruleResult = parseWithRules(state, trimmed);
  if (llmResult?.note && !ruleResult.note) ruleResult.note = llmResult.note;
  return ruleResult;
}
