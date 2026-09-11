import { NextResponse } from "next/server";
import { getStore } from "@/lib/state/store";
import { toPayload } from "@/lib/ws/broadcast";

// GET /api/state — full snapshot, used by the dashboard on first load and
// as a polling fallback if a client's WebSocket connection drops.
//
// IMPORTANT: without this, Next.js statically prerenders this route at
// `next build` time (it looks like a plain GET with no dynamic inputs) and
// then serves that one frozen snapshot forever, no matter what the
// simulation is actually doing. force-dynamic disables that optimization.
export const dynamic = "force-dynamic";

export async function GET() {
  const state = getStore();
  return NextResponse.json(toPayload(state));
}
