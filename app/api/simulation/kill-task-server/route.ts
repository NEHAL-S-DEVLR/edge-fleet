import { NextResponse } from "next/server";
import { getStore } from "@/lib/state/store";
import { killTaskServer } from "@/lib/simulation/engine";

// The resilience demo, half A: kill the one component that looks central.
export async function POST() {
  const state = getStore();
  killTaskServer(state);
  return NextResponse.json({ ok: true, taskServerAlive: state.taskServerAlive });
}
