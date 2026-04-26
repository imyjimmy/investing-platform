import { useEffect, useRef, useState, type ReactNode } from "react";

import { fmtCurrencySmall, fmtNumber } from "../../lib/formatters";
import type {
  ChainRow,
  ConnectionStatus,
  OptionPosition,
} from "../../lib/types";
import {
  OptionBuilderTool,
  OptionScannerTool,
  type OptionStructureLegTemplate,
  type OptionStructureStageRequest,
  OptionStructuresTool,
  OptionValuationTool,
  OptionVolatilityTool,
  type OptionToolSharedProps,
} from "../../components/options/OptionToolWorkspaces";
import {
  OptionsChainTable,
  type OptionsChainGreekOption,
  type TicketContractSide,
} from "../../components/options/OptionsChainTable";
import { useOptionChain } from "../../components/options/useOptionChain";
import { ToolWorkspaceFrame } from "../../components/shell/ToolWorkspaceFrame";
import { TradeTicketFrame } from "../../components/trading/TradeTicketFrame";
import { TradeRailToggleIcon } from "../../components/ui/TradeRailToggleIcon";
import {
  OptionsTradeTicket,
  computeOptionsTicketNetReferencePrice,
  deriveEffectiveOptionsTicketLegs,
  type OptionsTicketLegTemplate,
  type OptionsTicketPlan,
} from "./OptionsTradeTicket";

export type OptionsWorkspaceSurface =
  | "options"
  | "optionsValuation"
  | "optionsBuilder"
  | "optionsStructures"
  | "optionsVolatility"
  | "optionsScanner";

type InlinePillTone = "neutral" | "safe" | "caution" | "danger" | "accent";

type ChainGreekKey = "iv" | "delta" | "gamma" | "theta" | "vega" | "rho";
type ChainGreekOption = OptionsChainGreekOption;

type OptionsWorkspaceProps = {
  workspace: OptionsWorkspaceSurface;
  initialSymbol: string;
  selectedAccount?: string;
  connectionStatus?: ConnectionStatus;
  controlsDisabled: boolean;
  executionEnabled: boolean;
  optionPositions: OptionPosition[];
  onOpenChain: () => void;
  onSymbolChange: (symbol: string) => void;
};

const CHAIN_GREEK_STORAGE_KEY = "options-chain-visible-greeks";
const CHAIN_MARK_STORAGE_KEY = "options-chain-show-mark";
const OPTIONS_TRADE_RAIL_STORAGE_KEY = "options-trade-rail-open";
const DEFAULT_VISIBLE_CHAIN_GREEKS: ChainGreekKey[] = ["iv", "delta", "gamma", "theta", "vega"];
const CHAIN_GREEK_OPTIONS: ChainGreekOption[] = [
  {
    key: "iv",
    label: "IV",
    callValue: (row) => row.callIV,
    putValue: (row) => row.putIV,
    suffix: "%",
  },
  {
    key: "delta",
    label: "Delta",
    callValue: (row) => row.callDelta,
    putValue: (row) => row.putDelta,
  },
  {
    key: "gamma",
    label: "Gamma",
    callValue: (row) => row.callGamma,
    putValue: (row) => row.putGamma,
  },
  {
    key: "theta",
    label: "Theta",
    callValue: (row) => row.callTheta,
    putValue: (row) => row.putTheta,
  },
  {
    key: "vega",
    label: "Vega",
    callValue: (row) => row.callVega,
    putValue: (row) => row.putVega,
  },
  {
    key: "rho",
    label: "Rho",
    callValue: (row) => row.callRho,
    putValue: (row) => row.putRho,
  },
];

