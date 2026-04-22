import type { ChainRow, OptionChainResponse, OptionPosition, TickerOverviewResponse } from "../../lib/types";
import { MetricCard } from "../MetricCard";
import { Panel } from "../Panel";

type TicketContractSide = "C" | "P";

export type OptionToolSharedProps = {
  chainSymbol: string;
  activeDisplayedChain: OptionChainResponse | null;
  displayedChainRows: ChainRow[];
  activeExpiry?: string;
  optionPositions: OptionPosition[];
  tickerOverview?: TickerOverviewResponse;
  optionsDataSourceLabel: string;
  onLoadTicket: (row: ChainRow, right: TicketContractSide) => void;
  onOpenChain: () => void;
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const currencySmall = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const wholeNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

function fmtCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return currency.format(value);
}

function fmtCurrencySmall(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return currencySmall.format(value);
}

function fmtNumber(value: number | null | undefined, suffix = "") {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return `${number.format(value)}${suffix}`;
}

function fmtWholeNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "-";
  }
  return wholeNumber.format(value);
}

function pnlTone(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "text-muted";
  }
  if (value > 0) {
    return "text-safe";
  }
  if (value < 0) {
    return "text-danger";
  }
  return "text-text";
}

function averageNullable(values: Array<number | null | undefined>) {
  const validValues = values.filter((value): value is number => value != null && !Number.isNaN(value));
  if (!validValues.length) {
    return null;
  }
  return validValues.reduce((total, value) => total + value, 0) / validValues.length;
}

