import type { ReactNode } from "react";

interface MetricCardProps {
  label: string;
  value: string;
  secondaryValue?: string | null;
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

export function MetricCard({ label, value, secondaryValue = null, tone = "neutral", hint, kicker }: MetricCardProps) {
  return (
    <div className="panel-soft rounded-2xl p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.22em] text-muted">{label}</div>
        {kicker}
      </div>
      <div className={`text-2xl font-semibold ${toneClasses[tone]}`}>{value}</div>
      {secondaryValue ? <div className={`mt-1 text-sm font-medium ${toneClasses[tone]}`}>{secondaryValue}</div> : null}
      {hint ? <div className="mt-2 text-sm text-muted">{hint}</div> : null}
    </div>
  );
}
