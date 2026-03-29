export type RiskLevel = "Low" | "Moderate" | "Elevated" | "High";

export interface ConnectionStatus {
  mode: "mock" | "ibkr";
  connected: boolean;
  status: "connected" | "disconnected" | "degraded";
  host: string;
  port: number;
  clientId: number;
  accountId: string | null;
  marketDataType: number;
  marketDataMode: string;
  usingMockData: boolean;
  lastSuccessfulConnectAt: string | null;
  lastHeartbeatAt: string | null;
  nextReconnectAttemptAt: string | null;
  lastError: string | null;
}

export interface AccountSnapshot {
  accountId: string | null;
  netLiquidation: number;
  availableFunds: number;
  excessLiquidity: number;
  buyingPower: number;
  initMarginReq: number;
  maintMarginReq: number;
  cashBalance: number | null;
  marginUsagePct: number;
  optionPositionsCount: number;
  openOrdersCount: number;
  estimatedPremiumExpiringThisWeek: number;
  estimatedCommittedCapital: number;
  estimatedFreeOptionSellingCapacity: number;
  generatedAt: string;
  isStale: boolean;
}

export interface Position {
  symbol: string;
  secType: string;
  quantity: number;
  avgCost: number;
  marketPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  realizedPnL: number | null;
}

export interface OptionPosition {
  symbol: string;
  expiry: string;
  strike: number;
  right: "C" | "P";
  quantity: number;
  shortOrLong: "short" | "long";
  avgCost: number;
  currentMid: number | null;
  bid: number | null;
  ask: number | null;
  marketPrice: number | null;
  marketValue: number | null;
  unrealizedPnL: number | null;
  realizedPnL: number | null;
  delta: number | null;
  theta: number | null;
  impliedVol: number | null;
  dte: number;
  underlyingSpot: number | null;
  moneynessPct: number | null;
  distanceToStrikePct: number | null;
  collateralEstimate: number;
  assignmentRiskLevel: RiskLevel;
  coveredStatus: "covered" | "partially-covered" | "uncovered" | "n/a";
  coveredContracts: number;
  strategyTag: string;
  premiumEstimate: number;
  marketDataStatus: string;
}

export interface OpenOrderExposure {
  orderId: number;
  symbol: string;
  secType: string;
  orderType: string;
  side: string;
  quantity: number;
  limitPrice: number | null;
  estimatedCapitalImpact: number;
  estimatedCredit: number;
  openingOrClosing: "opening" | "closing" | "unknown";
  expiry: string | null;
  strike: number | null;
  right: "C" | "P" | null;
  strategyTag: string;
  note: string | null;
}

export interface AlertItem {
  level: "info" | "warning" | "critical";
  title: string;
  detail: string;
  symbol: string | null;
}

export interface TickerExposureRow {
  symbol: string;
  stockMarketValue: number;
  netStockShares: number;
  shortPutContracts: number;
  coveredCallContracts: number;
  netOptionContracts: number;
  shortPutCollateral: number;
  openOrderCapital: number;
  premiumExpiringThisWeek: number;
  assignmentExposure: number;
  concentrationPct: number;
  riskLevel: RiskLevel;
}

export interface ExpiryExposureRow {
  expiry: string;
  weekLabel: string;
  positionsCount: number;
  shortPutCollateral: number;
  coveredCallContracts: number;
  premiumExpiringThisWeek: number;
  assignmentRiskContracts: number;
}

export interface CollateralSummary {
  conservativeCashSecuredPutEstimate: number;
  brokerReportedMarginImpact: number | null;
  openOrderCommittedCapital: number;
  safetyBuffer: number;
  availableFunds: number;
  excessLiquidity: number;
  estimatedFreeOptionSellingCapacity: number;
  generatedAt: string;
}

export interface PremiumSummary {
  estimatedPremiumExpiringThisWeek: number;
  coveredCallPremiumThisWeek: number;
  putPremiumThisWeek: number;
  estimatedOpenShortOptionPremium: number;
  methodology: string;
  generatedAt: string;
}

export interface RiskSummaryResponse {
  account: AccountSnapshot;
  collateral: CollateralSummary;
  premium: PremiumSummary;
  exposureByTicker: TickerExposureRow[];
  exposureByExpiry: ExpiryExposureRow[];
  positionsClosestToMoney: OptionPosition[];
  alerts: AlertItem[];
  watchlist: string[];
  generatedAt: string;
  isStale: boolean;
}

export interface UnderlyingQuote {
  symbol: string;
  price: number;
  bid: number | null;
  ask: number | null;
  last: number | null;
  close: number | null;
  marketDataStatus: string;
  generatedAt: string;
}

export interface ChainRow {
  strike: number;
  distanceFromSpotPct: number;
  callBid: number | null;
  callAsk: number | null;
  callMid: number | null;
  callIV: number | null;
  callDelta: number | null;
  callTheta: number | null;
  callAnnualizedYieldPct: number | null;
  putBid: number | null;
  putAsk: number | null;
  putMid: number | null;
  putIV: number | null;
  putDelta: number | null;
  putTheta: number | null;
  putAnnualizedYieldPct: number | null;
  conservativePutCollateral: number | null;
}

export interface ChainHighlight {
  label: string;
  right: "C" | "P";
  strike: number;
  expiry: string;
  metricLabel: string;
  metricValue: number;
  description: string;
}

export interface OptionChainResponse {
  symbol: string;
  selectedExpiry: string;
  expiries: string[];
  underlying: UnderlyingQuote;
  rows: ChainRow[];
  highlights: ChainHighlight[];
  quoteSource: "streaming" | "historical" | "unavailable";
  quoteAsOf: string | null;
  quoteNotice: string | null;
  generatedAt: string;
  isStale: boolean;
}

export interface OpenOrdersResponse {
  orders: OpenOrderExposure[];
  totalCommittedCapital: number;
  putSellingCapital: number;
  stockOrderCapital: number;
  generatedAt: string;
  isStale: boolean;
}

export interface OptionPositionsResponse {
  positions: OptionPosition[];
  generatedAt: string;
  isStale: boolean;
}

export interface ScenarioTickerImpact {
  symbol: string;
  currentPrice: number;
  projectedPrice: number;
  stockPnL: number;
  optionIntrinsicPnL: number;
  totalApproxPnL: number;
  assignedPutNotional: number;
  callAwayNotional: number;
  note: string;
}

export interface ScenarioResponse {
  movePct: number;
  daysForward: number;
  ivShockPct: number;
  totalApproxPnL: number;
  totalAssignedPutNotional: number;
  totalCallAwayNotional: number;
  impacts: ScenarioTickerImpact[];
  methodology: string;
  generatedAt: string;
  isStale: boolean;
}
