import { NextResponse } from "next/server";
import { getStore, logMessage } from "@/lib/state/store";

export async function POST() {
  const state = getStore();
  if (!state.running) {
    state.running = true;
    logMessage(state, "sim-start", "system", "Simulation started");
  }
  return NextResponse.json({ ok: true, running: state.running });
}