export function OptionsWorkspace({
  workspace,
  initialSymbol,
  selectedAccount,
  connectionStatus,
  controlsDisabled,
  executionEnabled,
  optionPositions,
  onOpenChain,
  onSymbolChange,
}: OptionsWorkspaceProps) {
  const normalizedInitialSymbol = initialSymbol.trim().toUpperCase() || "NVDA";
  const [showChainMark, setShowChainMark] = useState<boolean>(() => readShowChainMark());
  const [optionsTradeRailOpen, setOptionsTradeRailOpen] = useState<boolean>(() => readOptionsTradeRailOpen());
  const [visibleChainGreeks, setVisibleChainGreeks] = useState<ChainGreekKey[]>(() => readVisibleChainGreeks());
  const [ticketPlan, setTicketPlan] = useState<OptionsTicketPlan | null>(null);
  const {
    activeDisplayedChain,
    activeExpiry,
    chainBandFetchDirection,
    chainHasBidAsk,
    chainHasOptionMarks,
    chainLoadedRangePct,
    chainQuery,
    chainSymbol,
    chainSymbolInput,
    displayedChainRows,
    displayedExpiries,
    handleChainSymbolSelection,
    handleExpirySelection,
    isLoadingDifferentSymbol,
    maxChainWindowPct,
    requestWiderChainWindow,
    rowDisplayStates,
    selectedExpiry,
    setChainSymbolInput,
    tickerOverviewQuery,
  } = useOptionChain(normalizedInitialSymbol);
  const lastExternalSymbolRef = useRef(normalizedInitialSymbol);
  const ticketPlanIdRef = useRef(0);

  useEffect(() => {
    if (normalizedInitialSymbol === lastExternalSymbolRef.current) {
      return;
    }
    lastExternalSymbolRef.current = normalizedInitialSymbol;
    setChainSymbolInput(normalizedInitialSymbol);
    handleChainSymbolSelection(normalizedInitialSymbol);
  }, [handleChainSymbolSelection, normalizedInitialSymbol, setChainSymbolInput]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(CHAIN_GREEK_STORAGE_KEY, JSON.stringify(visibleChainGreeks));
  }, [visibleChainGreeks]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(CHAIN_MARK_STORAGE_KEY, String(showChainMark));
  }, [showChainMark]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(OPTIONS_TRADE_RAIL_STORAGE_KEY, String(optionsTradeRailOpen));
  }, [optionsTradeRailOpen]);

  useEffect(() => {
    if (!ticketPlan) {
      return;
    }
    if (ticketPlan.legs.some((leg) => leg.symbol !== chainSymbol)) {
      setTicketPlan(null);
    }
  }, [chainSymbol, ticketPlan]);

  useEffect(() => {
    if (!ticketPlan || !selectedExpiry) {
      return;
    }
    if (ticketPlan.legs.some((leg) => leg.expiry !== selectedExpiry)) {
      setTicketPlan(null);
    }
  }, [selectedExpiry, ticketPlan]);

  const optionsDataSourcePill = optionDataSourcePresentation(activeDisplayedChain, connectionStatus, chainHasBidAsk, chainHasOptionMarks);
  const tickerOverview = tickerOverviewQuery.data;

  if (workspace === "optionsValuation") {
    return renderOptionsToolFrame(
      "Valuation",
      <OptionValuationTool {...buildOptionToolProps()} />,
      "Combine fair-value estimates with put and call premium scenarios for the loaded stock.",
    );
  }
  if (workspace === "optionsBuilder") {
    return renderOptionsToolFrame(
      "Builder",
      <OptionBuilderTool {...buildOptionToolProps()} />,
      "Browse strategy families, see account availability, and stage setups from the loaded option chain.",
    );
  }
  if (workspace === "optionsStructures") {
    return renderOptionsToolFrame(
      "Structures",
      <OptionStructuresTool {...buildOptionToolProps()} />,
      "Group open option positions by strategy so the account reads as structures instead of loose contracts.",
    );
  }
  if (workspace === "optionsVolatility") {
    return renderOptionsToolFrame(
      "Volatility",
      <OptionVolatilityTool {...buildOptionToolProps()} />,
      "Inspect IV, skew, and open-interest context for the currently loaded stock option chain.",
    );
  }
  if (workspace === "optionsScanner") {
    return renderOptionsToolFrame(
      "Scanner",
      <OptionScannerTool {...buildOptionToolProps()} />,
      "Rank contracts from the loaded stock option chain by yield, liquidity, and distance from spot.",
    );
  }
  return renderOptionsToolFrame("Chain", renderIbkrOptionsSurface());

  function buildOptionToolProps(): OptionToolSharedProps {
    return {
      chainSymbol,
      activeDisplayedChain,
      displayedChainRows,
      displayedExpiries,
      activeExpiry,
      optionPositions,
      tickerOverview,
      optionsDataSourceLabel: optionsDataSourcePill.label,
      onLoadTicket: loadTicket,
      onStageStructure: stageStructure,
      onOpenChain,
    };
  }

  function renderOptionsToolFrame(title: string, children: ReactNode, description?: string) {
    return (
      <ToolWorkspaceFrame
        description={description}
        eyebrow="Options"
        titleEndSlot={
          <button
            aria-label="Options tool settings"
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line/80 bg-panelSoft text-muted transition hover:border-accent/25 hover:text-text"
            data-testid="options-settings-button"
            title="Options settings"
            type="button"
          >
            <GearIcon />
          </button>
        }
        titleRowSlot={renderOptionsQueryBar()}
        title={title}
      >
        {children}
      </ToolWorkspaceFrame>
    );
  }

  function renderOptionsQueryBar() {
    const requestedSymbolPriceLabel = isLoadingDifferentSymbol
      ? "Loading spot"
      : activeDisplayedChain
        ? `Spot ${fmtCurrencySmall(activeDisplayedChain.underlying.price)}`
        : "No chain loaded";
    const chainLoadLabel =
      chainQuery.isFetching && chainSymbolInput.trim().toUpperCase() === chainSymbol ? `Loading ${chainSymbol}...` : "Load chain";
    return (
      <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Option symbol</span>
            <input
              className="h-9 w-full rounded-xl border border-line/80 bg-panelSoft px-3 text-sm text-text outline-none transition focus:border-accent/60"
              data-testid="chain-symbol-input"
              onChange={(event) => setChainSymbolInput(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  submitSelectedChainSymbol();
                }
              }}
              placeholder="Enter ticker"
              spellCheck={false}
              type="text"
              value={chainSymbolInput}
            />
          </label>
          <button
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-xl border border-accent/30 bg-accent/10 px-3 text-sm font-medium text-accent transition hover:border-accent/50 hover:bg-accent/16 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="chain-load-button"
            disabled={!chainSymbolInput.trim() || controlsDisabled}
            onClick={submitSelectedChainSymbol}
            type="button"
          >
            {chainLoadLabel}
          </button>
        </div>
        <div className="shrink-0 text-[11px] text-muted lg:text-right">{requestedSymbolPriceLabel}</div>
      </div>
    );
  }

  function submitSelectedChainSymbol() {
    const normalizedSymbol = chainSymbolInput.trim().toUpperCase();
    if (!normalizedSymbol) {
      return;
    }
    setChainSymbolInput(normalizedSymbol);
    handleChainSymbolSelection(normalizedSymbol);
    onSymbolChange(normalizedSymbol);
  }

  function renderIbkrOptionsSurface() {
    const busySymbolLabel = chainSymbol;
    const selectedChainGreekOptions = CHAIN_GREEK_OPTIONS.filter((option) => visibleChainGreeks.includes(option.key));
    const selectedContractLabel = ticketPlan?.label ?? null;
    const chainHeadingLabel = isLoadingDifferentSymbol
      ? chainSymbol
      : activeDisplayedChain
        ? `${activeDisplayedChain.symbol} ${activeExpiry ?? ""}`.trim()
        : chainSymbol;
    const chainContextLabel = isLoadingDifferentSymbol
      ? "Showing the last loaded chain until the new one is ready."
      : activeDisplayedChain?.quoteNotice;

    return (
      <div className="grid gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            {displayedExpiries.map((expiry) => (
              <button
                key={expiry}
                className={`rounded-full border px-3 py-2 text-sm transition ${
                  expiry === activeExpiry
                    ? "border-accent/45 bg-accent/12 text-accent"
                    : "border-line/80 bg-panelSoft text-muted hover:border-accent/25 hover:text-text"
                }`}
                data-testid={`expiry-button-${expiry}`}
                disabled={isLoadingDifferentSymbol}
                onClick={() => handleExpirySelection(expiry)}
                type="button"
              >
                {expiry}
              </button>
            ))}
          </div>
          <button
            aria-expanded={optionsTradeRailOpen}
            aria-label={optionsTradeRailOpen ? "Collapse trade ticket rail" : "Expand trade ticket rail"}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line/80 bg-panelSoft text-muted transition hover:border-accent/25 hover:text-text"
            data-testid="toggle-trade-rail"
            onClick={() => setOptionsTradeRailOpen((current) => !current)}
            type="button"
          >
            <TradeRailToggleIcon open={optionsTradeRailOpen} />
          </button>
        </div>

        <div
          className={`options-rail-frame grid gap-4 ${optionsTradeRailOpen ? "xl:grid-cols-[minmax(0,1fr)_340px]" : "xl:grid-cols-[minmax(0,1fr)_44px]"}`}
        >
          <div className="relative overflow-hidden rounded-2xl border border-line/80 bg-panel">
            {chainQuery.isFetching ? (
              <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-full border border-accent/20 bg-shell/90 px-3 py-1 text-xs text-accent">
                Loading {busySymbolLabel}
                {selectedExpiry ? ` - ${selectedExpiry}` : ""}
              </div>
            ) : null}
            {isLoadingDifferentSymbol ? (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-shell/38 backdrop-blur-[1px]">
                <div className="rounded-2xl border border-accent/20 bg-shell/90 px-4 py-3 text-center text-sm text-text shadow-lg">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-accent">Loading requested chain</div>
                  <div className="mt-2 text-base font-medium">{chainSymbol}</div>
                  <div className="mt-1 text-sm text-muted">Showing the last loaded chain until the new one is ready.</div>
                </div>
              </div>
            ) : null}
            <div className="border-b border-line/70 px-4 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Options Chain</div>
                  <div className="mt-1 text-lg font-semibold text-text" data-testid="chain-heading">
                    {chainHeadingLabel}
                  </div>
                  {chainContextLabel ? <div className="mt-2 max-w-3xl text-xs leading-5 text-muted">{chainContextLabel}</div> : null}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-3 lg:max-w-[55%]">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Columns</div>
                    <button
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                        showChainMark
                          ? "border-accent/45 bg-accent/12 text-accent"
                          : "border-line/80 bg-panelSoft text-muted hover:border-accent/25 hover:text-text"
                      }`}
                      data-testid="toggle-column-mark"
                      onClick={toggleShowChainMark}
                      type="button"
                    >
                      Mark
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Greeks</div>
                    {CHAIN_GREEK_OPTIONS.map((option) => {
                      const checked = visibleChainGreeks.includes(option.key);
                      return (
                        <button
                          key={option.key}
                          className={`rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                            checked
                              ? "border-accent/45 bg-accent/12 text-accent"
                              : "border-line/80 bg-panelSoft text-muted hover:border-accent/25 hover:text-text"
                          }`}
                          data-testid={`toggle-greek-${option.key}`}
                          onClick={() => toggleVisibleGreek(option.key)}
                          type="button"
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {displayedChainRows.length ? (
              <OptionsChainTable
                activeChain={activeDisplayedChain}
                activeExpiry={activeExpiry}
                chainSymbol={chainSymbol}
                dimmed={isLoadingDifferentSymbol || chainQuery.isFetching}
                fetchDirection={chainBandFetchDirection}
                fetchDisabled={chainQuery.isFetching || Boolean(chainBandFetchDirection)}
                loadedRangePct={chainLoadedRangePct}
                maxRangePct={maxChainWindowPct}
                onFetchBand={requestWiderChainWindow}
                onLoadTicket={loadTicket}
                rows={displayedChainRows}
                rowDisplayStates={rowDisplayStates}
                selectedGreekOptions={selectedChainGreekOptions}
                showMark={showChainMark}
                ticketSelection={
                  ticketPlan?.legs.length === 1
                    ? {
                        expiry: ticketPlan.legs[0].expiry,
                        strike: ticketPlan.legs[0].strike,
                        right: ticketPlan.legs[0].right,
                      }
                    : null
                }
              />
            ) : chainQuery.isLoading || chainQuery.isFetching ? (
              <div className="px-4 py-10 text-sm text-muted">Loading option chain...</div>
            ) : (
              <div className="px-4 py-10 text-sm text-muted">Load an optionable ticker to see the chain.</div>
            )}
          </div>

          {optionsTradeRailOpen ? (
            <div className="options-rail-pane options-rail-pane-open">{renderTradeRail(selectedContractLabel)}</div>
          ) : (
            <div className="options-rail-pane options-rail-pane-closed">{renderCollapsedTradeRail()}</div>
          )}
        </div>
      </div>
    );
  }

  function renderTradeRail(selectedContractLabel: string | null) {
    return (
      <div className="grid content-start gap-4">
        <TradeTicketFrame title={selectedContractLabel ?? "Select a contract"}>
          {ticketPlan ? (
            <OptionsTradeTicket
              key={ticketPlan.id}
              executionEnabled={executionEnabled}
              plan={ticketPlan}
              selectedAccount={selectedAccount}
            />
          ) : (
            <div className="mt-4 rounded-xl border border-line/80 bg-panelSoft px-3 py-4 text-sm text-muted">
              Load any call or put from the chain, or stage a spread from the Builder workspace.
            </div>
          )}
        </TradeTicketFrame>
      </div>
    );
  }

  function renderCollapsedTradeRail() {
    return (
      <div className="flex h-full min-h-[280px] items-start justify-center">
        <div className="flex h-full min-h-[280px] w-full flex-col items-center rounded-xl border border-line/80 bg-panel py-2">
          <div className="flex-1 [writing-mode:vertical-rl] rotate-180 text-center text-[10px] uppercase tracking-[0.16em] text-muted">
            Trade Ticket
          </div>
        </div>
      </div>
    );
  }

  function loadTicket(row: ChainRow, right: TicketContractSide) {
    const expiry = selectedExpiry ?? activeDisplayedChain?.selectedExpiry ?? "";
    const referencePrice =
      right === "C" ? row.callMid ?? row.callAsk ?? row.callBid ?? null : row.putMid ?? row.putAsk ?? row.putBid ?? null;
    const nextPlan: OptionsTicketPlan = {
      id: nextTicketPlanId(),
      label: `${chainSymbol} ${expiry} ${fmtNumber(row.strike)}${right}`,
      strategyTag: null,
      summary: null,
      defaultAction: "SELL",
      defaultOrderType: "LMT",
      defaultLimitPrice: referencePrice != null ? referencePrice.toFixed(2) : "",
      defaultTif: "DAY",
      legs: [
        {
          symbol: chainSymbol,
          expiry,
          strike: row.strike,
          right,
          entryAction: "SELL",
          referencePrice,
          bid: right === "C" ? row.callBid : row.putBid,
          ask: right === "C" ? row.callAsk : row.putAsk,
          ratio: 1,
          delta: right === "C" ? row.callDelta : row.putDelta,
        },
      ],
    };
    setTicketPlan(nextPlan);
  }

  function stageStructure(structure: OptionStructureStageRequest) {
    const expiry = selectedExpiry ?? activeDisplayedChain?.selectedExpiry ?? "";
    const legs: OptionsTicketLegTemplate[] = structure.legs.map((leg: OptionStructureLegTemplate) => ({
      symbol: chainSymbol,
      expiry,
      strike: leg.strike,
      right: leg.right,
      entryAction: leg.action,
      referencePrice: leg.referencePrice,
      bid: leg.bid,
      ask: leg.ask,
      ratio: leg.ratio,
      delta: leg.delta,
    }));
    const defaultLimit = computeOptionsTicketNetReferencePrice(
      deriveEffectiveOptionsTicketLegs({ defaultAction: structure.defaultAction, legs }, structure.defaultAction),
    );
    const nextPlan: OptionsTicketPlan = {
      id: nextTicketPlanId(),
      label: structure.title,
      strategyTag: structure.strategyTag,
      summary: structure.summary,
      defaultAction: structure.defaultAction,
      defaultOrderType: defaultLimit != null ? "LMT" : "MKT",
      defaultLimitPrice: defaultLimit != null ? defaultLimit.toFixed(2) : "",
      defaultTif: "DAY",
      legs,
    };
    setTicketPlan(nextPlan);
    setOptionsTradeRailOpen(true);
  }

  function nextTicketPlanId() {
    ticketPlanIdRef.current += 1;
    return `options-ticket-${ticketPlanIdRef.current}`;
  }

  function toggleVisibleGreek(nextGreek: ChainGreekKey) {
    setVisibleChainGreeks((current) =>
      current.includes(nextGreek) ? current.filter((value) => value !== nextGreek) : [...current, nextGreek],
    );
  }

  function toggleShowChainMark() {
    setShowChainMark((current) => !current);
  }
}

function optionDataSourcePresentation(
  chain: ReturnType<typeof useOptionChain>["activeDisplayedChain"],
  status: ConnectionStatus | undefined,
  hasBidAsk: boolean,
  hasMarks: boolean,
): { label: string; tone: InlinePillTone } {
  if (chain?.isStale) {
    if (chain.quoteSource === "historical") {
      return { label: "Data source - cached historical chain", tone: "caution" };
    }
    if (chain.quoteSource === "streaming") {
      return { label: "Data source - cached streaming chain", tone: "caution" };
    }
    return { label: "Data source - cached chain", tone: "caution" };
  }
  if (chain?.quoteSource === "historical") {
    return { label: "Data source - historical fallback", tone: "caution" };
  }
  if (chain?.underlying.marketDataStatus === "DELAYED" || chain?.underlying.marketDataStatus === "DELAYED_FROZEN") {
    if (hasBidAsk) {
      return { label: "Data source - delayed IBKR", tone: "caution" };
    }
    if (hasMarks) {
      return { label: "Data source - delayed marks only", tone: "caution" };
    }
    return { label: "Data source - delayed IBKR", tone: "caution" };
  }
  if (chain?.underlying.marketDataStatus === "FROZEN") {
    return { label: hasMarks ? "Data source - frozen marks only" : "Data source - frozen IBKR", tone: "caution" };
  }
  if (chain?.quoteSource === "streaming") {
    return hasBidAsk ? { label: "Data source - streaming IBKR", tone: "safe" } : { label: "Data source - marks only", tone: "neutral" };
  }
  if (chain?.quoteSource === "unavailable") {
    return { label: "Data source - quotes unavailable", tone: "danger" };
  }
  if (!status) {
    return { label: "Data source - checking", tone: "neutral" };
  }
  if (!status.connected) {
    return { label: "Data source - gateway offline", tone: "danger" };
  }
  if (status.marketDataMode === "LIVE") {
    return { label: "Data source - gateway connected", tone: "safe" };
  }
  if (status.marketDataMode === "DELAYED" || status.marketDataMode === "DELAYED_FROZEN") {
    return { label: "Data source - delayed session", tone: "caution" };
  }
  return { label: "Data source - connected session", tone: "neutral" };
}

function readVisibleChainGreeks(): ChainGreekKey[] {
  if (typeof window === "undefined") {
    return [...DEFAULT_VISIBLE_CHAIN_GREEKS];
  }
  try {
    const raw = window.localStorage.getItem(CHAIN_GREEK_STORAGE_KEY);
    if (!raw) {
      return [...DEFAULT_VISIBLE_CHAIN_GREEKS];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [...DEFAULT_VISIBLE_CHAIN_GREEKS];
    }
    return parsed.filter((value): value is ChainGreekKey => CHAIN_GREEK_OPTIONS.some((option) => option.key === value));
  } catch {
    return [...DEFAULT_VISIBLE_CHAIN_GREEKS];
  }
}

function readShowChainMark(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    const raw = window.localStorage.getItem(CHAIN_MARK_STORAGE_KEY);
    if (raw == null) {
      return true;
    }
    return raw === "true";
  } catch {
    return true;
  }
}

function readOptionsTradeRailOpen(): boolean {
  if (typeof window === "undefined") {
    return true;
  }
  try {
    const raw = window.localStorage.getItem(OPTIONS_TRADE_RAIL_STORAGE_KEY);
    if (raw == null) {
      return true;
    }
    return raw === "true";
  } catch {
    return true;
  }
}

function GearIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 20 20" width="16">
      <path
        d="M8.9 2.8h2.2l.45 2.05c.39.14.76.3 1.1.52l1.78-1.1 1.55 1.55-1.1 1.78c.21.34.39.71.52 1.1l2.05.45v2.2l-2.05.45c-.14.39-.31.76-.52 1.1l1.1 1.78-1.55 1.55-1.78-1.1c-.34.21-.71.39-1.1.52l-.45 2.05H8.9l-.45-2.05a5.7 5.7 0 0 1-1.1-.52l-1.78 1.1-1.55-1.55 1.1-1.78a5.7 5.7 0 0 1-.52-1.1l-2.05-.45v-2.2L4.6 8.7c.14-.39.31-.76.52-1.1L4.02 5.82l1.55-1.55 1.78 1.1c.34-.21.71-.39 1.1-.52L8.9 2.8Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
      <circle cx="10" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
