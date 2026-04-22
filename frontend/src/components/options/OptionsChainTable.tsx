import { Fragment } from "react";
import type { ChainRow, OptionChainResponse } from "../../lib/types";

export type TicketContractSide = "C" | "P";
export type ChainBandDirection = "lower" | "upper";
export type ChainRowDisplayState = {
  status: "fresh" | "stale" | "refreshing";
  updatedAt: number | null;
};
type ChainGreekKey = "iv" | "delta" | "gamma" | "theta" | "vega" | "rho";

export type OptionsChainGreekOption = {
  key: ChainGreekKey;
  label: string;
  callValue: (row: ChainRow) => number | null;
  putValue: (row: ChainRow) => number | null;
  suffix?: string;
};

type TicketSelection = {
  expiry: string;
  strike: number;
  right: TicketContractSide;
} | null;

type ChainRange = {
  min: number;
  max: number;
};

type OptionsChainTableProps = {
  activeChain: OptionChainResponse | null;
  activeExpiry?: string;
  chainSymbol: string;
  dimmed: boolean;
  fetchDirection: ChainBandDirection | null;
  fetchDisabled: boolean;
  loadedRangePct: ChainRange;
  maxRangePct: number;
  onFetchBand: (direction: ChainBandDirection) => void;
  onLoadTicket: (row: ChainRow, right: TicketContractSide) => void;
  rows: ChainRow[];
  rowDisplayStates: Record<string, ChainRowDisplayState>;
  selectedGreekOptions: OptionsChainGreekOption[];
  showMark: boolean;
  ticketSelection: TicketSelection;
};

const currencySmall = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

const greekNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 3,
});

const wholeNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const ITM_PROBABILITY_RISK_FREE_RATE = 0.045;

function fmtCurrencySmall(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return currencySmall.format(value);
}

function fmtNumber(value: number | null | undefined, suffix = "") {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return `${number.format(value)}${suffix}`;
}

function fmtGreek(value: number | null | undefined, suffix = "") {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return `${greekNumber.format(value)}${suffix}`;
}

function fmtWholeNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return wholeNumber.format(value);
}

function normalCdf(value: number) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function probabilityItmPct(
  spot: number | null | undefined,
  strike: number | null | undefined,
  ivPct: number | null | undefined,
  expiry: string | undefined,
  right: TicketContractSide,
) {
  if (spot == null || strike == null || ivPct == null || Number.isNaN(spot) || Number.isNaN(strike) || Number.isNaN(ivPct) || !expiry) {
    return null;
  }
  const expiryDate = new Date(`${expiry}T23:59:59`);
  const millisToExpiry = expiryDate.getTime() - Date.now();
  const years = Math.max(millisToExpiry / (365 * 24 * 60 * 60 * 1000), 1 / 365);
  const sigma = ivPct / 100;
  if (sigma <= 0 || spot <= 0 || strike <= 0) {
    return null;
  }
  const sqrtT = Math.sqrt(years);
  const d2 = (Math.log(spot / strike) + (ITM_PROBABILITY_RISK_FREE_RATE - 0.5 * sigma * sigma) * years) / (sigma * sqrtT);
  const probability = right === "C" ? normalCdf(d2) : normalCdf(-d2);
  return Math.max(0, Math.min(100, probability * 100));
}

