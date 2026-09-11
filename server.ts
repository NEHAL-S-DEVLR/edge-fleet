// Custom server: hosts the Next.js app AND a WebSocket endpoint on the same
// HTTP server/port, and owns the simulation's tick loop.
//
// Why this exists instead of a plain `next dev`: a Next.js route handler
// only lives for the duration of one request — it cannot hold a socket
// open to push live updates, and it has nowhere to run a persistent
// setInterval. This file is the one long-lived Node process for the whole
// app: it boots Next for normal page/API requests, upgrades `/ws`
// connections to WebSocket for the dashboard, and ticks the simulation on
// a fixed interval, broadcasting the new state to every connected
// dashboard after each tick.
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer } from "ws";
import { getStore, getWSClients } from "./lib/state/store";
import { tick } from "./lib/simulation/engine";
import { broadcastState, toPayload } from "./lib/ws/broadcast";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);
const tickMs = parseInt(process.env.TICK_MS || "150", 10);

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url || "/", true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "/");
    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    const clients = getWSClients();
    clients.add(ws);
    // send a full snapshot immediately so a new dashboard tab isn't blank
    // until the next tick fires
    ws.send(JSON.stringify({ type: "state", data: toPayload(getStore()) }));

    ws.on("close", () => clients.delete(ws));
    ws.on("error", () => clients.delete(ws));
  });

  setInterval(() => {
    const store = getStore();
    if (!store.running) return;
    tick(store);
    broadcastState(store);
  }, tickMs);

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`\n  EdgeFleet running → http://localhost:${port}`);
    console.log(`  WebSocket          → ws://localhost:${port}/ws`);
    console.log(`  Tick interval       ${tickMs}ms\n`);
  });
});
