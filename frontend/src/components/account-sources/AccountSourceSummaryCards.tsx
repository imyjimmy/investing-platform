import { fmtCurrency, fmtSignedPct } from "../../lib/formatters";
import { MetricCard } from "../MetricCard";

interface AccountSourceSummaryCardsProps {
  totalPnl: number | null | undefined;
  todayPnl: number | null | undefined;
  monthlyPnl: number | null | undefined;
  netWorth: number | null | undefined;
  totalPnlPct?: number | null | undefined;
  todayPnlPct?: number | null | undefined;
  monthlyPnlPct?: number | null | undefined;
  totalPnlHint?: string;
  todayPnlHint?: string;
  monthlyPnlHint?: string;
  netWorthHint?: string;
}

export function AccountSourceSummaryCards({
  totalPnl,
  todayPnl,
  monthlyPnl,
  netWorth,
  totalPnlPct,
  todayPnlPct,
  monthlyPnlPct,
  totalPnlHint,
  todayPnlHint,
  monthlyPnlHint,
  netWorthHint,
}: AccountSourceSummaryCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <MetricCard
        hint={totalPnlHint}
        label="Total PnL"
        secondaryValue={fmtSignedPct(totalPnlPct) ?? null}
        tone={pnlMetricTone(totalPnl)}
        value={fmtCurrency(totalPnl)}
      />
      <MetricCard
        hint={todayPnlHint}
        label="Today's PnL"
        secondaryValue={fmtSignedPct(todayPnlPct) ?? null}
        tone={pnlMetricTone(todayPnl)}
        value={fmtCurrency(todayPnl)}
      />
      <MetricCard
        hint={monthlyPnlHint}
        label="Month PnL"
        secondaryValue={fmtSignedPct(monthlyPnlPct) ?? null}
        tone={pnlMetricTone(monthlyPnl)}
        value={fmtCurrency(monthlyPnl)}
      />
      <MetricCard hint={netWorthHint} label="Net Worth" value={fmtCurrency(netWorth)} />
    </div>
  );
}

function pnlMetricTone(value: number | null | undefined): "neutral" | "safe" | "danger" {
  if (value == null || Number.isNaN(value) || value === 0) {
    return "neutral";
  }
  return value > 0 ? "safe" : "danger";
}
