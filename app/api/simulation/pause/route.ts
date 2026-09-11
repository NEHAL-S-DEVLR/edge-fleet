import { NextResponse } from "next/server";
import { getStore, logMessage } from "@/lib/state/store";

export async function POST() {
  const state = getStore();
  if (state.running) {
    state.running = false;
    logMessage(state, "sim-pause", "system", "Simulation paused");
  }
  return NextResponse.json({ ok: true, running: state.running });
}
