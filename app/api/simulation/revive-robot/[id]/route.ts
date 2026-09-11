import { NextResponse } from "next/server";
import { getStore } from "@/lib/state/store";
import { reviveRobot } from "@/lib/simulation/engine";

// Not in the original directory sketch, added so the kill-switch demo can
// be reset without restarting the whole server between rehearsals.
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const state = getStore();
  reviveRobot(state, params.id);
  return NextResponse.json({ ok: true });
}