function ChainFetchChevronRow({
  chainTableColumnCount,
  direction,
  fetchDirection,
  disabled,
  loadedRangePct,
  maxRangePct,
  onFetchBand,
}: {
  chainTableColumnCount: number;
  direction: ChainBandDirection;
  disabled: boolean;
  fetchDirection: ChainBandDirection | null;
  loadedRangePct: ChainRange;
  maxRangePct: number;
  onFetchBand: (direction: ChainBandDirection) => void;
}) {
  const loading = fetchDirection === direction;
  const loadedPct = direction === "lower" ? Math.abs(loadedRangePct.min) : loadedRangePct.max;
  const capped = loadedPct >= maxRangePct;
  const label = direction === "lower" ? "Load lower strikes" : "Load higher strikes";
  const separatorClass =
    direction === "lower" ? "shadow-[inset_0_-1px_0_rgba(95,144,146,0.14)]" : "shadow-[inset_0_1px_0_rgba(95,144,146,0.14)]";
  const chevronStack = (
    <span className="grid h-4 w-5 place-items-center text-[15px] leading-[0.35]">
      <span>⌃</span>
      <span>⌃</span>
    </span>
  );
  return (
    <tr className="h-6 bg-panel">
      <td className={`${separatorClass} px-2.5 py-0`} colSpan={chainTableColumnCount}>
        <div className="flex h-6 items-center justify-center">
          <button
            aria-label={capped ? "Strike range loaded" : label}
            className="text-base font-semibold leading-none text-accent transition hover:text-text disabled:cursor-not-allowed disabled:text-muted"
            disabled={disabled || capped}
            onClick={() => onFetchBand(direction)}
            title={capped ? "Maximum range loaded for this chain" : label}
            type="button"
          >
            {loading ? (
              <span className="inline-flex h-4 w-4 animate-spin rounded-full border border-current border-t-transparent" />
            ) : (
              <span className={direction === "lower" ? "inline-block" : "inline-block rotate-180"}>{chevronStack}</span>
            )}
          </button>
        </div>
      </td>
    </tr>
  );
}

function rowDisplayStateKey(row: ChainRow) {
  return String(row.strike);
}

function describeRowDisplayState(rowState: ChainRowDisplayState | undefined) {
  if (!rowState?.updatedAt) {
    return undefined;
  }
  const ageSeconds = Math.max(0, Math.round((Date.now() - rowState.updatedAt) / 1000));
  if (rowState.status === "refreshing") {
    return `Refreshing quote data; previous values are ${ageSeconds}s old.`;
  }
  if (rowState.status === "stale") {
    return `Quote data is stale; last refreshed ${ageSeconds}s ago.`;
  }
  return `Quote data refreshed ${ageSeconds}s ago.`;
}

