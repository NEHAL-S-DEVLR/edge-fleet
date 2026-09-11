import { NextResponse } from "next/server";
import { getStore } from "@/lib/state/store";
import { createTask } from "@/lib/simulation/taskServer";
import { parseNaturalLanguageTask } from "@/lib/llm/taskParser";

// see app/api/state/route.ts for why this is required on live-data routes
export const dynamic = "force-dynamic";

// POST /api/tasks/natural-language — an operator types "rush a pallet from
// receiving to Dock B" instead of picking raw node ids. Uses a real LLM
// call when ANTHROPIC_API_KEY is set (lib/llm/taskParser.ts), a
// deterministic rule-based parser otherwise. Either way the result is
// validated against the real warehouse graph and handed to the exact same
// createTask() the random task server and the plain /api/tasks route use —
// this does not create a second, different kind of task.
export async function POST(req: Request) {
  const state = getStore();
  let body: { text?: string } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "expected JSON body { text: string }" }, { status: 400 });
  }
  if (typeof body.text !== "string" || !body.text.trim()) {
    return NextResponse.json({ ok: false, error: '"text" is required' }, { status: 400 });
  }

  const parsed = await parseNaturalLanguageTask(state, body.text);
  const task = createTask(state, parsed.pickup, parsed.dropoff, parsed.urgent);

  return NextResponse.json({
    ok: true,
    task,
    parsed: {
      usedLLM: parsed.usedLLM,
      model: parsed.model,
      pickupLabel: parsed.pickupLabel ?? "(unspecified — picked at random)",
      dropoffLabel: parsed.dropoffLabel ?? "(unspecified — picked at random)",
      urgent: parsed.urgent,
      note: parsed.note,
    },
  });
}
