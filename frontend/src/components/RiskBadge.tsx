import type { RiskLevel } from "../lib/types";

const classes: Record<RiskLevel, string> = {
  Low: "border-safe/30 bg-safe/10 text-safe",
  Moderate: "border-caution/30 bg-caution/10 text-caution",
  Elevated: "border-caution/40 bg-caution/15 text-caution",
  High: "border-danger/35 bg-danger/10 text-danger",
};

export function RiskBadge({ level }: { level: RiskLevel }) {
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${classes[level]}`}>{level}</span>;
}
