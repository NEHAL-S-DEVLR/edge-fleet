import { NextResponse } from "next/server";
import { getStore } from "@/lib/state/store";
import { killRobot } from "@/lib/simulation/engine";

// The resilience demo, half B: kill one robot mid-task and watch the fleet
// re-auction its work and route around its now-dead body in the aisle.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const state = getStore();
  killRobot(state, params.id);
  return NextResponse.json({ ok: true });
}