function titleCaseLabel(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function yearsUntil(expiry: string | undefined) {
  if (!expiry) {
    return null;
  }
  const expiryTime = new Date(`${expiry}T21:00:00Z`).getTime();
  if (!Number.isFinite(expiryTime)) {
    return null;
  }
  const days = Math.max(1, Math.ceil((expiryTime - Date.now()) / 86_400_000));
  return days / 365;
}

function annualizedReturn(returnPct: number | null, expiry: string | undefined) {
  const years = yearsUntil(expiry);
  if (returnPct == null || years == null || years <= 0) {
    return null;
  }
  return (returnPct / 100 / years) * 100;
}

function presentValue(amount: number, year: number, discountRatePct: number) {
  return amount / (1 + discountRatePct / 100) ** year;
}

function twoStageFairValue(
  startingCashFlow: number,
  stageOneGrowthPct: number,
  stageTwoGrowthPct: number,
  discountRatePct: number,
  terminalMultiple: number,
) {
  if (startingCashFlow <= 0 || terminalMultiple <= 0 || discountRatePct <= 0) {
    return null;
  }
  let cashFlow = startingCashFlow;
  let value = 0;
  for (let year = 1; year <= 5; year += 1) {
    cashFlow *= 1 + stageOneGrowthPct / 100;
    value += presentValue(cashFlow, year, discountRatePct);
  }
  for (let year = 6; year <= 10; year += 1) {
    cashFlow *= 1 + stageTwoGrowthPct / 100;
    value += presentValue(cashFlow, year, discountRatePct);
  }
  value += presentValue(cashFlow * terminalMultiple, 10, discountRatePct);
  return value;
}

function detailedOneStageFairValue(
  startingCashFlow: number,
  steadyGrowthPct: number,
  discountRatePct: number,
  terminalMultiple: number,
) {
  if (startingCashFlow <= 0 || terminalMultiple <= 0 || discountRatePct <= 0) {
    return null;
  }
  let cashFlow = startingCashFlow;
  let value = 0;
  for (let year = 1; year <= 10; year += 1) {
    cashFlow *= 1 + steadyGrowthPct / 100;
    value += presentValue(cashFlow, year, discountRatePct);
  }
  value += presentValue(cashFlow * terminalMultiple, 10, discountRatePct);
  return value;
}

function dividendDiscountFairValue(dividend: number, dividendGrowthPct: number, discountRatePct: number) {
  if (dividend <= 0 || discountRatePct <= dividendGrowthPct) {
    return null;
  }
  return (dividend * (1 + dividendGrowthPct / 100)) / ((discountRatePct - dividendGrowthPct) / 100);
}

function grahamFairValue(eps: number, growthPct: number, corporateBondYieldPct: number) {
  if (eps <= 0 || corporateBondYieldPct <= 0) {
    return null;
  }
  return eps * (8.5 + 2 * growthPct) * (4.4 / corporateBondYieldPct);
}

function lynchStyleFairValue(eps: number, growthPct: number, dividendYieldPct: number) {
  if (eps <= 0 || growthPct <= 0) {
    return null;
  }
  return eps * (growthPct + dividendYieldPct);
}

type VerdictTone = "safe" | "caution" | "danger" | "neutral";

function verdictClass(tone: VerdictTone) {
  if (tone === "safe") {
    return "border-safe/30 bg-safe/10 text-safe";
  }
  if (tone === "caution") {
    return "border-caution/30 bg-caution/10 text-caution";
  }
  if (tone === "danger") {
    return "border-danger/30 bg-danger/10 text-danger";
  }
  return "border-line/80 bg-panel text-muted";
}

function valuationConclusion(modelValue: number | null, spotPrice: number | null) {
  if (modelValue == null || spotPrice == null) {
    return { label: "Needs inputs", tone: "neutral" as const, detail: "Not enough data to use this model." };
  }
  const gapPct = ((modelValue - spotPrice) / spotPrice) * 100;
  if (gapPct >= 10) {
    return { label: "Supports puts", tone: "safe" as const, detail: `${fmtNumber(gapPct, "%")} above spot.` };
  }
  if (gapPct >= -10) {
    return { label: "Fair-ish", tone: "caution" as const, detail: `${fmtNumber(gapPct, "%")} from spot.` };
  }
  return { label: "Demand discount", tone: "danger" as const, detail: `${fmtNumber(Math.abs(gapPct), "%")} below spot.` };
}

function optionVerdict({
  type,
  strike,
  premium,
  spotPrice,
  blendedFairValue,
  annualizedReturnPct,
}: {
  type: "put" | "call";
  strike: number | null | undefined;
  premium: number | null | undefined;
  spotPrice: number | null;
  blendedFairValue: number | null;
  annualizedReturnPct: number | null;
}) {
  if (strike == null || premium == null || spotPrice == null || blendedFairValue == null || annualizedReturnPct == null) {
    return {
      label: "No conclusion",
      tone: "neutral" as const,
      detail: "Load a chain and ticker data before judging the premium.",
      bullets: ["Missing strike, premium, fair value, or expiry data."],
    };
  }

  if (type === "put") {
    const effectiveEntry = strike - premium;
    const entryDiscountPct = ((blendedFairValue - effectiveEntry) / blendedFairValue) * 100;
    const enoughPremium = annualizedReturnPct >= 10;
    const valueAligned = effectiveEntry <= blendedFairValue;
    if (valueAligned && enoughPremium) {
      return {
        label: "Worth considering",
        tone: "safe" as const,
        detail: "Premium is adequate and assignment is at or below fair value.",
        bullets: [
          `Effective entry ${fmtCurrencySmall(effectiveEntry)} is ${fmtNumber(entryDiscountPct, "%")} below fair value.`,
          `Annualized return is ${fmtNumber(annualizedReturnPct, "%")}, above the 10% hurdle.`,
        ],
      };
    }
    if (valueAligned) {
      return {
        label: "Fair entry, weak premium",
        tone: "caution" as const,
        detail: "Assignment price is acceptable, but the premium return is thin.",
        bullets: [
          `Effective entry ${fmtCurrencySmall(effectiveEntry)} is at or below fair value.`,
          `Annualized return is ${fmtNumber(annualizedReturnPct, "%")}, below the 10% hurdle.`,
        ],
      };
    }
    return {
      label: "Avoid for now",
      tone: "danger" as const,
      detail: "Assignment would be above the current fair-value anchor.",
      bullets: [
        `Effective entry ${fmtCurrencySmall(effectiveEntry)} is ${fmtNumber(Math.abs(entryDiscountPct), "%")} above fair value.`,
        "The premium does not fix the valuation risk.",
      ],
    };
  }

  const callAwayGainPct = ((strike + premium - spotPrice) / spotPrice) * 100;
  const belowSpot = strike < spotPrice;
  const valueCapOk = strike >= blendedFairValue;
  const enoughPremium = annualizedReturnPct >= 8;
  if (belowSpot) {
    return {
      label: "Likely stock sale",
      tone: "danger" as const,
      detail: "The call is already in the money, so this is not a clean income candidate.",
      bullets: [
        `Strike ${fmtCurrencySmall(strike)} is below spot ${fmtCurrencySmall(spotPrice)}.`,
        "Use only if you are comfortable exiting the shares.",
      ],
    };
  }
  if (valueCapOk && enoughPremium) {
    return {
      label: "Worth considering",
      tone: "safe" as const,
      detail: "Call-away price is above fair value and premium return clears the hurdle.",
      bullets: [
        `Strike ${fmtCurrencySmall(strike)} is above fair value ${fmtCurrencySmall(blendedFairValue)}.`,
        `Total call-away return is ${fmtNumber(callAwayGainPct, "%")}.`,
      ],
    };
  }
  if (valueCapOk) {
    return {
      label: "Price ok, premium thin",
      tone: "caution" as const,
      detail: "The strike is acceptable, but the premium is not very compelling.",
      bullets: [
        `Strike ${fmtCurrencySmall(strike)} is above fair value.`,
        `Annualized return is ${fmtNumber(annualizedReturnPct, "%")}, below the 8% call hurdle.`,
      ],
    };
  }
  return {
    label: "Avoid for now",
    tone: "danger" as const,
    detail: "The strike caps upside below the fair-value anchor.",
    bullets: [
      `Strike ${fmtCurrencySmall(strike)} is below fair value ${fmtCurrencySmall(blendedFairValue)}.`,
      "Premium is not enough compensation for selling too low.",
    ],
  };
}

export function OptionBuilderTool({
  chainSymbol,
  activeDisplayedChain,
  displayedChainRows,
  activeExpiry,
  onLoadTicket,
  onOpenChain,
}: OptionToolSharedProps) {
  const spotPrice = activeDisplayedChain?.underlying.price ?? null;
  const rowsBelowSpot = displayedChainRows.filter((row) => spotPrice != null && row.strike < spotPrice).slice().reverse();
  const rowsAboveSpot = displayedChainRows.filter((row) => spotPrice != null && row.strike > spotPrice);
  const cashSecuredPut = rowsBelowSpot.find((row) => row.putBid != null || row.putMid != null) ?? null;
  const coveredCall = rowsAboveSpot.find((row) => row.callBid != null || row.callMid != null) ?? null;
  const callSpreadLong = rowsAboveSpot.find((row) => row.callAsk != null || row.callMid != null) ?? null;
  const callSpreadShort =
    (callSpreadLong && rowsAboveSpot.find((row) => row.strike > callSpreadLong.strike && (row.callBid != null || row.callMid != null))) || null;
  const putSpreadShort = cashSecuredPut;
  const putSpreadLong =
    (putSpreadShort && rowsBelowSpot.find((row) => row.strike < putSpreadShort.strike && (row.putAsk != null || row.putMid != null))) || null;
  const setupCards = [
    {
      title: "Covered Call",
      detail: coveredCall
        ? `Sell the ${fmtCurrencySmall(coveredCall.strike)} call for roughly ${fmtCurrencySmall(coveredCall.callMid ?? coveredCall.callBid)}.`
        : "Load a chain with calls above spot to stage a covered call.",
      metric: coveredCall ? fmtNumber(coveredCall.distanceFromSpotPct, "% OTM") : "Waiting",
      onLoad: coveredCall ? () => onLoadTicket(coveredCall, "C") : null,
    },
    {
      title: "Cash-Secured Put",
      detail: cashSecuredPut
        ? `Sell the ${fmtCurrencySmall(cashSecuredPut.strike)} put with estimated collateral of ${fmtCurrency(cashSecuredPut.conservativePutCollateral)}.`
        : "Load a chain with puts below spot to stage a cash-secured put.",
      metric: cashSecuredPut ? fmtNumber(Math.abs(cashSecuredPut.distanceFromSpotPct), "% OTM") : "Waiting",
      onLoad: cashSecuredPut ? () => onLoadTicket(cashSecuredPut, "P") : null,
    },
    {
      title: "Call Debit Spread",
      detail:
        callSpreadLong && callSpreadShort
          ? `Buy ${fmtCurrencySmall(callSpreadLong.strike)} / sell ${fmtCurrencySmall(callSpreadShort.strike)} to express upside with defined risk.`
          : "Needs two liquid call strikes above spot.",
      metric: callSpreadLong && callSpreadShort ? `Width ${fmtCurrencySmall(callSpreadShort.strike - callSpreadLong.strike)}` : "Defined risk",
      onLoad: callSpreadLong ? () => onLoadTicket(callSpreadLong, "C") : null,
    },
    {
      title: "Put Credit Spread",
      detail:
        putSpreadShort && putSpreadLong
          ? `Sell ${fmtCurrencySmall(putSpreadShort.strike)} / buy ${fmtCurrencySmall(putSpreadLong.strike)} to define downside risk.`
          : "Needs two liquid put strikes below spot.",
      metric: putSpreadShort && putSpreadLong ? `Width ${fmtCurrencySmall(putSpreadShort.strike - putSpreadLong.strike)}` : "Defined risk",
      onLoad: putSpreadShort ? () => onLoadTicket(putSpreadShort, "P") : null,
    },
  ];

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Symbol" value={activeDisplayedChain?.symbol ?? chainSymbol} />
        <MetricCard label="Expiry" value={activeExpiry ?? "Load chain"} />
        <MetricCard label="Spot" value={fmtCurrencySmall(spotPrice)} />
        <MetricCard label="Rows" value={fmtWholeNumber(displayedChainRows.length)} />
      </div>

      <Panel eyebrow="Strategy Builder" title="Candidate Structures">
        <div className="grid gap-4 lg:grid-cols-2">
          {setupCards.map((card) => (
            <div key={card.title} className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-text">{card.title}</div>
                  <div className="mt-2 text-sm text-muted">{card.detail}</div>
                </div>
                <div className="shrink-0 rounded-full border border-line/80 bg-panel px-3 py-1 text-xs text-muted">{card.metric}</div>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  className="rounded-full border border-accent/25 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:border-accent/45 hover:bg-accent/16 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!card.onLoad}
                  onClick={() => card.onLoad?.()}
                  type="button"
                >
                  Load leg
                </button>
                <button
                  className="rounded-full border border-line/80 bg-panel px-3 py-1.5 text-xs font-medium text-muted transition hover:border-accent/25 hover:text-text"
                  onClick={onOpenChain}
                  type="button"
                >
                  Open chain
                </button>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

export function OptionStructuresTool({ optionPositions }: OptionToolSharedProps) {
  const structures = Array.from(
    optionPositions.reduce((accumulator, position) => {
      const key = position.strategyTag || "unclassified";
      const current = accumulator.get(key) ?? { count: 0, pnl: 0, premium: 0, collateral: 0 };
      current.count += 1;
      current.pnl += (position.unrealizedPnL ?? 0) + (position.realizedPnL ?? 0);
      current.premium += position.premiumEstimate ?? 0;
      current.collateral += position.collateralEstimate ?? 0;
      accumulator.set(key, current);
      return accumulator;
    }, new Map<string, { count: number; pnl: number; premium: number; collateral: number }>()),
  ).sort((left, right) => right[1].count - left[1].count);
  const assignmentRiskCount = optionPositions.filter((position) => position.assignmentRiskLevel === "High").length;
  const coveredCallCount = optionPositions.filter((position) => position.strategyTag === "covered-call").length;

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Open Positions" value={fmtWholeNumber(optionPositions.length)} />
        <MetricCard label="Structures" value={fmtWholeNumber(structures.length)} />
        <MetricCard label="Covered Calls" value={fmtWholeNumber(coveredCallCount)} />
        <MetricCard label="Assignment Watch" value={fmtWholeNumber(assignmentRiskCount)} />
      </div>

      <Panel eyebrow="Position Map" title="Open Option Structures">
        {structures.length ? (
          <div className="overflow-hidden rounded-2xl border border-line/80 bg-panel">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-panel/95 text-[11px] uppercase tracking-[0.18em] text-muted">
                <tr className="border-b border-line/70">
                  <th className="px-4 py-3">Structure</th>
                  <th className="px-4 py-3">Positions</th>
                  <th className="px-4 py-3">Premium</th>
                  <th className="px-4 py-3">Collateral</th>
                  <th className="px-4 py-3">P&L</th>
                </tr>
              </thead>
              <tbody>
                {structures.map(([strategy, summary]) => (
                  <tr key={strategy} className="border-b border-line/70 last:border-b-0">
                    <td className="px-4 py-3 font-medium text-text">{titleCaseLabel(strategy)}</td>
                    <td className="px-4 py-3 text-text">{fmtWholeNumber(summary.count)}</td>
                    <td className="px-4 py-3 text-text">{fmtCurrency(summary.premium)}</td>
                    <td className="px-4 py-3 text-text">{fmtCurrency(summary.collateral)}</td>
                    <td className={`px-4 py-3 ${pnlTone(summary.pnl)}`}>{fmtCurrency(summary.pnl)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
            No open option structures are loaded for the selected account.
          </div>
        )}
      </Panel>
    </div>
  );
}

export function OptionVolatilityTool({ activeDisplayedChain, displayedChainRows, activeExpiry }: OptionToolSharedProps) {
  const nearMoneyRows = displayedChainRows.filter((row) => Math.abs(row.distanceFromSpotPct) <= 10);
  const averageCallIv = averageNullable(nearMoneyRows.map((row) => row.callIV));
  const averagePutIv = averageNullable(nearMoneyRows.map((row) => row.putIV));
  const skew = averageCallIv != null && averagePutIv != null ? averagePutIv - averageCallIv : null;
  const volatilityRows = displayedChainRows
    .map((row) => ({
      ...row,
      maxIv: Math.max(row.callIV ?? Number.NEGATIVE_INFINITY, row.putIV ?? Number.NEGATIVE_INFINITY),
    }))
    .filter((row) => Number.isFinite(row.maxIv))
    .sort((left, right) => right.maxIv - left.maxIv)
    .slice(0, 8);

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Near Call IV" value={fmtNumber(averageCallIv, "%")} />
        <MetricCard label="Near Put IV" value={fmtNumber(averagePutIv, "%")} />
        <MetricCard label="Put Skew" value={fmtNumber(skew, " pts")} />
        <MetricCard label="Expiry" value={activeExpiry ?? "Load chain"} />
      </div>

      <Panel eyebrow="Volatility Surface" title="Highest IV Strikes">
        {volatilityRows.length ? (
          <div className="overflow-hidden rounded-2xl border border-line/80 bg-panel">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-panel/95 text-[11px] uppercase tracking-[0.18em] text-muted">
                <tr className="border-b border-line/70">
                  <th className="px-4 py-3">Strike</th>
                  <th className="px-4 py-3">Distance</th>
                  <th className="px-4 py-3">Call IV</th>
                  <th className="px-4 py-3">Put IV</th>
                  <th className="px-4 py-3">Call OI</th>
                  <th className="px-4 py-3">Put OI</th>
                </tr>
              </thead>
              <tbody>
                {volatilityRows.map((row) => (
                  <tr key={`vol-${row.strike}`} className="border-b border-line/70 last:border-b-0">
                    <td className="px-4 py-3 font-medium text-text">{fmtCurrencySmall(row.strike)}</td>
                    <td className="px-4 py-3 text-muted">{fmtNumber(row.distanceFromSpotPct, "%")}</td>
                    <td className="px-4 py-3 text-text">{fmtNumber(row.callIV, "%")}</td>
                    <td className="px-4 py-3 text-text">{fmtNumber(row.putIV, "%")}</td>
                    <td className="px-4 py-3 text-text">{fmtWholeNumber(row.callOpenInterest)}</td>
                    <td className="px-4 py-3 text-text">{fmtWholeNumber(row.putOpenInterest)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
            Load a chain with implied volatility data to inspect the vol surface.
          </div>
        )}
        {activeDisplayedChain?.quoteNotice ? <div className="mt-3 text-xs text-muted">{activeDisplayedChain.quoteNotice}</div> : null}
      </Panel>
    </div>
  );
}

export function OptionScannerTool({ displayedChainRows, activeExpiry, optionsDataSourceLabel, onLoadTicket }: OptionToolSharedProps) {
  const scannerRows = displayedChainRows
    .flatMap((row) => [
      {
        key: `put-${row.strike}`,
        setup: "Short Put",
        strike: row.strike,
        metric: row.putAnnualizedYieldPct,
        credit: row.putMid ?? row.putBid,
        volume: row.putVolume,
        openInterest: row.putOpenInterest,
        distance: row.distanceFromSpotPct,
        row,
        right: "P" as const,
      },
      {
        key: `call-${row.strike}`,
        setup: "Covered Call",
        strike: row.strike,
        metric: row.callAnnualizedYieldPct,
        credit: row.callMid ?? row.callBid,
        volume: row.callVolume,
        openInterest: row.callOpenInterest,
        distance: row.distanceFromSpotPct,
        row,
        right: "C" as const,
      },
    ])
    .filter((row) => row.metric != null || row.openInterest != null || row.volume != null)
    .sort((left, right) => (right.metric ?? 0) - (left.metric ?? 0) || (right.openInterest ?? 0) - (left.openInterest ?? 0))
    .slice(0, 12);

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Candidates" value={fmtWholeNumber(scannerRows.length)} />
        <MetricCard label="Source Rows" value={fmtWholeNumber(displayedChainRows.length)} />
        <MetricCard label="Expiry" value={activeExpiry ?? "Load chain"} />
        <MetricCard label="Data Source" value={optionsDataSourceLabel.replace("Data source - ", "").replace("Data source · ", "")} />
      </div>

      <Panel eyebrow="Scanner" title="Yield And Liquidity Candidates">
        {scannerRows.length ? (
          <div className="overflow-x-auto rounded-2xl border border-line/80 bg-panel">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-panel/95 text-[11px] uppercase tracking-[0.18em] text-muted">
                <tr className="border-b border-line/70">
                  <th className="px-4 py-3">Setup</th>
                  <th className="px-4 py-3">Strike</th>
                  <th className="px-4 py-3">Distance</th>
                  <th className="px-4 py-3">Yield</th>
                  <th className="px-4 py-3">Credit</th>
                  <th className="px-4 py-3">Volume</th>
                  <th className="px-4 py-3">OI</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {scannerRows.map((row) => (
                  <tr key={row.key} className="border-b border-line/70 last:border-b-0">
                    <td className="px-4 py-3 font-medium text-text">{row.setup}</td>
                    <td className="px-4 py-3 text-text">{fmtCurrencySmall(row.strike)}</td>
                    <td className="px-4 py-3 text-muted">{fmtNumber(row.distance, "%")}</td>
                    <td className="px-4 py-3 text-text">{fmtNumber(row.metric, "%")}</td>
                    <td className="px-4 py-3 text-text">{fmtCurrencySmall(row.credit)}</td>
                    <td className="px-4 py-3 text-text">{fmtWholeNumber(row.volume)}</td>
                    <td className="px-4 py-3 text-text">{fmtWholeNumber(row.openInterest)}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        className="rounded-full border border-accent/25 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:border-accent/45 hover:bg-accent/16"
                        onClick={() => onLoadTicket(row.row, row.right)}
                        type="button"
                      >
                        Load
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
            Load an option chain to scan yield and liquidity candidates.
          </div>
        )}
      </Panel>
    </div>
  );
}

export function OptionValuationTool({
  chainSymbol,
  activeDisplayedChain,
  displayedChainRows,
  activeExpiry,
  tickerOverview,
  onLoadTicket,
}: OptionToolSharedProps) {
  const spotPrice = activeDisplayedChain?.underlying.price ?? tickerOverview?.quote.price ?? null;
  const eps = tickerOverview?.epsTtm ?? (spotPrice != null ? spotPrice * 0.04 : 5);
  const dividend = tickerOverview?.dividendAmount ?? 0;
  const dividendYieldPct = spotPrice && dividend ? (dividend / spotPrice) * 100 : tickerOverview?.dividendYieldPct ?? 0;
  const growthPct = tickerOverview?.revenueTtmChangePct ?? tickerOverview?.epsTtmChangePct ?? 6;
  const stageOneGrowthPct = Math.max(0, Math.min(18, growthPct || 6));
  const stageTwoGrowthPct = Math.max(2, Math.min(8, stageOneGrowthPct * 0.55));
  const discountRatePct = 10;
  const terminalMultiple = tickerOverview?.forwardPeRatio ?? tickerOverview?.peRatio ?? 16;
  const bondYieldPct = 4.5;
  const dividendGrowthPct = Math.max(1, Math.min(5, stageTwoGrowthPct));
  const oneStageGrowthPct = Math.max(1, Math.min(12, stageOneGrowthPct * 0.75));
  const detailedOneStageValue = detailedOneStageFairValue(eps, oneStageGrowthPct, discountRatePct, terminalMultiple);
  const twoStageValue = twoStageFairValue(eps, stageOneGrowthPct, stageTwoGrowthPct, discountRatePct, terminalMultiple);
  const ddmValue = dividendDiscountFairValue(dividend, dividendGrowthPct, discountRatePct);
  const grahamValue = grahamFairValue(eps, stageOneGrowthPct, bondYieldPct);
  const lynchValue = lynchStyleFairValue(eps, stageOneGrowthPct, dividendYieldPct);
  const valuationValues = [detailedOneStageValue, twoStageValue, ddmValue, grahamValue, lynchValue].filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  const blendedFairValue = averageNullable(valuationValues);
  const valuationGapPct = spotPrice && blendedFairValue ? ((blendedFairValue - spotPrice) / spotPrice) * 100 : null;
  const valuationVerdict =
    valuationGapPct == null
      ? { label: "No valuation verdict", tone: "neutral" as const, detail: "Load ticker data to compare fair value with spot." }
      : valuationGapPct >= 10
        ? { label: "Underlying looks attractive", tone: "safe" as const, detail: "Fair value is above spot; puts can be evaluated as potential ownership entries." }
        : valuationGapPct >= -10
          ? { label: "Underlying looks fairly valued", tone: "caution" as const, detail: "Premium needs to be good because valuation is not doing much work." }
          : { label: "Underlying looks expensive", tone: "danger" as const, detail: "Be selective. A put needs a much lower effective entry; calls may be more natural." };
  const targetPut = displayedChainRows
    .filter((row) => row.putBid != null || row.putMid != null)
    .filter((row) => blendedFairValue == null || row.strike <= blendedFairValue * 1.03)
    .sort((left, right) => {
      const target = blendedFairValue ?? spotPrice ?? left.strike;
      const leftPremium = left.putBid ?? left.putMid ?? 0;
      const rightPremium = right.putBid ?? right.putMid ?? 0;
      const leftEntryGap = Math.abs(left.strike - leftPremium - target);
      const rightEntryGap = Math.abs(right.strike - rightPremium - target);
      return leftEntryGap - rightEntryGap;
    })[0] ?? null;
  const targetCall = displayedChainRows
    .filter((row) => row.callBid != null || row.callMid != null)
    .filter((row) => spotPrice == null || row.strike >= spotPrice * 1.02)
    .sort((left, right) => {
      const target = Math.max((spotPrice ?? left.strike) * 1.03, (blendedFairValue ?? spotPrice ?? left.strike) * 1.08);
      return Math.abs(left.strike - target) - Math.abs(right.strike - target);
    })[0] ?? null;
  const putPremium = targetPut?.putBid ?? targetPut?.putMid ?? null;
  const callPremium = targetCall?.callBid ?? targetCall?.callMid ?? null;
  const putLifetimeReturnPct = targetPut && putPremium != null ? (putPremium / Math.max(1, targetPut.strike - putPremium)) * 100 : null;
  const callLifetimeReturnPct = spotPrice && targetCall && callPremium != null ? ((callPremium + Math.max(0, targetCall.strike - spotPrice)) / spotPrice) * 100 : null;
  const putAnnualizedReturnPct = annualizedReturn(putLifetimeReturnPct, activeExpiry);
  const callAnnualizedReturnPct = annualizedReturn(callLifetimeReturnPct, activeExpiry);
  const putVerdict = optionVerdict({
    type: "put",
    strike: targetPut?.strike,
    premium: putPremium,
    spotPrice,
    blendedFairValue,
    annualizedReturnPct: putAnnualizedReturnPct,
  });
  const callVerdict = optionVerdict({
    type: "call",
    strike: targetCall?.strike,
    premium: callPremium,
    spotPrice,
    blendedFairValue,
    annualizedReturnPct: callAnnualizedReturnPct,
  });

  const modelRows = [
    {
      model: "Detailed one-stage model",
      value: detailedOneStageValue,
      detail: `${fmtNumber(oneStageGrowthPct, "%")} steady owner-earnings growth, ${fmtNumber(discountRatePct, "%")} discount rate, ${fmtNumber(terminalMultiple)}x terminal multiple`,
    },
    {
      model: "Simple two-stage model",
      value: twoStageValue,
      detail: `${fmtNumber(stageOneGrowthPct, "%")} then ${fmtNumber(stageTwoGrowthPct, "%")} growth, ${fmtNumber(terminalMultiple)}x terminal multiple`,
    },
    {
      model: "Dividend discount model",
      value: ddmValue,
      detail: dividend > 0 ? `${fmtCurrencySmall(dividend)} dividend, ${fmtNumber(dividendGrowthPct, "%")} growth` : "Needs a current dividend",
    },
    {
      model: "Graham / modified Graham check",
      value: grahamValue,
      detail: `${fmtNumber(eps)} EPS, ${fmtNumber(stageOneGrowthPct, "%")} growth, ${fmtNumber(bondYieldPct, "%")} bond yield`,
    },
    {
      model: "Dividend-adjusted Lynch / PEG-style formula",
      value: lynchValue,
      detail: `${fmtNumber(stageOneGrowthPct, "%")} growth plus ${fmtNumber(dividendYieldPct, "%")} dividend yield`,
    },
  ].map((row) => ({ ...row, conclusion: valuationConclusion(row.value, spotPrice) }));

  return (
    <div className="grid gap-6">
      <Panel eyebrow="Decision" title="Current Read" topDivider={false}>
        <div className="grid gap-3 lg:grid-cols-3">
          <DecisionCard
            label={valuationVerdict.label}
            tone={valuationVerdict.tone}
            title="Underlying"
            detail={valuationVerdict.detail}
          />
          <DecisionCard
            label={putVerdict.label}
            tone={putVerdict.tone}
            title="Put-selling calculator"
            detail={putVerdict.detail}
          />
          <DecisionCard
            label={callVerdict.label}
            tone={callVerdict.tone}
            title="Call-selling calculator"
            detail={callVerdict.detail}
          />
        </div>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Symbol" value={activeDisplayedChain?.symbol ?? tickerOverview?.symbol ?? chainSymbol} />
        <MetricCard label="Spot" value={fmtCurrencySmall(spotPrice)} />
        <MetricCard label="Blended Fair Value" value={fmtCurrencySmall(blendedFairValue)} />
        <MetricCard label="Value Gap" value={fmtNumber(valuationGapPct, "%")} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <Panel eyebrow="Fair Value" title="Valuation Models">
          <div className="overflow-hidden rounded-2xl border border-line/80 bg-panel">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-panel/95 text-[11px] uppercase tracking-[0.18em] text-muted">
                <tr className="border-b border-line/70">
                  <th className="px-4 py-3">Model</th>
                  <th className="px-4 py-3">Value</th>
                  <th className="px-4 py-3">Assumption</th>
                  <th className="px-4 py-3">Conclusion</th>
                </tr>
              </thead>
              <tbody>
                {modelRows.map((row) => (
                  <tr key={row.model} className="border-b border-line/70 last:border-b-0">
                    <td className="px-4 py-3 font-medium text-text">{row.model}</td>
                    <td className="px-4 py-3 text-text">{fmtCurrencySmall(row.value)}</td>
                    <td className="px-4 py-3 text-muted">{row.detail}</td>
                    <td className="px-4 py-3">
                      <div className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${verdictClass(row.conclusion.tone)}`}>
                        {row.conclusion.label}
                      </div>
                      <div className="mt-1 text-xs text-muted">{row.conclusion.detail}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 text-xs text-muted">
            These are fast platform estimates seeded from the loaded ticker data. They are meant to connect valuation to option selection, not replace a full model.
          </div>
        </Panel>

        <Panel eyebrow="Option Premium" title="Scenario Comparison">
          <div className="grid gap-3">
            <ScenarioCard
              actionLabel="Load put"
              disabled={!targetPut}
              metrics={[
                ["Strike", fmtCurrencySmall(targetPut?.strike)],
                ["Premium", fmtCurrencySmall(putPremium)],
                ["Effective entry", fmtCurrencySmall(targetPut && putPremium != null ? targetPut.strike - putPremium : null)],
                ["Lifetime RoR", fmtNumber(putLifetimeReturnPct, "%")],
                ["Annualized", fmtNumber(putAnnualizedReturnPct, "%")],
              ]}
              onAction={() => targetPut && onLoadTicket(targetPut, "P")}
              title="Put-selling calculator"
              verdict={putVerdict}
              body={
                targetPut
                  ? `Judges whether the premium is enough for the assignment price. If assigned, effective entry is ${fmtCurrencySmall(targetPut.strike - (putPremium ?? 0))}.`
                  : "Load a chain to compare put premium against fair value."
              }
            />
            <ScenarioCard
              actionLabel="Load call"
              disabled={!targetCall}
              metrics={[
                ["Strike", fmtCurrencySmall(targetCall?.strike)],
                ["Premium", fmtCurrencySmall(callPremium)],
                ["Call-away price", fmtCurrencySmall(targetCall && callPremium != null ? targetCall.strike + callPremium : null)],
                ["Lifetime RoR", fmtNumber(callLifetimeReturnPct, "%")],
                ["Annualized", fmtNumber(callAnnualizedReturnPct, "%")],
              ]}
              onAction={() => targetCall && onLoadTicket(targetCall, "C")}
              title="Call-selling calculator"
              verdict={callVerdict}
              body={
                targetCall
                  ? `Judges whether the premium is enough for the call-away price. Candidate calls are selected above spot to avoid hiding an immediate sale.`
                  : "Load a chain to compare covered-call premium against fair value."
              }
            />
          </div>
        </Panel>
      </div>

      <Panel eyebrow="Workflow" title="What This Tool Is For">
        <div className="grid gap-3 md:grid-cols-3">
          {[
            "Estimate fair value with multiple simple models.",
            "Compare put and call premiums against that value anchor.",
            "Prefer premium on underlyings you would actually want to own.",
          ].map((item) => (
            <div key={item} className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
              {item}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function ScenarioCard({
  title,
  body,
  metrics,
  verdict,
  actionLabel,
  disabled,
  onAction,
}: {
  title: string;
  body: string;
  metrics: Array<[string, string]>;
  verdict: ReturnType<typeof optionVerdict>;
  actionLabel: string;
  disabled: boolean;
  onAction: () => void;
}) {
  return (
    <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium text-text">{title}</div>
            <div className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${verdictClass(verdict.tone)}`}>{verdict.label}</div>
          </div>
          <div className="mt-2 text-sm text-muted">{body}</div>
        </div>
        <button
          className="shrink-0 rounded-full border border-accent/25 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:border-accent/45 hover:bg-accent/16 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onClick={onAction}
          type="button"
        >
          {actionLabel}
        </button>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {metrics.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-line/80 bg-panel px-3 py-3">
            <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
            <div className="mt-1 text-sm font-medium text-text">{value}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-2">
        {verdict.bullets.map((item) => (
          <div key={item} className="rounded-xl border border-line/80 bg-panel px-3 py-2 text-xs text-muted">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionCard({
  title,
  label,
  tone,
  detail,
}: {
  title: string;
  label: string;
  tone: VerdictTone;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{title}</div>
      <div className={`mt-3 inline-flex rounded-full border px-3 py-1.5 text-xs font-medium ${verdictClass(tone)}`}>{label}</div>
      <div className="mt-3 text-sm text-muted">{detail}</div>
    </div>
  );
}
