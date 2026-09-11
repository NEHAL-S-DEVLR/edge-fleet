export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "warn" | "bad" | "edge";
}) {
  const toneClass: Record<string, string> = {
    neutral: "text-[#8b8677] border-line",
    good: "text-good border-good/40",
    warn: "text-warn border-warn/40",
    bad: "text-bad border-bad/40",
    edge: "text-edge border-edge/40",
  };
  return (
    <span
      className={`font-mono text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-sm border ${toneClass[tone]}`}
    >
      {children}
    </span>
  );
}
