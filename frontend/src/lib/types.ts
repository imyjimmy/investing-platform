export type RiskLevel = "Low" | "Moderate" | "Elevated" | "High";

export interface ConnectionStatus {
  mode: "mock" | "ibkr";
  connected: boolean;
  status: "connected" | "disconnected" | "degraded";
  executionMode: "disabled" | "enabled";
  routedAccountType: "live" | "paper" | "unknown";
  host: string;
  port: number;
  clientId: number;
  accountId: string | null;
  managedAccounts: string[];
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
  status: string;
  symbol: string;
  secType: string;
  orderType: string;
  side: string;
  quantity: number;
  filledQuantity: number;
  remainingQuantity: number | null;
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
  callVolume: number | null;
  callOpenInterest: number | null;
  callIV: number | null;
  callDelta: number | null;
  callGamma: number | null;
  callTheta: number | null;
  callVega: number | null;
  callRho: number | null;
  callAnnualizedYieldPct: number | null;
  putBid: number | null;
  putAsk: number | null;
  putMid: number | null;
  putVolume: number | null;
  putOpenInterest: number | null;
  putIV: number | null;
  putDelta: number | null;
  putGamma: number | null;
  putTheta: number | null;
  putVega: number | null;
  putRho: number | null;
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

export interface UniverseCandidate {
  symbol: string;
  asOfDate: string;
  lastClose: number | null;
  betaQqq60d: number | null;
  betaQqq120d: number | null;
  betaSpy120d: number | null;
  hv20: number | null;
  hv60: number | null;
  atmFrontMonthIv: number | null;
  atm3045dIv: number | null;
  ivToHv20: number | null;
  avgDailyDollarVolume20d: number | null;
  totalOptionVolume: number | null;
  totalOptionOpenInterest: number | null;
  compositeScore: number | null;
  betaComponent: number | null;
  impliedVolComponent: number | null;
  recommendedStrategy: string | null;
  whyItRanked: string | null;
  eligible: boolean;
}

export interface UniverseSnapshotResponse {
  snapshotDate: string;
  rows: UniverseCandidate[];
  sourceNotice: string | null;
  generatedAt: string;
  isStale: boolean;
}

export interface OptionOrderRequest {
  accountId: string;
  symbol: string;
  expiry: string;
  strike: number;
  right: "C" | "P";
  action: "BUY" | "SELL";
  quantity: number;
  orderType: "LMT" | "MKT";
  limitPrice: number | null;
  tif: "DAY" | "GTC";
  orderRef?: string | null;
}

export interface OptionOrderPreview {
  accountId: string;
  symbol: string;
  expiry: string;
  strike: number;
  right: "C" | "P";
  action: "BUY" | "SELL";
  quantity: number;
  orderType: "LMT" | "MKT";
  limitPrice: number | null;
  tif: "DAY" | "GTC";
  orderRef: string;
  openingOrClosing: "opening" | "closing" | "unknown";
  marketReferencePrice: number | null;
  estimatedGrossPremium: number | null;
  conservativeCashImpact: number | null;
  brokerInitialMarginChange: number | null;
  brokerMaintenanceMarginChange: number | null;
  commissionEstimate: number | null;
  warningText: string | null;
  note: string | null;
  generatedAt: string;
}

export interface SubmittedOrder {
  orderId: number;
  permId: number | null;
  clientId: number | null;
  status: string;
  filledQuantity: number;
  remainingQuantity: number;
  message: string | null;
  submittedAt: string;
}

export interface OrderCancelResponse {
  orderId: number;
  accountId: string;
  status: string;
  message: string | null;
  cancelledAt: string;
}

export interface CoinbaseSourceStatus {
  available: boolean;
  status: "ready" | "degraded";
  authMode: "jwt" | "bearer" | "missing" | "unsupported";
  apiBaseUrl: string;
  detail: string;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
}

export interface CoinbaseHolding {
  accountId: string;
  accountName: string;
  accountType: string;
  primary: boolean;
  ready: boolean | null;
  currencyCode: string;
  currencyName: string | null;
  currencyType: string | null;
  balance: number;
  availableBalance: number | null;
  holdBalance: number | null;
  usdRate: number | null;
  usdValue: number | null;
  allocationPct: number | null;
  isCashLike: boolean;
  updatedAt: string | null;
}

export interface CoinbasePortfolioResponse {
  totalUsdValue: number;
  cryptoUsdValue: number;
  cashLikeUsdValue: number;
  visibleHoldingsCount: number;
  totalAccountsCount: number;
  holdings: CoinbaseHolding[];
  sourceNotice: string | null;
  generatedAt: string;
  isStale: boolean;
}

export interface EdgarSourceStatus {
  available: boolean;
  status: "ready" | "degraded";
  researchRootPath: string;
  stocksRootPath: string;
  edgarUserAgent: string;
  maxRequestsPerSecond: number;
  timeoutSeconds: number;
}

export interface EdgarDownloadRequest {
  ticker?: string;
  companyName?: string;
  cik?: string;
  formTypes?: string[];
  startDate?: string;
  endDate?: string;
  downloadMode?: "primary-document" | "all-attachments" | "metadata-only" | "full-filing-bundle";
  pdfLayout?: "nested" | "by-filing" | "both";
  pdfFolderFormat?: string;
  outputDir?: string;
  includeExhibits?: boolean;
  resume?: boolean;
  maxRequestsPerSecond?: number;
  userAgent?: string;
}

export interface EdgarDownloadResponse {
  companyName: string;
  ticker: string;
  cik: string;
  totalFilingsConsidered: number;
  matchedFilings: number;
  metadataFilesSynced: number;
  downloadedFiles: number;
  generatedPdfs: number;
  skippedFiles: number;
  failedFiles: number;
  downloadMode: "primary-document" | "all-attachments" | "metadata-only" | "full-filing-bundle";
  pdfLayout: "nested" | "by-filing" | "both";
  pdfFolderFormat?: string | null;
  includeExhibits: boolean;
  resume: boolean;
  researchRootPath: string;
  stockPath: string;
  filingsPath: string;
  pdfsPath: string;
  edgarPath: string;
  exportsJsonPath: string;
  exportsCsvPath: string;
  manifestPath: string;
  syncedAt: string;
}

export interface InvestorPdfSourceStatus {
  available: boolean;
  status: "ready" | "degraded";
  researchRootPath: string;
  stocksRootPath: string;
  pdfFolderName: string;
  timeoutSeconds: number;
}

export interface InvestorPdfDownloadRequest {
  ticker?: string;
  companyName?: string;
  cik?: string;
  lookbackYears?: number;
  startDate?: string;
  endDate?: string;
  outputDir?: string;
  includeAnnualReports?: boolean;
  includeEarningsDecks?: boolean;
  includeInvestorPresentations?: boolean;
  includeCompanyReports?: boolean;
  includeSecExhibits?: boolean;
  resume?: boolean;
  maxRequestsPerSecond?: number;
  userAgent?: string;
}

export interface InvestorPdfArtifact {
  title: string;
  category: "annual-report" | "earnings-deck" | "investor-presentation" | "company-report" | "sec-exhibit";
  sourceLabel: string;
  sourceUrl: string;
  host: string;
  publishedAt?: string | null;
  year?: number | null;
  savedPath?: string | null;
}

export interface InvestorPdfDownloadResponse {
  companyName: string;
  ticker: string;
  cik: string;
  lookbackYears: number;
  startDate?: string | null;
  endDate?: string | null;
  discoveredCandidates: number;
  matchedPdfs: number;
  downloadedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  resume: boolean;
  researchRootPath: string;
  stockPath: string;
  pdfsPath: string;
  workspacePath: string;
  exportsJsonPath: string;
  exportsCsvPath: string;
  manifestPath: string;
  artifacts: InvestorPdfArtifact[];
  syncedAt: string;
}
