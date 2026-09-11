"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { NaturalLanguageTaskResult } from "@/hooks/useSimulationSocket";

const EXAMPLES = [
  "rush a pallet from Charge Bay 1 to Dock A",
  "deliver a container to Zone 5 ASAP",
  "move stock from Dock B to Zone 2",
];

/**
 * Operator command line: free text in, a real task out — see
 * lib/llm/taskParser.ts. Uses a live LLM call when the server has
 * ANTHROPIC_API_KEY set, a deterministic rule-based parser otherwise; the
 * feedback line always says which one actually ran so this isn't a black box.
 */
export function NaturalLanguageBar({
  onSubmit,
}: {
  onSubmit: (text: string) => Promise<NaturalLanguageTaskResult>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<NaturalLanguageTaskResult | null>(null);
  const [placeholder] = useState(() => EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setResult(null);
    const res = await onSubmit(trimmed);
    setResult(res);
    setBusy(false);
    if (res.ok) setText("");
  }

  return (
    <div className="border-b border-line bg-surface px-4 py-2 flex flex-wrap items-center gap-3">
      <form onSubmit={handleSubmit} className="flex items-center gap-2 flex-1 min-w-[260px]">
        <span className="font-mono text-[11px] uppercase tracking-wide text-[#8b8677]">Tell the fleet</span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
          disabled={busy}
          className="flex-1 min-w-[180px] bg-surface2 border border-line rounded-sm px-2.5 py-1.5 text-xs font-body text-[#ecebe6] placeholder:text-[#5c584e] focus:outline-none focus:border-edge disabled:opacity-50"
        />
        <Button variant="primary" type="submit" disabled={busy || !text.trim()}>
          {busy ? "Parsing…" : "Send"}
        </Button>
      </form>

      {result && (
        <div className="font-mono text-[11px] text-[#8b8677] flex items-center gap-2 max-w-full">
          {result.ok && result.parsed ? (
            <>
              <Badge tone={result.parsed.usedLLM ? "edge" : "neutral"}>
                {result.parsed.usedLLM ? `LLM · ${result.parsed.model ?? "claude"}` : "rule-based parser"}
              </Badge>
              <span>
                {result.parsed.pickupLabel} → {result.parsed.dropoffLabel}
                {result.parsed.urgent ? " · urgent" : ""}
              </span>
              {result.parsed.note && <span className="text-warn">({result.parsed.note})</span>}
            </>
          ) : (
            <span className="text-bad">{result.error ?? "couldn't create that task"}</span>
          )}
        </div>
      )}
    </div>
  );
}
