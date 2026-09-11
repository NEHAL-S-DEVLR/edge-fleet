import { NextResponse } from "next/server";
import { getStore } from "@/lib/state/store";
import { createTask } from "@/lib/simulation/taskServer";

// see app/api/state/route.ts for why this is required on live-data GETs
export const dynamic = "force-dynamic";

// POST /api/tasks — manually inject a task (optionally with a chosen
// pickup/dropoff node id), so a judge can trigger a specific scenario
// instead of waiting for the task server's random schedule.
export async function POST(req: Request) {
  const state = getStore();
  let body: { pickup?: number; dropoff?: number; urgent?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // no body is fine — a fully random task is created
  }
  const task = createTask(state, body.pickup, body.dropoff, body.urgent);
  return NextResponse.json({ ok: true, task });
}

export async function GET() {
  const state = getStore();
  return NextResponse.json({ tasks: state.tasks });
}
