import { NextResponse } from "next/server";
import { resetStore, logMessage } from "@/lib/state/store";

// POST /api/simulation/reset — optionally accepts { "scenario": "hospital" }
// (see lib/simulation/scenarios.ts for the available keys) to reset into a
// different deployment preset instead of the current one / SCENARIO env var.
export async function POST(req: Request) {
  let scenario: string | undefined;
  try {
    const body = await req.json();
    if (body && typeof body.scenario === "string") scenario = body.scenario;
  } catch {
    // no body (or non-JSON body) is fine — reset uses the current default
  }
  const state = resetStore(scenario);
  logMessage(state, "sim-reset", "system", "Simulation reset to initial state");
  return NextResponse.json({ ok: true });
}
