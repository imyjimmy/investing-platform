import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { fmtCurrencySmall, fmtNumber } from "../../lib/formatters";
import type {
  ChainRow,
  ConnectionStatus,
  OpenOrderExposure,
  OptionOrderPreview,
  OptionOrderRequest,
  OptionPosition,
  OrderCancelResponse,
  SubmittedOrder,
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
import { ErrorState } from "../../components/ui/ErrorState";

export type OptionsWorkspaceSurface =
  | "options"
  | "optionsValuation"
  | "optionsBuilder"
  | "optionsStructures"
  | "optionsVolatility"
  | "optionsScanner";

type InlinePillTone = "neutral" | "safe" | "caution" | "danger" | "accent";

type TicketPlan = {
  label: string;
  strategyTag: string | null;
  summary: string | null;
  defaultAction: "BUY" | "SELL";
  legs: TicketLegTemplate[];
};

type TicketLegTemplate = {
  symbol: string;
  expiry: string;
  strike: number;
  right: TicketContractSide;
  entryAction: "BUY" | "SELL";
  referencePrice: number | null;
  bid: number | null;
  ask: number | null;
  ratio: number;
  delta: number | null;
};

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
  openOrders: OpenOrderExposure[];
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
  openOrders,
  onOpenChain,
  onSymbolChange,
}: OptionsWorkspaceProps) {
  const queryClient = useQueryClient();
  const normalizedInitialSymbol = initialSymbol.trim().toUpperCase() || "NVDA";
  const [showChainMark, setShowChainMark] = useState<boolean>(() => readShowChainMark());
  const [optionsTradeRailOpen, setOptionsTradeRailOpen] = useState<boolean>(() => readOptionsTradeRailOpen());
  const [visibleChainGreeks, setVisibleChainGreeks] = useState<ChainGreekKey[]>(() => readVisibleChainGreeks());
  const [ticketPlan, setTicketPlan] = useState<TicketPlan | null>(null);
  const [ticketAction, setTicketAction] = useState<"BUY" | "SELL">("SELL");
  const [ticketQuantity, setTicketQuantity] = useState(1);
  const [ticketOrderType, setTicketOrderType] = useState<"LMT" | "MKT">("LMT");
  const [ticketLimitPrice, setTicketLimitPrice] = useState("");
  const [ticketTif, setTicketTif] = useState<"DAY" | "GTC">("DAY");
  const [previewRequestKey, setPreviewRequestKey] = useState<string | null>(null);
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
    submitChainSymbolInput,
    tickerOverviewQuery,
  } = useOptionChain(normalizedInitialSymbol);

  const previewMutation = useMutation({
    mutationFn: api.previewOptionOrder,
    onSuccess: (_data, variables) => setPreviewRequestKey(JSON.stringify(variables)),
  });
  const submitMutation = useMutation({
    mutationFn: api.submitOptionOrder,
    onSuccess: async (_data, variables) => {
      setPreviewRequestKey(JSON.stringify(variables));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["risk-summary", selectedAccount] }),
        queryClient.invalidateQueries({ queryKey: ["option-positions", selectedAccount] }),
        queryClient.invalidateQueries({ queryKey: ["open-orders", selectedAccount] }),
      ]);
    },
  });
  const cancelMutation = useMutation({
    mutationFn: ({ orderId, accountId }: { orderId: number; accountId: string }) => api.cancelOrder(orderId, accountId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["risk-summary", selectedAccount] }),
        queryClient.invalidateQueries({ queryKey: ["option-positions", selectedAccount] }),
        queryClient.invalidateQueries({ queryKey: ["open-orders", selectedAccount] }),
      ]);
    },
  });

  useEffect(() => {
    if (normalizedInitialSymbol !== chainSymbol) {
      setChainSymbolInput(normalizedInitialSymbol);
      handleChainSymbolSelection(normalizedInitialSymbol);
    }
  }, [chainSymbol, handleChainSymbolSelection, normalizedInitialSymbol, setChainSymbolInput]);

  useEffect(() => {
    onSymbolChange(chainSymbol);
  }, [chainSymbol, onSymbolChange]);

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
      setPreviewRequestKey(null);
      previewMutation.reset();
      submitMutation.reset();
    }
  }, [chainSymbol, previewMutation, submitMutation, ticketPlan]);

  useEffect(() => {
    if (!ticketPlan || !selectedExpiry) {
      return;
    }
    if (ticketPlan.legs.some((leg) => leg.expiry !== selectedExpiry)) {
      setTicketPlan(null);
      setPreviewRequestKey(null);
      previewMutation.reset();
      submitMutation.reset();
    }
  }, [previewMutation, selectedExpiry, submitMutation, ticketPlan]);

  const effectiveTicketLegs = ticketPlan ? deriveEffectiveTicketLegs(ticketPlan, ticketAction) : [];
  const selectedTicketLeg = effectiveTicketLegs[0] ?? null;
  const ticketNetReferencePrice = computeTicketNetReferencePrice(effectiveTicketLegs);
  const openOptionOrders = openOrders.filter((order) => order.secType === "OPT" || order.secType === "BAG");
  const optionsDataSourcePill = optionDataSourcePresentation(activeDisplayedChain, connectionStatus, chainHasBidAsk, chainHasOptionMarks);
  const parsedLimitPrice = ticketOrderType === "LMT" ? Number(ticketLimitPrice) : null;
  const validLimitPrice =
    ticketOrderType === "MKT" ? null : Number.isFinite(parsedLimitPrice) && parsedLimitPrice != null && parsedLimitPrice > 0 ? parsedLimitPrice : null;
  const ticketRequest: OptionOrderRequest | null =
    selectedTicketLeg && selectedAccount && effectiveTicketLegs.length && (ticketOrderType === "MKT" || validLimitPrice != null)
      ? {
          accountId: selectedAccount,
          symbol: selectedTicketLeg.symbol,
          expiry: selectedTicketLeg.expiry,
          strike: selectedTicketLeg.strike,
          right: selectedTicketLeg.right,
          action: ticketAction,
          quantity: Math.max(1, Math.floor(ticketQuantity || 1)),
          orderType: ticketOrderType,
          limitPrice: ticketOrderType === "LMT" ? validLimitPrice : null,
          tif: ticketTif,
          strategyTag: ticketPlan?.strategyTag ?? null,
          structureLabel: ticketPlan?.label ?? null,
          legs: effectiveTicketLegs.map((leg) => ({
            expiry: leg.expiry,
            strike: leg.strike,
            right: leg.right,
            action: leg.action,
            ratio: leg.ratio,
          })),
        }
      : null;
  const ticketRequestKey = ticketRequest ? JSON.stringify(ticketRequest) : null;
  const previewIsCurrent = Boolean(previewMutation.data && previewRequestKey && ticketRequestKey === previewRequestKey);
  const submitIsCurrent = Boolean(submitMutation.data && previewRequestKey && ticketRequestKey === previewRequestKey);
  const previewError = previewMutation.error instanceof Error ? previewMutation.error.message : null;
  const submitError = submitMutation.error instanceof Error ? submitMutation.error.message : null;
  const cancelError = cancelMutation.error instanceof Error ? cancelMutation.error.message : null;
  const canPreviewTicket = executionEnabled && Boolean(ticketRequest);
  const canSubmitTicket = canPreviewTicket && previewIsCurrent;
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
        compact
        description={description}
        titleEndSlot={
          <button
            aria-label="Options tool settings"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-line/80 bg-panelSoft text-muted transition hover:border-accent/25 hover:text-text"
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
                  submitChainSymbolInput();
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
            onClick={submitChainSymbolInput}
            type="button"
          >
            {chainLoadLabel}
          </button>
        </div>
        <div className="shrink-0 text-[11px] text-muted lg:text-right">{requestedSymbolPriceLabel}</div>
      </div>
    );
  }

  function renderIbkrOptionsSurface() {
    const busySymbolLabel = chainSymbol;
    const selectedChainGreekOptions = CHAIN_GREEK_OPTIONS.filter((option) => visibleChainGreeks.includes(option.key));
    const selectedContractLabel =
      ticketPlan == null
        ? null
        : effectiveTicketLegs.length === 1
          ? `${effectiveTicketLegs[0].symbol} ${effectiveTicketLegs[0].expiry} ${fmtNumber(effectiveTicketLegs[0].strike)}${effectiveTicketLegs[0].right}`
          : ticketPlan.label;
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
        {displayedExpiries.length ? (
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
        ) : null}

        <div className={`grid gap-4 ${optionsTradeRailOpen ? "xl:grid-cols-[minmax(0,1fr)_340px]" : "xl:grid-cols-[minmax(0,1fr)_44px]"}`}>
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
                  effectiveTicketLegs.length === 1
                    ? {
                        expiry: effectiveTicketLegs[0].expiry,
                        strike: effectiveTicketLegs[0].strike,
                        right: effectiveTicketLegs[0].right,
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

          {optionsTradeRailOpen ? renderTradeRail(selectedContractLabel) : renderCollapsedTradeRail()}
        </div>
      </div>
    );
  }

  function renderTradeRail(selectedContractLabel: string | null) {
    return (
      <div className="grid content-start gap-4">
        <div className="rounded-2xl border border-line/80 bg-panel px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Trade Ticket</div>
              <div className="mt-1 text-lg font-semibold text-text">{selectedContractLabel ?? "Select a contract"}</div>
            </div>
            <button
              aria-expanded={optionsTradeRailOpen}
              aria-label="Collapse trade ticket rail"
              className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line/80 bg-panelSoft text-muted transition hover:border-accent/25 hover:text-text"
              data-testid="toggle-trade-rail"
              onClick={() => setOptionsTradeRailOpen(false)}
              type="button"
            >
              <SidebarToggleIcon open={optionsTradeRailOpen} />
            </button>
          </div>

          {ticketPlan ? renderTradeTicketForm() : (
            <div className="mt-4 rounded-xl border border-line/80 bg-panelSoft px-3 py-4 text-sm text-muted">
              Load any call or put from the chain, or stage a spread from the Builder workspace.
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-line/80 bg-panel px-4 py-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Working Orders</div>
            <div className="mt-1 text-lg font-semibold text-text">{openOptionOrders.length}</div>
          </div>
          <div className="mt-4 grid gap-3">
            {cancelMutation.data ? <CancelSummary cancelled={cancelMutation.data} /> : null}
            {openOptionOrders.length ? (
              openOptionOrders.map((order) => (
                <div
                  key={order.orderId}
                  className="rounded-xl border border-line/80 bg-panelSoft px-3 py-3"
                  data-testid={`open-order-${order.orderId}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-text">{formatOpenOrderLabel(order)}</div>
                      <div className="mt-1 text-xs text-muted">
                        {order.orderType}
                        {order.limitPrice != null ? ` ${fmtCurrencySmall(order.limitPrice)}` : ""}
                        {" - "}
                        {order.status}
                        {" - filled "}
                        {fmtNumber(order.filledQuantity)}
                        {" / remaining "}
                        {fmtNumber(order.remainingQuantity)}
                      </div>
                      {order.note ? <div className="mt-1 text-xs text-muted">{order.note}</div> : null}
                    </div>
                    <button
                      className="rounded-full border border-danger/30 bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger transition hover:border-danger/50 hover:bg-danger/16 disabled:cursor-not-allowed disabled:opacity-50"
                      data-testid={`cancel-order-${order.orderId}`}
                      disabled={!selectedAccount || cancelMutation.isPending}
                      onClick={() => {
                        if (selectedAccount) {
                          void cancelMutation.mutateAsync({ orderId: order.orderId, accountId: selectedAccount });
                        }
                      }}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-line/80 bg-panelSoft px-3 py-4 text-sm text-muted">
                No working option orders in the selected routed account.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-line/80 bg-panel px-4 py-4">
          <div>
            <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Open Option Positions</div>
            <div className="mt-1 text-lg font-semibold text-text">{optionPositions.length}</div>
          </div>
          <div className="mt-4 grid gap-3">
            {optionPositions.length ? (
              optionPositions.slice(0, 6).map((position) => (
                <div key={`${position.symbol}-${position.expiry}-${position.strike}-${position.right}`} className="rounded-xl border border-line/80 bg-panelSoft px-3 py-3">
                  <div className="font-medium text-text">
                    {position.symbol} {position.expiry} {fmtNumber(position.strike)}
                    {position.right}
                  </div>
                  <div className="mt-1 text-xs text-muted">
                    {position.shortOrLong} {fmtNumber(position.quantity)} - mid {fmtCurrencySmall(position.currentMid)} - delta {fmtNumber(position.delta)}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-line/80 bg-panelSoft px-3 py-4 text-sm text-muted">
                No option positions yet. The trade flow above comes first.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  function renderTradeTicketForm() {
    if (!ticketPlan) {
      return null;
    }
    const analytics = computeTicketAnalytics(
      ticketPlan,
      effectiveTicketLegs,
      ticketAction,
      ticketQuantity,
      ticketOrderType === "LMT" ? validLimitPrice : ticketNetReferencePrice,
    );
    return (
      <div className="mt-4 grid gap-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
              ticketAction === "BUY"
                ? "border-accent/45 bg-accent/12 text-accent"
                : "border-line/80 bg-panelSoft text-muted hover:text-text"
            }`}
            data-testid="ticket-buy-button"
            onClick={() => {
              setTicketAction("BUY");
              resetTicketFeedback();
            }}
            type="button"
          >
            Buy
          </button>
          <button
            className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
              ticketAction === "SELL"
                ? "border-accent/45 bg-accent/12 text-accent"
                : "border-line/80 bg-panelSoft text-muted hover:text-text"
            }`}
            data-testid="ticket-sell-button"
            onClick={() => {
              setTicketAction("SELL");
              resetTicketFeedback();
            }}
            type="button"
          >
            Sell
          </button>
        </div>

        {ticketPlan.summary ? (
          <div className="rounded-xl border border-line/80 bg-panelSoft px-3 py-3 text-sm text-muted">{ticketPlan.summary}</div>
        ) : null}

        <div className="rounded-xl border border-line/80 bg-panelSoft px-3 py-3">
          <div className="text-xs uppercase tracking-[0.18em] text-muted">Legs</div>
          <div className="mt-3 grid gap-2">
            {effectiveTicketLegs.map((leg, index) => (
              <div key={`${leg.expiry}-${leg.strike}-${leg.right}-${index}`} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-text">
                  {leg.action} {leg.symbol} {leg.expiry} {fmtNumber(leg.strike)}
                  {leg.right}
                  {leg.ratio > 1 ? ` x${leg.ratio}` : ""}
                </span>
                <span className="text-muted">{fmtCurrencySmall(leg.referencePrice)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-xs uppercase tracking-[0.18em] text-muted">Qty</span>
            <input
              className="rounded-xl border border-line/80 bg-panelSoft px-3 py-2 text-sm text-text outline-none transition focus:border-accent/60"
              data-testid="ticket-quantity-input"
              min={1}
              onChange={(event) => {
                setTicketQuantity(Math.max(1, Number.parseInt(event.target.value || "1", 10) || 1));
                resetTicketFeedback();
              }}
              type="number"
              value={ticketQuantity}
            />
          </label>
          <label className="grid gap-2">
            <span className="text-xs uppercase tracking-[0.18em] text-muted">Order type</span>
            <select
              className="rounded-xl border border-line/80 bg-panelSoft px-3 py-2 text-sm text-text outline-none transition focus:border-accent/60"
              data-testid="ticket-order-type-select"
              onChange={(event) => {
                setTicketOrderType(event.target.value as "LMT" | "MKT");
                resetTicketFeedback();
              }}
              value={ticketOrderType}
            >
              <option value="LMT">LMT</option>
              <option value="MKT">MKT</option>
            </select>
          </label>
          {ticketOrderType === "LMT" ? (
            <label className="grid gap-2">
              <span className="text-xs uppercase tracking-[0.18em] text-muted">Limit</span>
              <input
                className="rounded-xl border border-line/80 bg-panelSoft px-3 py-2 text-sm text-text outline-none transition focus:border-accent/60"
                data-testid="ticket-limit-price-input"
                onChange={(event) => {
                  setTicketLimitPrice(event.target.value);
                  resetTicketFeedback();
                }}
                type="number"
                value={ticketLimitPrice}
              />
            </label>
          ) : null}
          <label className="grid gap-2">
            <span className="text-xs uppercase tracking-[0.18em] text-muted">Time in force</span>
            <select
              className="rounded-xl border border-line/80 bg-panelSoft px-3 py-2 text-sm text-text outline-none transition focus:border-accent/60"
              data-testid="ticket-tif-select"
              onChange={(event) => {
                setTicketTif(event.target.value as "DAY" | "GTC");
                resetTicketFeedback();
              }}
              value={ticketTif}
            >
              <option value="DAY">DAY</option>
              <option value="GTC">GTC</option>
            </select>
          </label>
        </div>

        <div className="grid gap-2 text-sm text-muted">
          <div className="flex items-center justify-between gap-3">
            <span>Net reference</span>
            <span>{fmtCurrencySmall(ticketNetReferencePrice)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>Net delta</span>
            <span>{fmtNumber(analytics.netDelta)}</span>
          </div>
          {analytics.width != null ? (
            <div className="flex items-center justify-between gap-3">
              <span>Spread width</span>
              <span>{fmtCurrencySmall(analytics.width)}</span>
            </div>
          ) : null}
          {analytics.maxProfit != null ? (
            <div className="flex items-center justify-between gap-3">
              <span>Max profit</span>
              <span>{fmtCurrencySmall(analytics.maxProfit)}</span>
            </div>
          ) : null}
          {analytics.maxLoss != null ? (
            <div className="flex items-center justify-between gap-3">
              <span>Max loss</span>
              <span>{fmtCurrencySmall(analytics.maxLoss)}</span>
            </div>
          ) : null}
        </div>

        {previewIsCurrent && previewMutation.data ? <PreviewSummary preview={previewMutation.data} /> : null}
        {previewError ? <ErrorState message={previewError} /> : null}
        {submitError ? <ErrorState message={submitError} /> : null}
        {cancelError ? <ErrorState message={cancelError} /> : null}
        {submitIsCurrent && submitMutation.data ? <SubmitSummary submitted={submitMutation.data} /> : null}

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            className="rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-sm font-medium text-text transition hover:border-accent/25 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="preview-order-button"
            disabled={!canPreviewTicket || previewMutation.isPending}
            onClick={() => {
              if (ticketRequest) {
                void previewMutation.mutateAsync(ticketRequest);
              }
            }}
            type="button"
          >
            {previewMutation.isPending ? "Previewing..." : "Preview order"}
          </button>
          <button
            className="rounded-xl border border-accent/30 bg-accent/10 px-4 py-3 text-sm font-medium text-accent transition hover:border-accent/50 hover:bg-accent/16 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="submit-order-button"
            disabled={!canSubmitTicket || submitMutation.isPending}
            onClick={() => {
              if (ticketRequest) {
                void submitMutation.mutateAsync(ticketRequest);
              }
            }}
            type="button"
          >
            {submitMutation.isPending ? "Submitting..." : "Submit order"}
          </button>
        </div>
      </div>
    );
  }

  function renderCollapsedTradeRail() {
    return (
      <div className="flex h-full min-h-[280px] items-start justify-center">
        <div className="flex h-full min-h-[280px] w-full flex-col items-center rounded-xl border border-line/80 bg-panel py-2">
          <button
            aria-expanded={optionsTradeRailOpen}
            aria-label="Expand trade ticket rail"
            className="inline-flex h-8 w-full items-center justify-center text-muted transition hover:text-text"
            data-testid="toggle-trade-rail"
            onClick={() => setOptionsTradeRailOpen(true)}
            type="button"
          >
            <SidebarToggleIcon open={optionsTradeRailOpen} />
          </button>
          <div className="mt-2 flex-1 [writing-mode:vertical-rl] rotate-180 text-center text-[10px] uppercase tracking-[0.16em] text-muted">
            Trade Ticket
          </div>
        </div>
      </div>
    );
  }

  function loadTicket(row: ChainRow, right: TicketContractSide) {
    const referencePrice =
      right === "C" ? row.callMid ?? row.callAsk ?? row.callBid ?? null : row.putMid ?? row.putAsk ?? row.putBid ?? null;
    const nextPlan: TicketPlan = {
      label: `${chainSymbol} ${selectedExpiry ?? activeDisplayedChain?.selectedExpiry ?? ""} ${fmtNumber(row.strike)}${right}`,
      strategyTag: null,
      summary: null,
      defaultAction: "SELL",
      legs: [
        {
          symbol: chainSymbol,
          expiry: selectedExpiry ?? activeDisplayedChain?.selectedExpiry ?? "",
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
    setTicketAction(nextPlan.defaultAction);
    setTicketQuantity(1);
    setTicketOrderType("LMT");
    setTicketLimitPrice(referencePrice != null ? referencePrice.toFixed(2) : "");
    setTicketTif("DAY");
    resetTicketFeedback();
  }

  function stageStructure(structure: OptionStructureStageRequest) {
    const expiry = selectedExpiry ?? activeDisplayedChain?.selectedExpiry ?? "";
    const nextPlan: TicketPlan = {
      label: structure.title,
      strategyTag: structure.strategyTag,
      summary: structure.summary,
      defaultAction: structure.defaultAction,
      legs: structure.legs.map((leg: OptionStructureLegTemplate) => ({
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
      })),
    };
    const defaultLimit = computeTicketNetReferencePrice(deriveEffectiveTicketLegs(nextPlan, nextPlan.defaultAction));
    setTicketPlan(nextPlan);
    setTicketAction(nextPlan.defaultAction);
    setTicketQuantity(1);
    setTicketOrderType(defaultLimit != null ? "LMT" : "MKT");
    setTicketLimitPrice(defaultLimit != null ? defaultLimit.toFixed(2) : "");
    setTicketTif("DAY");
    setOptionsTradeRailOpen(true);
    resetTicketFeedback();
  }

  function formatOpenOrderLabel(order: OpenOrderExposure) {
    if (order.secType === "BAG") {
      const structure = order.strategyTag ? titleCaseLabel(order.strategyTag) : "Multi-Leg Structure";
      return `${order.side} ${fmtNumber(order.quantity)} ${order.symbol} ${structure}`;
    }
    return `${order.side} ${fmtNumber(order.quantity)} ${order.symbol} ${order.expiry} ${fmtNumber(order.strike)}${order.right ?? ""}`;
  }

  function computeTicketAnalytics(
    plan: TicketPlan,
    legs: Array<TicketLegTemplate & { action: "BUY" | "SELL" }>,
    action: "BUY" | "SELL",
    quantity: number,
    pricingReference: number | null,
  ) {
    const netDelta = legs.reduce((total, leg) => total + (leg.delta ?? 0) * (leg.action === "BUY" ? 1 : -1) * leg.ratio * quantity, 0);
    const spreadStrikes = Array.from(new Set(legs.map((leg) => leg.strike))).sort((left, right) => left - right);
    const width =
      plan.legs.length === 2 && spreadStrikes.length === 2
        ? Math.abs(spreadStrikes[1] - spreadStrikes[0]) * 100 * quantity
        : null;
    if (width == null || pricingReference == null || action !== plan.defaultAction || plan.legs.length !== 2) {
      return { netDelta, width, maxProfit: null, maxLoss: null };
    }
    const totalPremium = Math.abs(pricingReference) * 100 * quantity;
    if (plan.defaultAction === "SELL") {
      return { netDelta, width, maxProfit: totalPremium, maxLoss: Math.max(width - totalPremium, 0) };
    }
    return { netDelta, width, maxProfit: Math.max(width - totalPremium, 0), maxLoss: totalPremium };
  }

  function deriveEffectiveTicketLegs(plan: TicketPlan, action: "BUY" | "SELL") {
    return plan.legs.map((leg) => ({
      ...leg,
      action: action === plan.defaultAction ? leg.entryAction : invertAction(leg.entryAction),
    }));
  }

  function computeTicketNetReferencePrice(legs: Array<TicketLegTemplate & { action: "BUY" | "SELL" }>) {
    const prices = legs
      .map((leg) => (leg.referencePrice == null ? null : (leg.action === "SELL" ? 1 : -1) * leg.referencePrice * leg.ratio))
      .filter((value): value is number => value != null);
    if (prices.length !== legs.length) {
      return null;
    }
    return prices.reduce((total, value) => total + value, 0);
  }

  function toggleVisibleGreek(nextGreek: ChainGreekKey) {
    setVisibleChainGreeks((current) =>
      current.includes(nextGreek) ? current.filter((value) => value !== nextGreek) : [...current, nextGreek],
    );
  }

  function toggleShowChainMark() {
    setShowChainMark((current) => !current);
  }

  function resetTicketFeedback() {
    previewMutation.reset();
    submitMutation.reset();
    cancelMutation.reset();
    setPreviewRequestKey(null);
  }
}

function invertAction(action: "BUY" | "SELL") {
  return action === "BUY" ? "SELL" : "BUY";
}

function titleCaseLabel(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
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

function PreviewSummary({ preview }: { preview: OptionOrderPreview }) {
  return (
    <div className="rounded-xl border border-line/80 bg-panelSoft px-3 py-3 text-sm">
      <div className="text-xs uppercase tracking-[0.18em] text-muted">Preview</div>
      {preview.structureLabel ? <div className="mt-2 text-sm font-medium text-text">{preview.structureLabel}</div> : null}
      <div className="mt-3 grid gap-2 text-muted">
        <div className="flex items-center justify-between gap-3">
          <span>Opening/closing</span>
          <span className="text-text">{preview.openingOrClosing}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Reference</span>
          <span className="text-text">{fmtCurrencySmall(preview.marketReferencePrice)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Gross premium</span>
          <span className="text-text">{fmtCurrencySmall(preview.estimatedGrossPremium)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Cash impact</span>
          <span className="text-text">{fmtCurrencySmall(preview.conservativeCashImpact)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Init margin</span>
          <span className="text-text">{fmtCurrencySmall(preview.brokerInitialMarginChange)}</span>
        </div>
        {preview.maxProfit != null ? (
          <div className="flex items-center justify-between gap-3">
            <span>Max profit</span>
            <span className="text-text">{fmtCurrencySmall(preview.maxProfit)}</span>
          </div>
        ) : null}
        {preview.maxLoss != null ? (
          <div className="flex items-center justify-between gap-3">
            <span>Max loss</span>
            <span className="text-text">{fmtCurrencySmall(preview.maxLoss)}</span>
          </div>
        ) : null}
      </div>
      {preview.legs.length > 1 ? (
        <div className="mt-3 grid gap-2 text-xs text-muted">
          {preview.legs.map((leg, index) => (
            <div key={`${leg.expiry}-${leg.strike}-${leg.right}-${index}`} className="flex items-center justify-between gap-3">
              <span>
                {leg.action} {leg.expiry} {fmtNumber(leg.strike)}
                {leg.right}
              </span>
              <span>{fmtCurrencySmall(leg.marketReferencePrice)}</span>
            </div>
          ))}
        </div>
      ) : null}
      {preview.warningText ? <div className="mt-3 text-sm text-caution">{preview.warningText}</div> : null}
      {preview.note ? <div className="mt-2 text-sm text-muted">{preview.note}</div> : null}
    </div>
  );
}

function SubmitSummary({ submitted }: { submitted: SubmittedOrder }) {
  return (
    <div className="rounded-xl border border-safe/25 bg-safe/10 px-3 py-3 text-sm text-safe" data-testid="submit-banner">
      Order {submitted.orderId} accepted with status {submitted.status}.
      {submitted.structureLabel ? ` ${submitted.structureLabel}.` : ""}
      {!submitted.structureLabel && submitted.legCount > 1 ? ` ${submitted.legCount} legs.` : ""}
      {submitted.message ? ` ${submitted.message}` : ""}
    </div>
  );
}

function CancelSummary({ cancelled }: { cancelled: OrderCancelResponse }) {
  return (
    <div className="rounded-xl border border-danger/25 bg-danger/10 px-3 py-3 text-sm text-danger" data-testid="cancel-banner">
      Order {cancelled.orderId} cancel request returned status {cancelled.status}.
      {cancelled.message ? ` ${cancelled.message}` : ""}
    </div>
  );
}

function SidebarToggleIcon({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 20 20" width="16">
      <path
        d={open ? "M12.5 5 7.5 10l5 5" : "M7.5 5l5 5-5 5"}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
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
