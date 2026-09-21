"use client";

// Wires lib/simulation/scenarios.ts's named deployment presets into an
// actual dashboard control (README's "Next steps" previously flagged this
// as reachable only via SCENARIO=<key> npm run dev / a raw POST — this is
// the UI for it). Pure data import: scenarios.ts has no server-only
// dependency, so it's safe to bundle straight into this client component.
import { useState, useRef, useEffect } from "react";
import { SCENARIOS } from "@/lib/simulation/scenarios";

const ENTRIES = Object.entries(SCENARIOS);

export function ScenarioPicker({
  activeKey,
  onSelect,
}: {
  activeKey: string | null;
  onSelect: (key?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const active = activeKey ? SCENARIOS[activeKey] : undefined;
  const label = active ? active.label : "Default fleet";

  function choose(key?: string) {
    setOpen(false);
    onSelect(key);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-[11px] uppercase tracking-wide px-3 py-1.5 rounded-sm border border-line bg-surface2 text-[#aeab9f] hover:text-[#ecebe6] transition flex items-center gap-2"
        title="Switch deployment scenario — resets the simulation"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-edge" />
        {label}
        <span className="text-[9px] opacity-60">▾</span>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-80 rounded-sm border border-line bg-surface shadow-lg overflow-hidden">
          <button
            type="button"
            onClick={() => choose(undefined)}
            className={`w-full text-left px-3 py-2 border-b border-line hover:bg-surface2 transition ${
              !activeKey ? "bg-surface2" : ""
            }`}
          >
            <div className="font-mono text-[11px] uppercase tracking-wide text-[#ecebe6]">Default fleet</div>
            <div className="text-[11px] text-[#8b8677] mt-0.5">8 AMRs, balanced task mix — the plain baseline configuration.</div>
          </button>
          {ENTRIES.map(([key, s]) => (
            <button
              key={key}
              type="button"
              onClick={() => choose(key)}
              className={`w-full text-left px-3 py-2 border-b border-line last:border-b-0 hover:bg-surface2 transition ${
                activeKey === key ? "bg-surface2" : ""
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[11px] uppercase tracking-wide text-[#ecebe6]">{s.label}</span>
                <span className="font-mono text-[10px] text-edge shrink-0">{s.robotCount} {s.robotLabel}</span>
              </div>
              <div className="text-[11px] text-[#8b8677] mt-0.5 leading-snug">{s.blurb}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
