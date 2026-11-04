import { PnlPeriodControl, PnlViewToggle, usePnlPeriod } from "./PnlPeriodControl";
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
  quarterlyPnl?: number | null;
  quarterlyPnlPct?: number | null;
  quarterlyPnlHint?: string;
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
  quarterlyPnl,
  quarterlyPnlPct,
  quarterlyPnlHint,
  totalPnlHint,
  todayPnlHint,
  monthlyPnlHint,
  netWorthHint,
}: AccountSourceSummaryCardsProps) {
  const { period } = usePnlPeriod();
  const periodPnl = period === "month" ? monthlyPnl : quarterlyPnl;
  const periodPct = period === "month" ? monthlyPnlPct : quarterlyPnlPct;
  const periodHint = period === "month" ? monthlyPnlHint : quarterlyPnlHint;
  const notes = [...new Set([totalPnlHint, todayPnlHint, netWorthHint].filter(Boolean))];
  return (
    <div className="grid gap-3">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label={<span className="flex h-[34px] items-center">Total PnL</span>}
          secondaryValue={fmtSignedPct(totalPnlPct) ?? null}
          tone={pnlMetricTone(totalPnl)}
          value={fmtCurrency(totalPnl)}
        />
        <MetricCard
          label={<span className="flex h-[34px] items-center">Today's PnL</span>}
          secondaryValue={fmtSignedPct(todayPnlPct) ?? null}
          tone={pnlMetricTone(todayPnl)}
          value={fmtCurrency(todayPnl)}
        />
        <MetricCard
          label={<PnlPeriodControl />}
          kicker={<PnlViewToggle />}
          secondaryValue={fmtSignedPct(periodPct) ?? null}
          tone={pnlMetricTone(periodPnl)}
          value={fmtCurrency(periodPnl)}
        />
        <MetricCard label={<span className="flex h-[34px] items-center">Net Worth</span>} value={fmtCurrency(netWorth)} />
      </div>
      {periodHint ? <p className="text-sm text-caution" role="status">{periodHint}</p> : periodPnl == null && netWorth != null ? (
        <p className="text-sm text-muted" role="status">{period === "month" ? "Month" : "Quarter"} PnL is unavailable; opening history is missing.</p>
      ) : null}
      {notes.length ? (
        <details className="text-sm text-muted">
          <summary className="w-fit cursor-pointer rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">Calculation notes</summary>
          <div className="mt-2 grid gap-1">{notes.map((note) => <p key={note}>{note}</p>)}</div>
        </details>
      ) : null}
    </div>
  );
}

function pnlMetricTone(value: number | null | undefined): "neutral" | "safe" | "danger" {
  if (value == null || Number.isNaN(value) || value === 0) {
    return "neutral";
  }
  return value > 0 ? "safe" : "danger";
}
