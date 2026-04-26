import { useState } from "react";

import { useOptionTradeTicket } from "../../components/trading/useTradeTicket";
import { ErrorState } from "../../components/ui/ErrorState";
import { fmtCurrencySmall, fmtNumber } from "../../lib/formatters";
import type { OptionOrderPreview, OptionOrderRequest, SubmittedOrder } from "../../lib/types";

type OptionsTicketAction = "BUY" | "SELL";
type OptionsTicketOrderType = "LMT" | "MKT";
type OptionsTicketTimeInForce = "DAY" | "GTC";

export type OptionsTicketLegTemplate = {
  symbol: string;
  expiry: string;
  strike: number;
  right: "C" | "P";
  entryAction: OptionsTicketAction;
  referencePrice: number | null;
  bid: number | null;
  ask: number | null;
  ratio: number;
  delta: number | null;
};

export type OptionsTicketPlan = {
  id: string;
  label: string;
  strategyTag: string | null;
  summary: string | null;
  defaultAction: OptionsTicketAction;
  defaultOrderType: OptionsTicketOrderType;
  defaultLimitPrice: string;
  defaultTif: OptionsTicketTimeInForce;
  legs: OptionsTicketLegTemplate[];
};

type OptionsTicketPlanShape = Pick<OptionsTicketPlan, "defaultAction" | "legs">;

type OptionsTradeTicketProps = {
  executionEnabled: boolean;
  plan: OptionsTicketPlan;
  selectedAccount?: string;
};

export function OptionsTradeTicket({ executionEnabled, plan, selectedAccount }: OptionsTradeTicketProps) {
  const [ticketAction, setTicketAction] = useState<OptionsTicketAction>(plan.defaultAction);
  const [ticketQuantity, setTicketQuantity] = useState(1);
  const [ticketOrderType, setTicketOrderType] = useState<OptionsTicketOrderType>(plan.defaultOrderType);
  const [ticketLimitPrice, setTicketLimitPrice] = useState(plan.defaultLimitPrice);
  const [ticketTif, setTicketTif] = useState<OptionsTicketTimeInForce>(plan.defaultTif);

  const effectiveTicketLegs = deriveEffectiveOptionsTicketLegs(plan, ticketAction);
  const selectedTicketLeg = effectiveTicketLegs[0] ?? null;
  const ticketNetReferencePrice = computeOptionsTicketNetReferencePrice(effectiveTicketLegs);
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
          strategyTag: plan.strategyTag,
          structureLabel: plan.label,
          legs: effectiveTicketLegs.map((leg) => ({
            expiry: leg.expiry,
            strike: leg.strike,
            right: leg.right,
            action: leg.action,
            ratio: leg.ratio,
          })),
        }
      : null;
  const {
    canPreviewTicket,
    canSubmitTicket,
    previewError,
    previewIsCurrent,
    previewMutation,
    resetTicketFeedback,
    submitError,
    submitIsCurrent,
    submitMutation,
  } = useOptionTradeTicket(ticketRequest, executionEnabled);
  const analytics = computeOptionsTicketAnalytics(
    plan,
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

      {plan.summary ? (
        <div className="rounded-xl border border-line/80 bg-panelSoft px-3 py-3 text-sm text-muted">{plan.summary}</div>
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
              setTicketOrderType(event.target.value as OptionsTicketOrderType);
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
              setTicketTif(event.target.value as OptionsTicketTimeInForce);
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

export function deriveEffectiveOptionsTicketLegs(plan: OptionsTicketPlanShape, action: OptionsTicketAction) {
  return plan.legs.map((leg) => ({
    ...leg,
    action: action === plan.defaultAction ? leg.entryAction : invertAction(leg.entryAction),
  }));
}

export function computeOptionsTicketNetReferencePrice(
  legs: Array<OptionsTicketLegTemplate & { action: OptionsTicketAction }>,
) {
  const prices = legs
    .map((leg) => (leg.referencePrice == null ? null : (leg.action === "SELL" ? 1 : -1) * leg.referencePrice * leg.ratio))
    .filter((value): value is number => value != null);
  if (prices.length !== legs.length) {
    return null;
  }
  return prices.reduce((total, value) => total + value, 0);
}

function computeOptionsTicketAnalytics(
  plan: OptionsTicketPlan,
  legs: Array<OptionsTicketLegTemplate & { action: OptionsTicketAction }>,
  action: OptionsTicketAction,
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

function invertAction(action: OptionsTicketAction) {
  return action === "BUY" ? "SELL" : "BUY";
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
