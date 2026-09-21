"use client";

import { useMemo, useState } from "react";
import type { Warehouse, Robot, Task, NodeId } from "@/lib/types";

const CELL = 48;
const PAD = 28;

export function WarehouseCanvas({
  warehouse,
  robots,
  tasks,
  heat,
}: {
  warehouse: Warehouse;
  robots: Robot[];
  tasks: Task[];
  heat?: Record<NodeId, number>;
}) {
  const width = warehouse.cols * CELL + PAD * 2;
  const height = warehouse.rows * CELL + PAD * 2;
  const [showHeat, setShowHeat] = useState(true);

  const nodePos = useMemo(() => {
    const map = new Map<number, { x: number; y: number }>();
    for (const n of warehouse.nodes) {
      map.set(n.id, { x: PAD + n.x * CELL, y: PAD + n.y * CELL });
    }
    return map;
  }, [warehouse]);

  const activeTasks = tasks.filter((t) => t.status !== "completed");
  const heatEntries = useMemo(() => {
    if (!heat) return [];
    // Below this, a node has only just started accumulating heat this tick —
    // not worth painting, or every busy chokepoint would flicker constantly.
    return Object.entries(heat)
      .map(([id, v]) => [Number(id), v] as const)
      .filter(([, v]) => v >= 0.6);
  }, [heat]);

  return (
    <div className="w-full h-full overflow-auto bg-graphite relative">
      {heat && (
        <button
          type="button"
          onClick={() => setShowHeat((v) => !v)}
          className={`absolute top-2 right-2 z-10 font-mono text-[10px] uppercase tracking-wide px-2.5 py-1 rounded-sm border transition ${
            showHeat ? "bg-bad/15 border-bad/50 text-bad" : "bg-surface2 border-line text-[#8b8677]"
          }`}
          title="Toggle the congestion heat-map overlay — nodes where robots keep getting stuck, decaying back down once traffic clears"
        >
          {showHeat ? "● Heat on" : "○ Heat off"}
        </button>
      )}
      <svg width={width} height={height} className="block mx-auto">
        <defs>
          <pattern id="floor-grid" width={CELL} height={CELL} patternUnits="userSpaceOnUse">
            <path d={`M ${CELL} 0 L 0 0 0 ${CELL}`} fill="none" stroke="#1d2023" strokeWidth={1} />
          </pattern>
          <radialGradient id="heat-glow">
            <stop offset="0%" stopColor="#e0584f" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#e0584f" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={width} height={height} fill="url(#floor-grid)" />

        {/* aisles */}
        {warehouse.edges.map((e, i) => {
          const a = nodePos.get(e.from)!;
          const b = nodePos.get(e.to)!;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2a2d31" strokeWidth={10} strokeLinecap="round" />;
        })}

        {/* congestion heat map — nodes where robots keep getting blocked/waiting;
            purely a metrics overlay (state.heat), never read by the engine, so
            it can't change simulation outcomes, only visualize where it's hurting */}
        {showHeat &&
          heatEntries.map(([nodeId, v]) => {
            const p = nodePos.get(nodeId);
            if (!p) return null;
            const r = 10 + Math.min(20, v * 1.6);
            const opacity = Math.min(0.65, v / 14);
            return (
              <circle
                key={`heat-${nodeId}`}
                cx={p.x}
                cy={p.y}
                r={r}
                fill="url(#heat-glow)"
                opacity={opacity}
                style={{ transition: "r 300ms ease, opacity 300ms ease" }}
              />
            );
          })}

        {/* nodes */}
        {warehouse.nodes.map((n) => {
          const p = nodePos.get(n.id)!;
          if (n.kind === "aisle") return <circle key={n.id} cx={p.x} cy={p.y} r={2} fill="#3a3d42" />;
          const fill = n.kind === "chokepoint" ? "#3fbdb7" : n.kind === "dock" ? "#ff8248" : "#5aab6b";
          return (
            <g key={n.id}>
              <circle cx={p.x} cy={p.y} r={5} fill={fill} opacity={0.85} />
            </g>
          );
        })}

        {/* task pickup/dropoff markers */}
        {activeTasks.map((t) => {
          const pu = nodePos.get(t.pickup);
          const dp = nodePos.get(t.dropoff);
          return (
            <g key={t.id} opacity={0.9}>
              {pu && (
                <rect x={pu.x - 4} y={pu.y - 4} width={8} height={8} fill="none" stroke="#ff8248" strokeWidth={1.5} />
              )}
              {dp && (
                <rect
                  x={dp.x - 4}
                  y={dp.y - 4}
                  width={8}
                  height={8}
                  fill="none"
                  stroke="#3fbdb7"
                  strokeWidth={1.5}
                  transform={`rotate(45 ${dp.x} ${dp.y})`}
                />
              )}
            </g>
          );
        })}

        {/* robots */}
        {robots.map((r) => {
          const p = nodePos.get(r.node);
          if (!p) return null;
          return (
            <g key={r.id} opacity={r.alive ? 1 : 0.35}>
              <circle
                cx={p.x}
                cy={p.y}
                r={11}
                fill={r.alive ? r.color : "#4a4d51"}
                stroke={r.waitTicks > 0 ? "#e0584f" : "#15171a"}
                strokeWidth={r.waitTicks > 0 ? 2.5 : 1.5}
                style={{ transition: "cx 140ms linear, cy 140ms linear" }}
              />
              <text
                x={p.x}
                y={p.y + 22}
                textAnchor="middle"
                fontSize={9}
                fontFamily="'IBM Plex Mono', monospace"
                fill="#8b8677"
                style={{ transition: "x 140ms linear, y 140ms linear" }}
              >
                {r.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
