import type { ReactNode } from "react";

interface MetricCardProps {
  label: string;
  value: string;
  tone?: "neutral" | "safe" | "caution" | "danger";
  hint?: string;
  kicker?: ReactNode;
}

const toneClasses = {
  neutral: "text-text",
  safe: "text-safe",
  caution: "text-caution",
  danger: "text-danger",
};

export function MetricCard({ label, value, tone = "neutral", hint, kicker }: MetricCardProps) {
  return (
    <div className="panel-soft rounded-2xl p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.22em] text-muted">{label}</div>
        {kicker}
      </div>
      <div className={`text-2xl font-semibold ${toneClasses[tone]}`}>{value}</div>
      {hint ? <div className="mt-2 text-sm text-muted">{hint}</div> : null}
    </div>
  );
}
