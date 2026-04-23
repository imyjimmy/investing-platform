import { useState } from "react";

import type {
  ChainRow,
  OptionChainResponse,
  OptionPosition,
  TickerOverviewResponse,
} from "../../lib/types";
import { MetricCard } from "../MetricCard";
import { Panel } from "../Panel";

type TicketContractSide = "C" | "P";
type TicketAction = "BUY" | "SELL";

export type OptionStructureLegTemplate = {
  expiry?: string | null;
  strike: number;
  right: TicketContractSide;
  action: TicketAction;
  ratio: number;
  referencePrice: number | null;
  bid: number | null;
  ask: number | null;
  delta: number | null;
};

export type OptionStructureStageRequest = {
  title: string;
  strategyTag: string;
  defaultAction: TicketAction;
  summary: string;
  legs: OptionStructureLegTemplate[];
};

export type OptionToolSharedProps = {
  chainSymbol: string;
  activeDisplayedChain: OptionChainResponse | null;
  displayedChainRows: ChainRow[];
  displayedExpiries: string[];
  activeExpiry?: string;
  optionPositions: OptionPosition[];
  tickerOverview?: TickerOverviewResponse;
  optionsDataSourceLabel: string;
  onLoadTicket: (row: ChainRow, right: TicketContractSide) => void;
  onStageStructure: (structure: OptionStructureStageRequest) => void;
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

type StrategyFamilyKey =
  | "single-option"
  | "covered-option"
  | "straddle"
  | "strangle"
  | "vertical"
  | "butterfly"
  | "condor"
  | "collar"
  | "iron-butterfly"
  | "iron-condor"
  | "calendar"
  | "diagonal"
  | "ratio";

type StrategyLibraryDefinition = {
  key: StrategyFamilyKey;
  label: string;
  heading: string;
  explanation: string;
};

type StrategySetupCard = {
  title: string;
  detail: string;
  metric: string;
  structure: OptionStructureStageRequest | null;
  disabledReason?: string | null;
};

function StrategyGlyph({ family }: { family: StrategyFamilyKey }) {
  const pathByFamily: Record<StrategyFamilyKey, string> = {
    "single-option": "M8 38 L22 38 L40 12",
    "covered-option": "M8 38 L22 22 L40 22",
    straddle: "M8 12 L24 40 L40 12",
    strangle: "M8 12 L18 40 L30 40 L40 12",
    vertical: "M8 38 L18 38 L30 18 L40 18",
    butterfly: "M8 38 L16 38 L24 10 L32 38 L40 38",
    condor: "M8 38 L14 38 L20 18 L28 18 L34 38 L40 38",
    collar: "M8 34 L18 34 L30 16 L40 16",
    "iron-butterfly": "M8 16 L16 16 L24 38 L32 16 L40 16",
    "iron-condor": "M8 16 L14 16 L20 38 L28 38 L34 16 L40 16",
    calendar: "M8 38 Q24 8 40 38",
    diagonal: "M8 38 Q18 34 24 22 T32 14 L40 18",
    ratio: "M8 22 L18 22 L26 10 L34 34 L40 40",
  };
  const secondaryPathByFamily: Partial<Record<StrategyFamilyKey, string>> = {
    "covered-option": "M8 40 L38 10",
  };
  return (
    <svg aria-hidden="true" className="h-9 w-9 shrink-0 text-accent" viewBox="0 0 48 48">
      <rect x="1" y="1" width="46" height="46" rx="12" fill="currentColor" opacity="0.08" />
      {secondaryPathByFamily[family] ? (
        <path
          d={secondaryPathByFamily[family]}
          fill="none"
          opacity="0.35"
          stroke="currentColor"
          strokeDasharray="4 4"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
        />
      ) : null}
      <path d={pathByFamily[family]} fill="none" opacity="0.95" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
    </svg>
  );
}

const STRATEGY_LIBRARY: StrategyLibraryDefinition[] = [
  {
    key: "single-option",
    label: "Single Option",
    heading: "What is a Single Option?",
    explanation:
      "A single option, or single-leg option, is the basic one-leg strategy: buying a single option such as a long call or long put, or selling a single option such as a short call or short put.",
  },
  {
    key: "covered-option",
    label: "Covered Option",
    heading: "What is a Covered Option?",
    explanation:
      "A covered option strategy consists of writing a call or put that is covered by an equivalent long or short stock position.",
  },
  {
    key: "straddle",
    label: "Straddle",
    heading: "What is a Straddle?",
    explanation:
      "A straddle involves a call and a put with the same strike price and the same expiration date.",
  },
  {
    key: "strangle",
    label: "Strangle",
    heading: "What is a Strangle?",
    explanation:
      "A strangle is similar to a straddle, but the call and put use different strike prices, making the position cheaper to enter but requiring a larger move to profit.",
  },
  {
    key: "vertical",
    label: "Vertical",
    heading: "What is a Vertical?",
    explanation:
      "A vertical spread is created by buying and selling options of the same type, on the same underlying, with the same expiration date, but at different strike prices.",
  },
  {
    key: "butterfly",
    label: "Butterfly",
    heading: "What is a Butterfly?",
    explanation:
      "A butterfly is built with either calls or puts in a 1-2-1 ratio across three strikes, with fixed risk and capped profit.",
  },
  {
    key: "condor",
    label: "Condor",
    heading: "What is a Condor?",
    explanation:
      "A condor is a four-leg strategy that uses either all calls or all puts with the same expiration date but different strike prices.",
  },
  {
    key: "collar",
    label: "Collar (with stock)",
    heading: "What is a Collar (with stock)?",
    explanation:
      "A collar involves holding the underlying stock while buying a protective put and selling a call to limit downside while also limiting upside.",
  },
  {
    key: "iron-butterfly",
    label: "Iron Butterfly",
    heading: "What is an Iron Butterfly?",
    explanation:
      "An iron butterfly combines a call spread and a put spread around the same middle strike, with all legs in the same expiration date.",
  },
  {
    key: "iron-condor",
    label: "Iron Condor",
    heading: "What is an Iron Condor?",
    explanation:
      "An iron condor is a neutral, range-bound strategy built with a bull put spread and a bear call spread, all with the same expiration date.",
  },
  {
    key: "calendar",
    label: "Calendar",
    heading: "What is a Calendar?",
    explanation:
      "A calendar spread involves buying and selling options of the same type with the same strike price but different expiration dates.",
  },
  {
    key: "diagonal",
    label: "Diagonal",
    heading: "What is a Diagonal?",
    explanation:
      "A diagonal spread combines features of both vertical and calendar spreads by using different strikes and different expiration dates.",
  },
  {
    key: "ratio",
    label: "Ratio",
    heading: "What is a Ratio Spread?",
    explanation:
      "A ratio spread uses an unequal number of long and short options, most commonly in a 2:1 relationship.",
  },
];

export function OptionBuilderTool({
  chainSymbol,
  activeDisplayedChain,
  displayedChainRows,
  displayedExpiries,
  activeExpiry,
  onStageStructure,
  onOpenChain,
}: OptionToolSharedProps) {
  const [selectedFamily, setSelectedFamily] = useState<StrategyFamilyKey>("single-option");

  const spotPrice = activeDisplayedChain?.underlying.price ?? null;
  const sortedRows = displayedChainRows.slice().sort((left, right) => left.strike - right.strike);
  const callRows = sortedRows.filter((row) => row.callBid != null || row.callAsk != null || row.callMid != null);
  const putRows = sortedRows.filter((row) => row.putBid != null || row.putAsk != null || row.putMid != null);
  const rowsBelowSpot = sortedRows.filter((row) => spotPrice != null && row.strike < spotPrice).slice().reverse();
  const rowsAboveSpot = sortedRows.filter((row) => spotPrice != null && row.strike > spotPrice);
  const sharedRows = sortedRows.filter((row) => (row.callBid != null || row.callAsk != null || row.callMid != null) && (row.putBid != null || row.putAsk != null || row.putMid != null));
  const atmRow =
    (spotPrice == null
      ? sharedRows[0]
      : sharedRows.slice().sort((left, right) => Math.abs(left.strike - spotPrice) - Math.abs(right.strike - spotPrice))[0]) ?? null;
  const currentExpiry = activeExpiry ?? activeDisplayedChain?.selectedExpiry ?? undefined;
  const laterExpiry = currentExpiry ? displayedExpiries.filter((expiry) => expiry > currentExpiry).sort()[0] ?? null : null;

  const makeLeg = (
    row: ChainRow,
    right: TicketContractSide,
    action: TicketAction,
    options?: { ratio?: number; expiry?: string | null; referencePrice?: number | null },
  ): OptionStructureLegTemplate => ({
    expiry: options?.expiry ?? null,
    strike: row.strike,
    right,
    action,
    ratio: options?.ratio ?? 1,
    referencePrice:
      options?.referencePrice ??
      (right === "C"
        ? row.callMid ?? (action === "BUY" ? row.callAsk : row.callBid) ?? row.callBid ?? row.callAsk ?? null
        : row.putMid ?? (action === "BUY" ? row.putAsk : row.putBid) ?? row.putBid ?? row.putAsk ?? null),
    bid: right === "C" ? row.callBid : row.putBid,
    ask: right === "C" ? row.callAsk : row.putAsk,
    delta: right === "C" ? row.callDelta : row.putDelta,
  });

  const inferDefaultAction = (legs: OptionStructureLegTemplate[], fallback: TicketAction = "BUY"): TicketAction => {
    const signedPrices = legs.map((leg) => (leg.referencePrice == null ? null : (leg.action === "SELL" ? 1 : -1) * leg.referencePrice * leg.ratio));
    if (signedPrices.some((value) => value == null)) {
      return fallback;
    }
    const netReference = signedPrices.filter((value): value is number => value != null).reduce((total, value) => total + value, 0);
    return netReference >= 0 ? "SELL" : "BUY";
  };

  const createStructure = (
    title: string,
    strategyTag: string,
    summary: string,
    legs: OptionStructureLegTemplate[],
    fallbackAction: TicketAction = "BUY",
  ): OptionStructureStageRequest => ({
    title,
    strategyTag,
    defaultAction: inferDefaultAction(legs, fallbackAction),
    summary,
    legs,
  });

  const pickNearestRow = (rows: ChainRow[], target: number | null) => {
    if (!rows.length) {
      return null;
    }
    if (target == null) {
      return rows[0] ?? null;
    }
    return rows.slice().sort((left, right) => Math.abs(left.strike - target) - Math.abs(right.strike - target))[0] ?? null;
  };

  const pickNextHigher = (rows: ChainRow[], strike: number) => rows.find((row) => row.strike > strike) ?? null;
  const pickNextLower = (rows: ChainRow[], strike: number) => {
    const candidates = rows.filter((row) => row.strike < strike);
    return candidates[candidates.length - 1] ?? null;
  };

  const findButterflyTriplet = (rows: ChainRow[], target: number | null) => {
    if (rows.length < 3) {
      return null;
    }
    const ordered = rows.slice().sort((left, right) => left.strike - right.strike);
    const middleCandidates =
      target == null ? ordered.slice(1, -1) : ordered.slice(1, -1).sort((left, right) => Math.abs(left.strike - target) - Math.abs(right.strike - target));
    for (const middle of middleCandidates) {
      const lowers = ordered.filter((row) => row.strike < middle.strike);
      const uppers = ordered.filter((row) => row.strike > middle.strike);
      for (let index = lowers.length - 1; index >= 0; index -= 1) {
        const lower = lowers[index];
        const desiredUpperStrike = middle.strike + (middle.strike - lower.strike);
        const matchingUpper = uppers.find((row) => Math.abs(row.strike - desiredUpperStrike) < 0.0001);
        if (matchingUpper) {
          return { lower, middle, upper: matchingUpper };
        }
      }
      if (lowers.length && uppers.length) {
        return { lower: lowers[lowers.length - 1], middle, upper: uppers[0] };
      }
    }
    return { lower: ordered[0], middle: ordered[1], upper: ordered[2] };
  };

  const findCondorQuartet = (rows: ChainRow[], target: number | null) => {
    if (rows.length < 4) {
      return null;
    }
    const ordered = rows.slice().sort((left, right) => left.strike - right.strike);
    const anchor = pickNearestRow(ordered, target);
    const anchorIndex = anchor ? ordered.findIndex((row) => row.strike === anchor.strike) : 1;
    const fallback = { low: ordered[0], lowerMid: ordered[1], upperMid: ordered[2], high: ordered[3] };
    if (anchorIndex < 0) {
      return fallback;
    }
    const low = ordered[Math.max(anchorIndex - 1, 0)];
    const lowerMid = ordered[Math.min(Math.max(anchorIndex, 1), ordered.length - 3)];
    const upperMid = ordered[Math.min(Math.max(anchorIndex + 1, 2), ordered.length - 2)];
    const high = ordered[Math.min(Math.max(anchorIndex + 2, 3), ordered.length - 1)];
    const uniqueStrikes = new Set([low.strike, lowerMid.strike, upperMid.strike, high.strike]);
    return uniqueStrikes.size === 4 ? { low, lowerMid, upperMid, high } : fallback;
  };

  const callNearAtm = pickNearestRow(callRows, spotPrice);
  const putNearAtm = pickNearestRow(putRows, spotPrice);
  const coveredCall = rowsAboveSpot.find((row) => row.callBid != null || row.callMid != null) ?? callNearAtm;
  const cashSecuredPut = rowsBelowSpot.find((row) => row.putBid != null || row.putMid != null) ?? putNearAtm;
  const shortCall = rowsAboveSpot.find((row) => row.callBid != null || row.callMid != null) ?? callNearAtm;
  const shortPut = rowsBelowSpot.find((row) => row.putBid != null || row.putMid != null) ?? putNearAtm;
  const longCall = rowsAboveSpot.find((row) => row.callAsk != null || row.callMid != null) ?? callNearAtm;
  const longPut = rowsBelowSpot.find((row) => row.putAsk != null || row.putMid != null) ?? putNearAtm;
  const callSpreadLong = rowsAboveSpot.find((row) => row.callAsk != null || row.callMid != null) ?? callNearAtm;
  const callSpreadShort = callSpreadLong ? pickNextHigher(callRows, callSpreadLong.strike) : null;
  const callCreditShort = rowsAboveSpot.find((row) => row.callBid != null || row.callMid != null) ?? callNearAtm;
  const callCreditLong = callCreditShort ? pickNextHigher(callRows, callCreditShort.strike) : null;
  const putSpreadLong = rowsBelowSpot.length ? rowsBelowSpot[rowsBelowSpot.length - 1] ?? null : null;
  const putSpreadShort = putSpreadLong ? pickNextHigher(putRows, putSpreadLong.strike) : cashSecuredPut;
  const putCreditShort = cashSecuredPut;
  const putCreditLong = putCreditShort ? pickNextLower(putRows, putCreditShort.strike) : null;
  const strangleCall = shortCall;
  const stranglePut = shortPut;
  const collarCall = shortCall;
  const collarPut = shortPut;
  const ironFlyCenter = atmRow;
  const ironFlyLowerPut = ironFlyCenter ? pickNextLower(putRows, ironFlyCenter.strike) : null;
  const ironFlyUpperCall = ironFlyCenter ? pickNextHigher(callRows, ironFlyCenter.strike) : null;
  const ironCondorShortPut = shortPut;
  const ironCondorLongPut = ironCondorShortPut ? pickNextLower(putRows, ironCondorShortPut.strike) : null;
  const ironCondorShortCall = shortCall;
  const ironCondorLongCall = ironCondorShortCall ? pickNextHigher(callRows, ironCondorShortCall.strike) : null;
  const callButterfly = findButterflyTriplet(callRows, spotPrice);
  const putButterfly = findButterflyTriplet(putRows, spotPrice);
  const callCondor = findCondorQuartet(callRows, spotPrice);
  const putCondor = findCondorQuartet(putRows, spotPrice);

  const singleOptionCards: StrategySetupCard[] = [
    {
      title: "Long Call",
      detail: longCall
        ? `Buy the ${fmtCurrencySmall(longCall.strike)} call for defined-risk upside exposure.`
        : "Load a chain with liquid calls to stage a long call.",
      metric: longCall ? fmtNumber(longCall.distanceFromSpotPct, "% vs spot") : "Waiting",
      structure: longCall
        ? createStructure("Long Call", "long-option", `Buy the ${fmtCurrencySmall(longCall.strike)} call.`, [makeLeg(longCall, "C", "BUY")], "BUY")
        : null,
    },
    {
      title: "Long Put",
      detail: longPut
        ? `Buy the ${fmtCurrencySmall(longPut.strike)} put for defined-risk downside exposure.`
        : "Load a chain with liquid puts to stage a long put.",
      metric: longPut ? fmtNumber(Math.abs(longPut.distanceFromSpotPct), "% vs spot") : "Waiting",
      structure: longPut
        ? createStructure("Long Put", "long-option", `Buy the ${fmtCurrencySmall(longPut.strike)} put.`, [makeLeg(longPut, "P", "BUY")], "BUY")
        : null,
    },
    {
      title: "Short Call",
      detail: shortCall
        ? `Sell the ${fmtCurrencySmall(shortCall.strike)} call to collect premium against a bearish or covered view.`
        : "Load a chain with liquid calls to stage a short call.",
      metric: shortCall ? fmtCurrencySmall(shortCall.callMid ?? shortCall.callBid) : "Premium",
      structure: shortCall
        ? createStructure("Short Call", "short-option", `Sell the ${fmtCurrencySmall(shortCall.strike)} call.`, [makeLeg(shortCall, "C", "SELL")], "SELL")
        : null,
    },
    {
      title: "Short Put",
      detail: shortPut
        ? `Sell the ${fmtCurrencySmall(shortPut.strike)} put to collect premium and accept assignment risk.`
        : "Load a chain with liquid puts to stage a short put.",
      metric: shortPut ? fmtCurrencySmall(shortPut.putMid ?? shortPut.putBid) : "Premium",
      structure: shortPut
        ? createStructure("Short Put", "short-option", `Sell the ${fmtCurrencySmall(shortPut.strike)} put.`, [makeLeg(shortPut, "P", "SELL")], "SELL")
        : null,
    },
  ];

  const coveredOptionCards: StrategySetupCard[] = [
    {
      title: "Covered Call",
      detail: coveredCall
        ? `Sell the ${fmtCurrencySmall(coveredCall.strike)} call against shares already owned.`
        : "Load a chain with calls above spot to stage a covered call.",
      metric: coveredCall ? fmtNumber(coveredCall.distanceFromSpotPct, "% OTM") : "Waiting",
      structure: coveredCall
        ? createStructure(
            "Covered Call",
            "covered-call",
            `Sell ${fmtCurrencySmall(coveredCall.strike)} call against shares already owned.`,
            [makeLeg(coveredCall, "C", "SELL")],
            "SELL",
          )
        : null,
    },
    {
      title: "Cash-Secured Put",
      detail: cashSecuredPut
        ? `Sell the ${fmtCurrencySmall(cashSecuredPut.strike)} put while keeping cash ready for assignment.`
        : "Load a chain with puts below spot to stage a cash-secured put.",
      metric: cashSecuredPut ? fmtCurrency(cashSecuredPut.conservativePutCollateral) : "Collateral",
      structure: cashSecuredPut
        ? createStructure(
            "Cash-Secured Put",
            "cash-secured-put",
            `Sell ${fmtCurrencySmall(cashSecuredPut.strike)} put with cash reserved for assignment.`,
            [makeLeg(cashSecuredPut, "P", "SELL")],
            "SELL",
          )
        : null,
    },
    {
      title: "Covered Put",
      detail: "A covered put combines a short stock position with a short put option.",
      metric: "Needs stock leg",
      structure: null,
      disabledReason: "Available in a future update.",
    },
  ];

  const straddleCards: StrategySetupCard[] = [
    {
      title: "Long Straddle",
      detail: atmRow
        ? `Buy the ${fmtCurrencySmall(atmRow.strike)} call and put to position for a large move either way.`
        : "Load an expiry with both calls and puts near spot to stage a long straddle.",
      metric: atmRow ? `ATM ${fmtCurrencySmall(atmRow.strike)}` : "Waiting",
      structure: atmRow
        ? createStructure(
            "Long Straddle",
            "straddle",
            `Buy the ${fmtCurrencySmall(atmRow.strike)} call and put for a volatility breakout.`,
            [makeLeg(atmRow, "C", "BUY"), makeLeg(atmRow, "P", "BUY")],
            "BUY",
          )
        : null,
    },
    {
      title: "Short Straddle",
      detail: atmRow
        ? `Sell the ${fmtCurrencySmall(atmRow.strike)} call and put to collect premium around the current spot.`
        : "Load an expiry with both calls and puts near spot to stage a short straddle.",
      metric: atmRow ? `ATM ${fmtCurrencySmall(atmRow.strike)}` : "Waiting",
      structure: atmRow
        ? createStructure(
            "Short Straddle",
            "straddle",
            `Sell the ${fmtCurrencySmall(atmRow.strike)} call and put to express a pinning view.`,
            [makeLeg(atmRow, "C", "SELL"), makeLeg(atmRow, "P", "SELL")],
            "SELL",
          )
        : null,
    },
  ];

  const strangleCards: StrategySetupCard[] = [
    {
      title: "Long Strangle",
      detail:
        stranglePut && strangleCall
          ? `Buy the ${fmtCurrencySmall(stranglePut.strike)} put and ${fmtCurrencySmall(strangleCall.strike)} call for a cheaper breakout trade than a straddle.`
          : "Needs one liquid put below spot and one liquid call above spot.",
      metric: stranglePut && strangleCall ? `${fmtCurrencySmall(stranglePut.strike)} / ${fmtCurrencySmall(strangleCall.strike)}` : "Waiting",
      structure:
        stranglePut && strangleCall
          ? createStructure(
              "Long Strangle",
              "strangle",
              `Buy the ${fmtCurrencySmall(stranglePut.strike)} put and ${fmtCurrencySmall(strangleCall.strike)} call.`,
              [makeLeg(stranglePut, "P", "BUY"), makeLeg(strangleCall, "C", "BUY")],
              "BUY",
            )
          : null,
    },
    {
      title: "Short Strangle",
      detail:
        stranglePut && strangleCall
          ? `Sell the ${fmtCurrencySmall(stranglePut.strike)} put and ${fmtCurrencySmall(strangleCall.strike)} call to lean range-bound.`
          : "Needs one liquid put below spot and one liquid call above spot.",
      metric: stranglePut && strangleCall ? `${fmtCurrencySmall(stranglePut.strike)} / ${fmtCurrencySmall(strangleCall.strike)}` : "Waiting",
      structure:
        stranglePut && strangleCall
          ? createStructure(
              "Short Strangle",
              "strangle",
              `Sell the ${fmtCurrencySmall(stranglePut.strike)} put and ${fmtCurrencySmall(strangleCall.strike)} call.`,
              [makeLeg(stranglePut, "P", "SELL"), makeLeg(strangleCall, "C", "SELL")],
              "SELL",
            )
          : null,
    },
  ];

  const verticalCards: StrategySetupCard[] = [
    {
      title: "Call Debit Spread",
      detail:
        callSpreadLong && callSpreadShort
          ? `Buy ${fmtCurrencySmall(callSpreadLong.strike)} / sell ${fmtCurrencySmall(callSpreadShort.strike)} calls for defined-risk upside.`
          : "Needs two liquid call strikes.",
      metric: callSpreadLong && callSpreadShort ? `Width ${fmtCurrencySmall(callSpreadShort.strike - callSpreadLong.strike)}` : "Defined risk",
      structure:
        callSpreadLong && callSpreadShort
          ? createStructure(
              "Call Debit Spread",
              "call-debit-spread",
              `Buy ${fmtCurrencySmall(callSpreadLong.strike)} / sell ${fmtCurrencySmall(callSpreadShort.strike)} calls.`,
              [makeLeg(callSpreadLong, "C", "BUY"), makeLeg(callSpreadShort, "C", "SELL")],
              "BUY",
            )
          : null,
    },
    {
      title: "Put Debit Spread",
      detail:
        putSpreadLong && putSpreadShort
          ? `Buy ${fmtCurrencySmall(putSpreadShort.strike)} / sell ${fmtCurrencySmall(putSpreadLong.strike)} puts for defined-risk downside.`
          : "Needs two liquid put strikes.",
      metric: putSpreadLong && putSpreadShort ? `Width ${fmtCurrencySmall(putSpreadShort.strike - putSpreadLong.strike)}` : "Defined risk",
      structure:
        putSpreadLong && putSpreadShort
          ? createStructure(
              "Put Debit Spread",
              "put-debit-spread",
              `Buy ${fmtCurrencySmall(putSpreadShort.strike)} / sell ${fmtCurrencySmall(putSpreadLong.strike)} puts.`,
              [makeLeg(putSpreadShort, "P", "BUY"), makeLeg(putSpreadLong, "P", "SELL")],
              "BUY",
            )
          : null,
    },
    {
      title: "Call Credit Spread",
      detail:
        callCreditShort && callCreditLong
          ? `Sell ${fmtCurrencySmall(callCreditShort.strike)} / buy ${fmtCurrencySmall(callCreditLong.strike)} calls to define upside risk.`
          : "Needs two liquid call strikes.",
      metric: callCreditShort && callCreditLong ? `Width ${fmtCurrencySmall(callCreditLong.strike - callCreditShort.strike)}` : "Defined risk",
      structure:
        callCreditShort && callCreditLong
          ? createStructure(
              "Call Credit Spread",
              "call-credit-spread",
              `Sell ${fmtCurrencySmall(callCreditShort.strike)} / buy ${fmtCurrencySmall(callCreditLong.strike)} calls.`,
              [makeLeg(callCreditShort, "C", "SELL"), makeLeg(callCreditLong, "C", "BUY")],
              "SELL",
            )
          : null,
    },
    {
      title: "Put Credit Spread",
      detail:
        putCreditShort && putCreditLong
          ? `Sell ${fmtCurrencySmall(putCreditShort.strike)} / buy ${fmtCurrencySmall(putCreditLong.strike)} puts to define downside risk.`
          : "Needs two liquid put strikes.",
      metric: putCreditShort && putCreditLong ? `Width ${fmtCurrencySmall(putCreditShort.strike - putCreditLong.strike)}` : "Defined risk",
      structure:
        putCreditShort && putCreditLong
          ? createStructure(
              "Put Credit Spread",
              "put-credit-spread",
              `Sell ${fmtCurrencySmall(putCreditShort.strike)} / buy ${fmtCurrencySmall(putCreditLong.strike)} puts.`,
              [makeLeg(putCreditShort, "P", "SELL"), makeLeg(putCreditLong, "P", "BUY")],
              "SELL",
            )
          : null,
    },
  ];

  const butterflyCards: StrategySetupCard[] = [
    {
      title: "Call Butterfly",
      detail:
        callButterfly != null
          ? `Buy ${fmtCurrencySmall(callButterfly.lower.strike)}, sell 2x ${fmtCurrencySmall(callButterfly.middle.strike)}, buy ${fmtCurrencySmall(callButterfly.upper.strike)} calls.`
          : "Needs three liquid call strikes.",
      metric:
        callButterfly != null
          ? `${fmtCurrencySmall(callButterfly.lower.strike)} / ${fmtCurrencySmall(callButterfly.middle.strike)} / ${fmtCurrencySmall(callButterfly.upper.strike)}`
          : "1-2-1",
      structure:
        callButterfly != null
          ? createStructure(
              "Call Butterfly",
              "butterfly",
              `Call butterfly centered on ${fmtCurrencySmall(callButterfly.middle.strike)}.`,
              [
                makeLeg(callButterfly.lower, "C", "BUY"),
                makeLeg(callButterfly.middle, "C", "SELL", { ratio: 2 }),
                makeLeg(callButterfly.upper, "C", "BUY"),
              ],
              "BUY",
            )
          : null,
    },
    {
      title: "Put Butterfly",
      detail:
        putButterfly != null
          ? `Buy ${fmtCurrencySmall(putButterfly.lower.strike)}, sell 2x ${fmtCurrencySmall(putButterfly.middle.strike)}, buy ${fmtCurrencySmall(putButterfly.upper.strike)} puts.`
          : "Needs three liquid put strikes.",
      metric:
        putButterfly != null
          ? `${fmtCurrencySmall(putButterfly.lower.strike)} / ${fmtCurrencySmall(putButterfly.middle.strike)} / ${fmtCurrencySmall(putButterfly.upper.strike)}`
          : "1-2-1",
      structure:
        putButterfly != null
          ? createStructure(
              "Put Butterfly",
              "butterfly",
              `Put butterfly centered on ${fmtCurrencySmall(putButterfly.middle.strike)}.`,
              [
                makeLeg(putButterfly.lower, "P", "BUY"),
                makeLeg(putButterfly.middle, "P", "SELL", { ratio: 2 }),
                makeLeg(putButterfly.upper, "P", "BUY"),
              ],
              "BUY",
            )
          : null,
    },
  ];

  const condorCards: StrategySetupCard[] = [
    {
      title: "Call Condor",
      detail:
        callCondor != null
          ? `Buy ${fmtCurrencySmall(callCondor.low.strike)}, sell ${fmtCurrencySmall(callCondor.lowerMid.strike)} and ${fmtCurrencySmall(callCondor.upperMid.strike)}, buy ${fmtCurrencySmall(callCondor.high.strike)} calls.`
          : "Needs four liquid call strikes.",
      metric:
        callCondor != null
          ? `${fmtCurrencySmall(callCondor.low.strike)} to ${fmtCurrencySmall(callCondor.high.strike)}`
          : "Four strikes",
      structure:
        callCondor != null
          ? createStructure(
              "Call Condor",
              "condor",
              `Call condor spanning ${fmtCurrencySmall(callCondor.low.strike)} to ${fmtCurrencySmall(callCondor.high.strike)}.`,
              [
                makeLeg(callCondor.low, "C", "BUY"),
                makeLeg(callCondor.lowerMid, "C", "SELL"),
                makeLeg(callCondor.upperMid, "C", "SELL"),
                makeLeg(callCondor.high, "C", "BUY"),
              ],
              "BUY",
            )
          : null,
    },
    {
      title: "Put Condor",
      detail:
        putCondor != null
          ? `Buy ${fmtCurrencySmall(putCondor.low.strike)}, sell ${fmtCurrencySmall(putCondor.lowerMid.strike)} and ${fmtCurrencySmall(putCondor.upperMid.strike)}, buy ${fmtCurrencySmall(putCondor.high.strike)} puts.`
          : "Needs four liquid put strikes.",
      metric:
        putCondor != null
          ? `${fmtCurrencySmall(putCondor.low.strike)} to ${fmtCurrencySmall(putCondor.high.strike)}`
          : "Four strikes",
      structure:
        putCondor != null
          ? createStructure(
              "Put Condor",
              "condor",
              `Put condor spanning ${fmtCurrencySmall(putCondor.low.strike)} to ${fmtCurrencySmall(putCondor.high.strike)}.`,
              [
                makeLeg(putCondor.low, "P", "BUY"),
                makeLeg(putCondor.lowerMid, "P", "SELL"),
                makeLeg(putCondor.upperMid, "P", "SELL"),
                makeLeg(putCondor.high, "P", "BUY"),
              ],
              "BUY",
            )
          : null,
    },
  ];

  const collarCards: StrategySetupCard[] = [
    {
      title: "Collar Overlay",
      detail:
        collarPut && collarCall
          ? `Buy the ${fmtCurrencySmall(collarPut.strike)} put and sell the ${fmtCurrencySmall(collarCall.strike)} call around stock already owned.`
          : "Needs one put below spot and one call above spot.",
      metric: collarPut && collarCall ? `${fmtCurrencySmall(collarPut.strike)} / ${fmtCurrencySmall(collarCall.strike)}` : "Needs shares",
      structure:
        collarPut && collarCall
          ? createStructure(
              "Collar Overlay",
              "collar",
              `Buy the ${fmtCurrencySmall(collarPut.strike)} protective put and sell the ${fmtCurrencySmall(collarCall.strike)} call against stock.`,
              [makeLeg(collarPut, "P", "BUY"), makeLeg(collarCall, "C", "SELL")],
              "BUY",
            )
          : null,
    },
  ];

  const ironButterflyCards: StrategySetupCard[] = [
    {
      title: "Short Iron Butterfly",
      detail:
        ironFlyCenter && ironFlyLowerPut && ironFlyUpperCall
          ? `Sell the ${fmtCurrencySmall(ironFlyCenter.strike)} straddle and buy wings at ${fmtCurrencySmall(ironFlyLowerPut.strike)} / ${fmtCurrencySmall(ironFlyUpperCall.strike)}.`
          : "Needs one shared center strike plus one lower put wing and one higher call wing.",
      metric:
        ironFlyCenter && ironFlyLowerPut && ironFlyUpperCall
          ? `${fmtCurrencySmall(ironFlyLowerPut.strike)} / ${fmtCurrencySmall(ironFlyCenter.strike)} / ${fmtCurrencySmall(ironFlyUpperCall.strike)}`
          : "Credit structure",
      structure:
        ironFlyCenter && ironFlyLowerPut && ironFlyUpperCall
          ? createStructure(
              "Short Iron Butterfly",
              "iron-butterfly",
              `Short iron butterfly centered on ${fmtCurrencySmall(ironFlyCenter.strike)}.`,
              [
                makeLeg(ironFlyLowerPut, "P", "BUY"),
                makeLeg(ironFlyCenter, "P", "SELL"),
                makeLeg(ironFlyCenter, "C", "SELL"),
                makeLeg(ironFlyUpperCall, "C", "BUY"),
              ],
              "SELL",
            )
          : null,
    },
  ];

  const ironCondorCards: StrategySetupCard[] = [
    {
      title: "Short Iron Condor",
      detail:
        ironCondorLongPut && ironCondorShortPut && ironCondorShortCall && ironCondorLongCall
          ? `Sell ${fmtCurrencySmall(ironCondorShortPut.strike)} / ${fmtCurrencySmall(ironCondorShortCall.strike)} and buy wings at ${fmtCurrencySmall(ironCondorLongPut.strike)} / ${fmtCurrencySmall(ironCondorLongCall.strike)}.`
          : "Needs put and call spreads on the same expiry.",
      metric:
        ironCondorLongPut && ironCondorShortPut && ironCondorShortCall && ironCondorLongCall
          ? `${fmtCurrencySmall(ironCondorShortPut.strike)} to ${fmtCurrencySmall(ironCondorShortCall.strike)}`
          : "Credit structure",
      structure:
        ironCondorLongPut && ironCondorShortPut && ironCondorShortCall && ironCondorLongCall
          ? createStructure(
              "Short Iron Condor",
              "iron-condor",
              `Short iron condor with short strikes at ${fmtCurrencySmall(ironCondorShortPut.strike)} and ${fmtCurrencySmall(ironCondorShortCall.strike)}.`,
              [
                makeLeg(ironCondorLongPut, "P", "BUY"),
                makeLeg(ironCondorShortPut, "P", "SELL"),
                makeLeg(ironCondorShortCall, "C", "SELL"),
                makeLeg(ironCondorLongCall, "C", "BUY"),
              ],
              "SELL",
            )
          : null,
    },
  ];

  const calendarCards: StrategySetupCard[] = [
    {
      title: "Call Calendar",
      detail:
        callNearAtm && currentExpiry && laterExpiry
          ? `Buy the ${laterExpiry} ${fmtCurrencySmall(callNearAtm.strike)} call and sell the nearer ${currentExpiry} call at the same strike.`
          : "Needs a later listed expiry alongside the currently loaded expiry.",
      metric: laterExpiry && currentExpiry ? `${currentExpiry} / ${laterExpiry}` : "Two expiries",
      structure:
        callNearAtm && currentExpiry && laterExpiry
          ? createStructure(
              "Call Calendar",
              "calendar-spread",
              `Buy the ${laterExpiry} ${fmtCurrencySmall(callNearAtm.strike)} call and sell the nearer ${currentExpiry} call.`,
              [
                makeLeg(callNearAtm, "C", "BUY", { expiry: laterExpiry, referencePrice: null }),
                makeLeg(callNearAtm, "C", "SELL", { expiry: currentExpiry }),
              ],
              "BUY",
            )
          : null,
      disabledReason: laterExpiry ? null : "Load a chain with later expiries listed to stage a calendar.",
    },
    {
      title: "Put Calendar",
      detail:
        putNearAtm && currentExpiry && laterExpiry
          ? `Buy the ${laterExpiry} ${fmtCurrencySmall(putNearAtm.strike)} put and sell the nearer ${currentExpiry} put at the same strike.`
          : "Needs a later listed expiry alongside the currently loaded expiry.",
      metric: laterExpiry && currentExpiry ? `${currentExpiry} / ${laterExpiry}` : "Two expiries",
      structure:
        putNearAtm && currentExpiry && laterExpiry
          ? createStructure(
              "Put Calendar",
              "calendar-spread",
              `Buy the ${laterExpiry} ${fmtCurrencySmall(putNearAtm.strike)} put and sell the nearer ${currentExpiry} put.`,
              [
                makeLeg(putNearAtm, "P", "BUY", { expiry: laterExpiry, referencePrice: null }),
                makeLeg(putNearAtm, "P", "SELL", { expiry: currentExpiry }),
              ],
              "BUY",
            )
          : null,
      disabledReason: laterExpiry ? null : "Load a chain with later expiries listed to stage a calendar.",
    },
  ];

  const diagonalCards: StrategySetupCard[] = [
    {
      title: "Bull Call Diagonal",
      detail:
        callSpreadLong && callSpreadShort && currentExpiry && laterExpiry
          ? `Buy the farther-dated ${fmtCurrencySmall(callSpreadLong.strike)} call and sell the nearer ${fmtCurrencySmall(callSpreadShort.strike)} call.`
          : "Needs two call strikes plus a later expiry.",
      metric:
        callSpreadLong && callSpreadShort ? `${fmtCurrencySmall(callSpreadLong.strike)} / ${fmtCurrencySmall(callSpreadShort.strike)}` : "Bullish bias",
      structure:
        callSpreadLong && callSpreadShort && currentExpiry && laterExpiry
          ? createStructure(
              "Bull Call Diagonal",
              "diagonal-spread",
              `Buy the farther-dated ${fmtCurrencySmall(callSpreadLong.strike)} call and sell the nearer ${fmtCurrencySmall(callSpreadShort.strike)} call.`,
              [
                makeLeg(callSpreadLong, "C", "BUY", { expiry: laterExpiry, referencePrice: null }),
                makeLeg(callSpreadShort, "C", "SELL", { expiry: currentExpiry }),
              ],
              "BUY",
            )
          : null,
      disabledReason: laterExpiry ? null : "Load a chain with later expiries listed to stage a diagonal.",
    },
    {
      title: "Bear Put Diagonal",
      detail:
        putSpreadShort && putSpreadLong && currentExpiry && laterExpiry
          ? `Buy the farther-dated ${fmtCurrencySmall(putSpreadShort.strike)} put and sell the nearer ${fmtCurrencySmall(putSpreadLong.strike)} put.`
          : "Needs two put strikes plus a later expiry.",
      metric:
        putSpreadShort && putSpreadLong ? `${fmtCurrencySmall(putSpreadShort.strike)} / ${fmtCurrencySmall(putSpreadLong.strike)}` : "Bearish bias",
      structure:
        putSpreadShort && putSpreadLong && currentExpiry && laterExpiry
          ? createStructure(
              "Bear Put Diagonal",
              "diagonal-spread",
              `Buy the farther-dated ${fmtCurrencySmall(putSpreadShort.strike)} put and sell the nearer ${fmtCurrencySmall(putSpreadLong.strike)} put.`,
              [
                makeLeg(putSpreadShort, "P", "BUY", { expiry: laterExpiry, referencePrice: null }),
                makeLeg(putSpreadLong, "P", "SELL", { expiry: currentExpiry }),
              ],
              "BUY",
            )
          : null,
      disabledReason: laterExpiry ? null : "Load a chain with later expiries listed to stage a diagonal.",
    },
  ];

  const ratioCards: StrategySetupCard[] = [
    {
      title: "Call Front Ratio",
      detail:
        callSpreadLong && callSpreadShort
          ? `Buy 1x ${fmtCurrencySmall(callSpreadLong.strike)} call and sell 2x ${fmtCurrencySmall(callSpreadShort.strike)} calls.`
          : "Needs two call strikes.",
      metric: callSpreadLong && callSpreadShort ? "1x2 short premium" : "1x2",
      structure:
        callSpreadLong && callSpreadShort
          ? createStructure(
              "Call Front Ratio",
              "ratio-spread",
              `Buy 1x ${fmtCurrencySmall(callSpreadLong.strike)} call and sell 2x ${fmtCurrencySmall(callSpreadShort.strike)} calls.`,
              [makeLeg(callSpreadLong, "C", "BUY"), makeLeg(callSpreadShort, "C", "SELL", { ratio: 2 })],
              "SELL",
            )
          : null,
    },
    {
      title: "Call Back Ratio",
      detail:
        callSpreadLong && callSpreadShort
          ? `Sell 1x ${fmtCurrencySmall(callSpreadLong.strike)} call and buy 2x ${fmtCurrencySmall(callSpreadShort.strike)} calls.`
          : "Needs two call strikes.",
      metric: callSpreadLong && callSpreadShort ? "1x2 long convexity" : "1x2",
      structure:
        callSpreadLong && callSpreadShort
          ? createStructure(
              "Call Back Ratio",
              "ratio-spread",
              `Sell 1x ${fmtCurrencySmall(callSpreadLong.strike)} call and buy 2x ${fmtCurrencySmall(callSpreadShort.strike)} calls.`,
              [makeLeg(callSpreadLong, "C", "SELL"), makeLeg(callSpreadShort, "C", "BUY", { ratio: 2 })],
              "BUY",
            )
          : null,
    },
    {
      title: "Put Front Ratio",
      detail:
        putSpreadShort && putSpreadLong
          ? `Buy 1x ${fmtCurrencySmall(putSpreadShort.strike)} put and sell 2x ${fmtCurrencySmall(putSpreadLong.strike)} puts.`
          : "Needs two put strikes.",
      metric: putSpreadShort && putSpreadLong ? "1x2 short premium" : "1x2",
      structure:
        putSpreadShort && putSpreadLong
          ? createStructure(
              "Put Front Ratio",
              "ratio-spread",
              `Buy 1x ${fmtCurrencySmall(putSpreadShort.strike)} put and sell 2x ${fmtCurrencySmall(putSpreadLong.strike)} puts.`,
              [makeLeg(putSpreadShort, "P", "BUY"), makeLeg(putSpreadLong, "P", "SELL", { ratio: 2 })],
              "SELL",
            )
          : null,
    },
    {
      title: "Put Back Ratio",
      detail:
        putSpreadShort && putSpreadLong
          ? `Sell 1x ${fmtCurrencySmall(putSpreadShort.strike)} put and buy 2x ${fmtCurrencySmall(putSpreadLong.strike)} puts.`
          : "Needs two put strikes.",
      metric: putSpreadShort && putSpreadLong ? "1x2 long convexity" : "1x2",
      structure:
        putSpreadShort && putSpreadLong
          ? createStructure(
              "Put Back Ratio",
              "ratio-spread",
              `Sell 1x ${fmtCurrencySmall(putSpreadShort.strike)} put and buy 2x ${fmtCurrencySmall(putSpreadLong.strike)} puts.`,
              [makeLeg(putSpreadShort, "P", "SELL"), makeLeg(putSpreadLong, "P", "BUY", { ratio: 2 })],
              "BUY",
            )
          : null,
    },
  ];

  const strategyCardsByFamily: Record<StrategyFamilyKey, StrategySetupCard[]> = {
    "single-option": singleOptionCards,
    "covered-option": coveredOptionCards,
    straddle: straddleCards,
    strangle: strangleCards,
    vertical: verticalCards,
    butterfly: butterflyCards,
    condor: condorCards,
    collar: collarCards,
    "iron-butterfly": ironButterflyCards,
    "iron-condor": ironCondorCards,
    calendar: calendarCards,
    diagonal: diagonalCards,
    ratio: ratioCards,
  };

  const selectedDefinition = STRATEGY_LIBRARY.find((item) => item.key === selectedFamily) ?? STRATEGY_LIBRARY[0];
  const selectedCards = strategyCardsByFamily[selectedDefinition.key];

  return (
    <div className="grid gap-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Symbol" value={activeDisplayedChain?.symbol ?? chainSymbol} />
        <MetricCard label="Expiry" value={activeExpiry ?? "Load chain"} />
        <MetricCard label="Spot" value={fmtCurrencySmall(spotPrice)} />
        <MetricCard label="Families" value={fmtWholeNumber(STRATEGY_LIBRARY.length)} />
        <MetricCard label="Rows" value={fmtWholeNumber(displayedChainRows.length)} />
      </div>

      <Panel eyebrow="Strategy Families" title="Options Strategy Families">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {STRATEGY_LIBRARY.map((family) => {
            const isSelected = family.key === selectedDefinition.key;
            return (
              <button
                key={family.key}
                className={`rounded-2xl border px-4 py-4 text-left transition ${
                  isSelected
                    ? "border-accent/45 bg-accent/10 text-text"
                    : "border-line/80 bg-panelSoft text-muted hover:border-accent/25 hover:text-text"
                }`}
                onClick={() => setSelectedFamily(family.key)}
                type="button"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <StrategyGlyph family={family.key} />
                    <div className="font-medium">{family.label}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel eyebrow="Selected Strategy" title={selectedDefinition.heading}>
        <div className="rounded-2xl border border-line/80 bg-panelSoft px-5 py-5">
          <div className="flex items-center gap-3">
            <StrategyGlyph family={selectedDefinition.key} />
          </div>
          <div className="mt-4 text-sm leading-7 text-muted">{selectedDefinition.explanation}</div>
        </div>
      </Panel>

      <Panel eyebrow="Builder Candidates" title={`${selectedDefinition.label} Templates`}>
        <div className="grid gap-4 lg:grid-cols-2">
          {selectedCards.map((card) => (
            <div key={card.title} className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium text-text">{card.title}</div>
                  <div className="mt-2 text-sm text-muted">{card.detail}</div>
                  {card.disabledReason ? <div className="mt-2 text-xs text-muted">{card.disabledReason}</div> : null}
                </div>
                <div className="shrink-0 rounded-full border border-line/80 bg-panel px-3 py-1 text-xs text-muted">{card.metric}</div>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  className="rounded-full border border-accent/25 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:border-accent/45 hover:bg-accent/16 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!card.structure}
                  onClick={() => {
                    if (card.structure) {
                      onStageStructure(card.structure);
                    }
                  }}
                  type="button"
                >
                  Stage trade
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
