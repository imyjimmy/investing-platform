export type InlinePillTone = "neutral" | "safe" | "caution" | "danger" | "accent";

export function InlinePill({ label, tone = "neutral" }: { label: string; tone?: InlinePillTone }) {
  const toneClasses = {
    neutral: "border-line/80 bg-panelSoft text-muted",
    safe: "border-safe/25 bg-safe/10 text-safe",
    caution: "border-caution/25 bg-caution/10 text-caution",
    danger: "border-danger/25 bg-danger/10 text-danger",
    accent: "border-accent/25 bg-accent/10 text-accent",
  } as const;
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] ${toneClasses[tone]}`}>{label}</span>;
}
