import { NextResponse } from "next/server";
import { getStore, logMessage } from "@/lib/state/store";
import type { EdgeInferenceReading } from "@/lib/types";

// POST /api/edge-inference — the edge-ai-bridge/edge_infer.py script hits
// this after every onboard inference pass. This is the one HTTP bridge
// between "real hardware/process" and the dashboard; it does not
// participate in movement or coordination — it only reports a latency
// number, which is the whole point (proving inference happens locally and
// fast, not that it drives navigation in this prototype).
export async function POST(req: Request) {
  const state = getStore();
  let body: Partial<EdgeInferenceReading> & { token?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const expected = process.env.EDGE_BRIDGE_TOKEN;
  if (expected && body.token !== expected) {
    return NextResponse.json({ ok: false, error: "bad token" }, { status: 401 });
  }
  if (typeof body.latencyMs !== "number" || typeof body.robotId !== "string") {
    return NextResponse.json({ ok: false, error: "robotId and latencyMs are required" }, { status: 400 });
  }

  const reading: EdgeInferenceReading = {
    robotId: body.robotId,
    latencyMs: body.latencyMs,
    detections: body.detections ?? 0,
    model: body.model ?? "unknown-model",
    receivedAtTick: state.tick,
  };
  state.edgeInference.push(reading);
  if (state.edgeInference.length > 100) {
    state.edgeInference.splice(0, state.edgeInference.length - 100);
  }
  logMessage(
    state,
    "edge-inference",
    reading.robotId,
    `${reading.robotId} onboard inference: ${reading.detections} detection(s) in ${reading.latencyMs.toFixed(1)}ms (${reading.model})`,
    { latencyMs: reading.latencyMs, detections: reading.detections }
  );

  return NextResponse.json({ ok: true });
}
