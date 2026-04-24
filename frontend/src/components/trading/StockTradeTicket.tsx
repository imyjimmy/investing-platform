import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "../../lib/api";
import { fmtCurrencySmall, fmtNumber } from "../../lib/formatters";
import type { ConnectionStatus, StockOrderPreview, StockOrderRequest, SubmittedOrder, TickerOverviewResponse } from "../../lib/types";
import { ErrorState } from "../ui/ErrorState";
import { activeTradingAccount, buildTradingAccountOptions } from "./tradingAccounts";

type StockTradeTicketProps = {
  symbol: string;
  overview: TickerOverviewResponse | undefined;
  selectedAccount?: string;
  connectionStatus?: ConnectionStatus;
  executionEnabled: boolean;
  netShares: number;
  onSelectedAccountChange: (accountId: string) => void;
};

export function StockTradeTicket({
  symbol,
  overview,
  selectedAccount,
  connectionStatus,
  executionEnabled,
  netShares,
  onSelectedAccountChange,
}: StockTradeTicketProps) {
  const queryClient = useQueryClient();
  const [ticketAction, setTicketAction] = useState<"BUY" | "SELL">("BUY");
  const [ticketQuantity, setTicketQuantity] = useState(100);
  const [ticketOrderType, setTicketOrderType] = useState<"LMT" | "MKT">("LMT");
  const [ticketLimitPrice, setTicketLimitPrice] = useState("");
  const [ticketTif, setTicketTif] = useState<"DAY" | "GTC">("DAY");
  const [previewRequestKey, setPreviewRequestKey] = useState<string | null>(null);

  const accountOptions = buildTradingAccountOptions(connectionStatus, selectedAccount);
  const activeAccount = activeTradingAccount(accountOptions, selectedAccount);
  const ticketAccountId = activeAccount?.accountId ?? null;
  const referencePrice = chooseStockReferencePrice(overview, ticketAction);
  const parsedLimitPrice = ticketOrderType === "LMT" ? Number(ticketLimitPrice) : null;
  const validLimitPrice =
    ticketOrderType === "MKT" ? null : Number.isFinite(parsedLimitPrice) && parsedLimitPrice != null && parsedLimitPrice > 0 ? parsedLimitPrice : null;
  const ticketRequest: StockOrderRequest | null =
    ticketAccountId && (ticketOrderType === "MKT" || validLimitPrice != null)
      ? {
          accountId: ticketAccountId,
          symbol,
          action: ticketAction,
          quantity: Math.max(1, Math.floor(ticketQuantity || 1)),
          orderType: ticketOrderType,
          limitPrice: ticketOrderType === "LMT" ? validLimitPrice : null,
          tif: ticketTif,
        }
      : null;
  const ticketRequestKey = ticketRequest ? JSON.stringify(ticketRequest) : null;
  const previewMutation = useMutation({
    mutationFn: api.previewStockOrder,
    onSuccess: (_data, variables) => setPreviewRequestKey(JSON.stringify(variables)),
  });
  const submitMutation = useMutation({
    mutationFn: api.submitStockOrder,
    onSuccess: async (_data, variables) => {
      setPreviewRequestKey(JSON.stringify(variables));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["risk-summary", variables.accountId] }),
        queryClient.invalidateQueries({ queryKey: ["positions", variables.accountId] }),
        queryClient.invalidateQueries({ queryKey: ["open-orders", variables.accountId] }),
      ]);
    },
  });
  const previewIsCurrent = Boolean(previewMutation.data && previewRequestKey && ticketRequestKey === previewRequestKey);
  const submitIsCurrent = Boolean(submitMutation.data && previewRequestKey && ticketRequestKey === previewRequestKey);
  const previewError = previewMutation.error instanceof Error ? previewMutation.error.message : null;
  const submitError = submitMutation.error instanceof Error ? submitMutation.error.message : null;
  const canPreviewTicket = executionEnabled && Boolean(ticketRequest);
  const canSubmitTicket = canPreviewTicket && previewIsCurrent;

  useEffect(() => {
    if (referencePrice != null) {
      setTicketLimitPrice(referencePrice.toFixed(2));
    }
    resetTicketFeedback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, overview?.generatedAt]);

  return (
    <div className="rounded-2xl border border-line/80 bg-panel px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Trade Ticket</div>
          <div className="mt-1 text-lg font-semibold text-text">{symbol} Stock</div>
        </div>
        <label className="relative shrink-0">
          <span className="sr-only">Trading account</span>
          <select
            className="h-9 appearance-none rounded-xl border border-line/80 bg-panelSoft px-3 pr-8 text-xs font-medium text-text outline-none transition focus:border-accent/60"
            data-testid="stock-ticket-account-select"
            onChange={(event) => {
              const nextOption = accountOptions.find((option) => option.key === event.target.value);
              if (nextOption?.accountId && !nextOption.disabled) {
                onSelectedAccountChange(nextOption.accountId);
                resetTicketFeedback();
              }
            }}
            value={activeAccount?.key ?? ""}
          >
            {activeAccount ? null : (
              <option disabled value="">
                No route
              </option>
            )}
            {accountOptions.map((option) => (
              <option key={option.key} disabled={option.disabled} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
          <DownChevronIcon />
        </label>
      </div>

      <div className="mt-4 grid gap-4">
        <div className="grid grid-cols-2 gap-2">
          <button
            className={`rounded-xl border px-3 py-2 text-sm font-medium transition ${
              ticketAction === "BUY"
                ? "border-accent/45 bg-accent/12 text-accent"
                : "border-line/80 bg-panelSoft text-muted hover:text-text"
            }`}
            data-testid="stock-ticket-buy-button"
            onClick={() => {
              setTicketAction("BUY");
              const nextReference = chooseStockReferencePrice(overview, "BUY");
              setTicketLimitPrice(nextReference != null ? nextReference.toFixed(2) : ticketLimitPrice);
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
            data-testid="stock-ticket-sell-button"
            onClick={() => {
              setTicketAction("SELL");
              const nextReference = chooseStockReferencePrice(overview, "SELL");
              setTicketLimitPrice(nextReference != null ? nextReference.toFixed(2) : ticketLimitPrice);
              resetTicketFeedback();
            }}
            type="button"
          >
            Sell
          </button>
        </div>

        <div className="grid gap-3">
          <label className="grid gap-2">
            <span className="text-xs uppercase tracking-[0.18em] text-muted">Qty</span>
            <input
              className="stock-ticket-number-input w-full rounded-xl border border-line/80 bg-panelSoft px-3 py-2 text-sm text-text outline-none transition focus:border-accent/60"
              data-testid="stock-ticket-quantity-input"
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
              className="w-full rounded-xl border border-line/80 bg-panelSoft px-3 py-2 text-sm text-text outline-none transition focus:border-accent/60"
              data-testid="stock-ticket-order-type-select"
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
                className="stock-ticket-number-input w-full rounded-xl border border-line/80 bg-panelSoft px-3 py-2 text-sm text-text outline-none transition focus:border-accent/60"
                data-testid="stock-ticket-limit-price-input"
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
              className="w-full rounded-xl border border-line/80 bg-panelSoft px-3 py-2 text-sm text-text outline-none transition focus:border-accent/60"
              data-testid="stock-ticket-tif-select"
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
            <span>Reference</span>
            <span>{fmtCurrencySmall(referencePrice)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>Estimated notional</span>
            <span>{fmtCurrencySmall((ticketOrderType === "LMT" ? validLimitPrice : referencePrice) == null ? null : (ticketOrderType === "LMT" ? validLimitPrice : referencePrice)! * ticketQuantity)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>Position after order</span>
            <span>{fmtNumber(netShares + (ticketAction === "BUY" ? ticketQuantity : -ticketQuantity))} shares</span>
          </div>
        </div>

        {previewIsCurrent && previewMutation.data ? <StockPreviewSummary preview={previewMutation.data} /> : null}
        {previewError ? <ErrorState message={previewError} /> : null}
        {submitError ? <ErrorState message={submitError} /> : null}
        {submitIsCurrent && submitMutation.data ? <SubmitSummary submitted={submitMutation.data} /> : null}

        <div className="grid gap-2 sm:grid-cols-2">
          <button
            className="rounded-xl border border-line/80 bg-panelSoft px-4 py-3 text-sm font-medium text-text transition hover:border-accent/25 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="preview-stock-order-button"
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
            data-testid="submit-stock-order-button"
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
    </div>
  );

  function resetTicketFeedback() {
    previewMutation.reset();
    submitMutation.reset();
    setPreviewRequestKey(null);
  }
}

function chooseStockReferencePrice(overview: TickerOverviewResponse | undefined, action: "BUY" | "SELL") {
  if (!overview) {
    return null;
  }
  if (action === "BUY") {
    return overview.quote.ask ?? overview.quote.price ?? overview.quote.last ?? overview.previousClose ?? null;
  }
  return overview.quote.bid ?? overview.quote.price ?? overview.quote.last ?? overview.previousClose ?? null;
}

function StockPreviewSummary({ preview }: { preview: StockOrderPreview }) {
  return (
    <div className="rounded-xl border border-line/80 bg-panelSoft px-3 py-3 text-sm">
      <div className="text-xs uppercase tracking-[0.18em] text-muted">Preview</div>
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
          <span>Gross value</span>
          <span className="text-text">{fmtCurrencySmall(preview.estimatedGrossTradeValue)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Cash impact</span>
          <span className="text-text">{fmtCurrencySmall(preview.conservativeCashImpact)}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span>Init margin</span>
          <span className="text-text">{fmtCurrencySmall(preview.brokerInitialMarginChange)}</span>
        </div>
      </div>
      {preview.warningText ? <div className="mt-3 text-sm text-caution">{preview.warningText}</div> : null}
      {preview.note ? <div className="mt-2 text-sm text-muted">{preview.note}</div> : null}
    </div>
  );
}

function SubmitSummary({ submitted }: { submitted: SubmittedOrder }) {
  return (
    <div className="rounded-xl border border-safe/25 bg-safe/10 px-3 py-3 text-sm text-safe" data-testid="stock-submit-banner">
      Order {submitted.orderId} accepted with status {submitted.status}.
      {submitted.message ? ` ${submitted.message}` : ""}
    </div>
  );
}

function DownChevronIcon() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
      fill="none"
      viewBox="0 0 20 20"
    >
      <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  );
}
