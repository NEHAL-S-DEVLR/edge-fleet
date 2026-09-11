"use client";

import { useMemo } from "react";
import type { Warehouse, Robot, Task } from "@/lib/types";

const CELL = 48;
const PAD = 28;

export function WarehouseCanvas({ warehouse, robots, tasks }: { warehouse: Warehouse; robots: Robot[]; tasks: Task[] }) {
  const width = warehouse.cols * CELL + PAD * 2;
  const height = warehouse.rows * CELL + PAD * 2;

  const nodePos = useMemo(() => {
    const map = new Map<number, { x: number; y: number }>();
    for (const n of warehouse.nodes) {
      map.set(n.id, { x: PAD + n.x * CELL, y: PAD + n.y * CELL });
    }
    return map;
  }, [warehouse]);

  const activeTasks = tasks.filter((t) => t.status !== "completed");

  return (
    <div className="w-full h-full overflow-auto bg-graphite">
      <svg width={width} height={height} className="block mx-auto">
        <defs>
          <pattern id="floor-grid" width={CELL} height={CELL} patternUnits="userSpaceOnUse">
            <path d={`M ${CELL} 0 L 0 0 0 ${CELL}`} fill="none" stroke="#1d2023" strokeWidth={1} />
          </pattern>
        </defs>
        <rect width={width} height={height} fill="url(#floor-grid)" />

        {/* aisles */}
        {warehouse.edges.map((e, i) => {
          const a = nodePos.get(e.from)!;
          const b = nodePos.get(e.to)!;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2a2d31" strokeWidth={10} strokeLinecap="round" />;
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
