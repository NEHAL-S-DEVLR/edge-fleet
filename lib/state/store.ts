// Single source of truth for the running simulation.
//
// WHY globalThis: server.ts (run through tsx, outside Next's bundler) and
// the app/api/*/route.ts handlers (compiled by Next's own SWC/webpack
// pipeline) are two different module graphs even though they run in the
// same Node process. A plain module-scoped variable would end up
// duplicated — the tick loop would mutate one copy while API routes read
// another. Stashing the store on globalThis guarantees every part of the
// app reads and writes the exact same object, the same trick Next.js docs
// recommend for singletons (e.g. a Prisma client) under hot-reload.
import type { SimulationState, MessageLogEntry, MessageType } from "@/lib/types";
import { createInitialState, type CreateStateOptions } from "@/lib/simulation/warehouse";
import { getScenario } from "@/lib/simulation/scenarios";

/** Resolves a scenario preset (see lib/simulation/scenarios.ts) into
 * createInitialState() options. Defaults to the SCENARIO env var so a demo
 * operator can boot the whole server into a preset without touching code,
 * e.g. `SCENARIO=hospital npm run dev`; an explicit key (e.g. from a
 * reset-with-scenario API call) overrides the environment. */
function resolveStateOptions(scenarioKey?: string): CreateStateOptions {
  const scenario = getScenario(scenarioKey ?? process.env.SCENARIO);
  if (!scenario) return {};
  const { label, robotLabel, blurb, ...options } = scenario;
  return options;
}

declare global {
  // eslint-disable-next-line no-var
  var __edgefleetStore: SimulationState | undefined;
  // eslint-disable-next-line no-var
  var __edgefleetWSClients: Set<import("ws").WebSocket> | undefined;
  // eslint-disable-next-line no-var
  var __edgefleetMsgId: number | undefined;
}

export function getStore(): SimulationState {
  if (!globalThis.__edgefleetStore) {
    globalThis.__edgefleetStore = createInitialState(resolveStateOptions());
  }
  return globalThis.__edgefleetStore;
}

/** Resets the running simulation. Pass a scenario key (see scenarios.ts) to
 * switch presets on reset; otherwise falls back to the SCENARIO env var. */
export function resetStore(scenarioKey?: string): SimulationState {
  globalThis.__edgefleetStore = createInitialState(resolveStateOptions(scenarioKey));
  return globalThis.__edgefleetStore;
}

export function getWSClients(): Set<import("ws").WebSocket> {
  if (!globalThis.__edgefleetWSClients) {
    globalThis.__edgefleetWSClients = new Set();
  }
  return globalThis.__edgefleetWSClients;
}

/** Appends to the message log (ring buffer, capped) and returns the entry. */
export function logMessage(
  state: SimulationState,
  type: MessageType,
  from: string,
  text: string,
  payload?: Record<string, unknown>
): MessageLogEntry {
  if (globalThis.__edgefleetMsgId === undefined) globalThis.__edgefleetMsgId = 0;
  const entry: MessageLogEntry = {
    id: globalThis.__edgefleetMsgId++,
    tick: state.tick,
    type,
    from,
    text,
    payload,
  };
  state.messages.push(entry);
  if (state.messages.length > 200) {
    state.messages.splice(0, state.messages.length - 200);
  }
  return entry;
}