export function OptionsChainTable({
  activeChain,
  activeExpiry,
  chainSymbol,
  dimmed,
  fetchDirection,
  fetchDisabled,
  loadedRangePct,
  maxRangePct,
  onFetchBand,
  onLoadTicket,
  rows,
  rowDisplayStates,
  selectedGreekOptions,
  showMark,
  ticketSelection,
}: OptionsChainTableProps) {
  const chainTableColumnCount = 11 + selectedGreekOptions.length * 2 + (showMark ? 2 : 0);
  const callSectionColumnCount = 5 + selectedGreekOptions.length + (showMark ? 1 : 0);
  const putSectionColumnCount = 5 + selectedGreekOptions.length + (showMark ? 1 : 0);
  const spotPrice = activeChain?.underlying.price ?? null;
  const hasExactSpotStrike = spotPrice != null && rows.some((row) => Math.abs(row.strike - spotPrice) < 0.0001);
  const spotInsertIndex = spotPrice == null || hasExactSpotStrike ? -1 : rows.findIndex((row) => row.strike >= spotPrice);
  const normalizedSpotInsertIndex = spotInsertIndex === -1 && spotPrice != null && !hasExactSpotStrike ? rows.length : spotInsertIndex;

  const isSelectedTicketRow = (row: ChainRow, right: TicketContractSide) =>
    ticketSelection != null &&
    ticketSelection.expiry === (activeExpiry ?? activeChain?.selectedExpiry ?? "") &&
    ticketSelection.strike === row.strike &&
    ticketSelection.right === right;

  function renderContractEntryButton(
    value: number | null | undefined,
    row: ChainRow,
    right: TicketContractSide,
    tone: "call" | "put",
    label: string,
  ) {
    if (value == null || Number.isNaN(value)) {
      return <span className="text-muted">—</span>;
    }
    const selected = isSelectedTicketRow(row, right);
    const baseToneClass =
      tone === "call"
        ? selected
          ? "border-accent/55 bg-accent/18 text-accent shadow-[0_0_0_1px_rgba(123,243,214,0.16)]"
          : "border-accent/25 bg-accent/8 text-accent hover:border-accent/45 hover:bg-accent/14"
        : selected
          ? "border-caution/55 bg-caution/18 text-caution shadow-[0_0_0_1px_rgba(255,207,92,0.14)]"
          : "border-caution/25 bg-caution/8 text-caution hover:border-caution/45 hover:bg-caution/14";
    return (
      <button
        className={`inline-flex min-w-[4.75rem] items-center justify-center rounded-full border px-2.5 py-1.5 text-sm font-medium transition ${baseToneClass}`}
        onClick={() => onLoadTicket(row, right)}
        title={`${label} ${right === "C" ? "call" : "put"} ${fmtCurrencySmall(value)}`}
        type="button"
      >
        {fmtCurrencySmall(value)}
      </button>
    );
  }

  function renderSpotRow(key: string) {
    if (spotPrice == null) {
      return null;
    }
    return (
      <tr key={key} className="border-t border-line/70" data-testid="chain-spot-row">
        <td
          className="px-2.5 py-2"
          colSpan={chainTableColumnCount}
          style={{
            backgroundImage:
              "repeating-linear-gradient(135deg, rgba(123, 243, 214, 0.08) 0, rgba(123, 243, 214, 0.08) 10px, transparent 10px, transparent 20px)",
          }}
        >
          <div className="flex items-center justify-center gap-3 text-[11px] uppercase tracking-[0.18em] text-accent">
            <span>Spot</span>
            <span className="text-text">{fmtCurrencySmall(spotPrice)}</span>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <div className={`${dimmed ? "opacity-60" : ""} max-h-[70vh] min-h-[420px] overflow-auto overscroll-contain`}>
      <table className="min-w-max text-left text-sm">
          <thead className="sticky top-0 z-[1] bg-panel/95 text-[11px] uppercase tracking-[0.18em] text-muted">
            <tr className="border-b border-line/70 text-[10px] tracking-[0.24em]">
              <th className="px-2.5 pb-2 pt-3 text-right text-accent" colSpan={callSectionColumnCount}>
                Calls
              </th>
              <th className="px-2.5 pb-2 pt-3 text-text" colSpan={1}>
                Strike
              </th>
              <th className="px-2.5 pb-2 pt-3 text-left text-caution" colSpan={putSectionColumnCount}>
                Puts
              </th>
            </tr>
            <tr>
              <th className="px-2.5 py-1.5">Bid</th>
              <th className="px-2.5 py-1.5">Ask</th>
              {showMark ? <th className="px-2.5 py-1.5">Mark</th> : null}
              <th className="px-2.5 py-1.5">Vol</th>
              <th className="px-2.5 py-1.5">OI</th>
              {selectedGreekOptions.map((option) => (
                <th key={`call-${option.key}`} className="px-2.5 py-1.5">
                  {option.label}
                </th>
              ))}
              <th className="px-2.5 py-1.5">ITM %</th>
              <th className="px-2.5 py-1.5">Strike</th>
              <th className="px-2.5 py-1.5">ITM %</th>
              {selectedGreekOptions.map((option) => (
                <th key={`put-${option.key}`} className="px-2.5 py-1.5">
                  {option.label}
                </th>
              ))}
              <th className="px-2.5 py-1.5">OI</th>
              <th className="px-2.5 py-1.5">Vol</th>
              {showMark ? <th className="px-2.5 py-1.5">Mark</th> : null}
              <th className="px-2.5 py-1.5">Ask</th>
              <th className="px-2.5 py-1.5">Bid</th>
            </tr>
          </thead>
          <tbody>
            <ChainFetchChevronRow
              chainTableColumnCount={chainTableColumnCount}
              direction="lower"
              disabled={fetchDisabled}
              fetchDirection={fetchDirection}
              loadedRangePct={loadedRangePct}
              maxRangePct={maxRangePct}
              onFetchBand={onFetchBand}
            />
            {rows.map((row, index) => {
              const rowState = rowDisplayStates[rowDisplayStateKey(row)];
              const callItmPct = probabilityItmPct(spotPrice, row.strike, row.callIV, activeExpiry, "C");
              const putItmPct = probabilityItmPct(spotPrice, row.strike, row.putIV, activeExpiry, "P");
              const previousFiveBucket = index === 0 ? null : Math.floor(Math.abs(rows[index - 1].distanceFromSpotPct) / 5);
              const currentFiveBucket = Math.floor(Math.abs(row.distanceFromSpotPct) / 5);
              const previousTenBucket = index === 0 ? null : Math.floor(Math.abs(rows[index - 1].distanceFromSpotPct) / 10);
              const currentTenBucket = Math.floor(Math.abs(row.distanceFromSpotPct) / 10);
              const isTenPercentBreak = index > 0 && currentTenBucket !== previousTenBucket;
              const isFivePercentBreak = index > 0 && !isTenPercentBreak && currentFiveBucket !== previousFiveBucket;
              const boundaryClass = isTenPercentBreak ? "border-t-2 border-accent/40" : isFivePercentBreak ? "border-t-2 border-line/95" : "border-t border-line/70";
              const boundaryToneClass = isTenPercentBreak
                ? "bg-accent/[0.035]"
                : isFivePercentBreak
                  ? "bg-white/[0.018] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                  : "";
              const freshnessClass =
                rowState?.status === "refreshing"
                  ? "opacity-55 saturate-50"
                  : rowState?.status === "stale"
                    ? "opacity-55 saturate-50"
                    : "";

              return (
                <Fragment key={`${activeChain?.symbol ?? chainSymbol}-${row.strike}-${index}-group`}>
                  {normalizedSpotInsertIndex === index ? renderSpotRow(`${activeChain?.symbol ?? chainSymbol}-spot-row-${index}`) : null}
                  <tr
                    key={`${activeChain?.symbol ?? chainSymbol}-${row.strike}-${index}`}
                    className={`${boundaryClass} ${boundaryToneClass} ${freshnessClass} transition hover:bg-white/[0.02]`}
                    data-testid={`chain-row-${index}`}
                    title={describeRowDisplayState(rowState)}
                  >
                    <td className="px-2.5 py-1.5">{renderContractEntryButton(row.callBid, row, "C", "call", "Bid")}</td>
                    <td className="px-2.5 py-1.5">{renderContractEntryButton(row.callAsk, row, "C", "call", "Ask")}</td>
                    {showMark ? <td className="px-2.5 py-1.5">{renderContractEntryButton(row.callMid, row, "C", "call", "Mark")}</td> : null}
                    <td className="px-2.5 py-1.5">{fmtWholeNumber(row.callVolume)}</td>
                    <td className="px-2.5 py-1.5">{fmtWholeNumber(row.callOpenInterest)}</td>
                    {selectedGreekOptions.map((option) => (
                      <td key={`call-cell-${option.key}-${row.strike}`} className="px-2.5 py-1.5">
                        {fmtGreek(option.callValue(row), option.suffix ?? "")}
                      </td>
                    ))}
                    <td className="px-2.5 py-1.5">{fmtNumber(callItmPct, "%")}</td>
                    <td className="px-2.5 py-1.5 font-medium text-text">{fmtCurrencySmall(row.strike)}</td>
                    <td className="px-2.5 py-1.5">{fmtNumber(putItmPct, "%")}</td>
                    {selectedGreekOptions.map((option) => (
                      <td key={`put-cell-${option.key}-${row.strike}`} className="px-2.5 py-1.5">
                        {fmtGreek(option.putValue(row), option.suffix ?? "")}
                      </td>
                    ))}
                    <td className="px-2.5 py-1.5">{fmtWholeNumber(row.putOpenInterest)}</td>
                    <td className="px-2.5 py-1.5">{fmtWholeNumber(row.putVolume)}</td>
                    {showMark ? <td className="px-2.5 py-1.5">{renderContractEntryButton(row.putMid, row, "P", "put", "Mark")}</td> : null}
                    <td className="px-2.5 py-1.5">{renderContractEntryButton(row.putAsk, row, "P", "put", "Ask")}</td>
                    <td className="px-2.5 py-1.5">{renderContractEntryButton(row.putBid, row, "P", "put", "Bid")}</td>
                  </tr>
                </Fragment>
              );
            })}
            {normalizedSpotInsertIndex === rows.length ? renderSpotRow(`${activeChain?.symbol ?? chainSymbol}-spot-row-tail`) : null}
            <ChainFetchChevronRow
              chainTableColumnCount={chainTableColumnCount}
              direction="upper"
              disabled={fetchDisabled}
              fetchDirection={fetchDirection}
              loadedRangePct={loadedRangePct}
              maxRangePct={maxRangePct}
              onFetchBand={onFetchBand}
            />
          </tbody>
      </table>
    </div>
  );
}
