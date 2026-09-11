import { NextResponse } from "next/server";
import { getStore } from "@/lib/state/store";
import { reviveTaskServer } from "@/lib/simulation/engine";

export async function POST() {
  const state = getStore();
  reviveTaskServer(state);
  return NextResponse.json({ ok: true, taskServerAlive: state.taskServerAlive });
}
