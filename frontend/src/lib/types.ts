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

export interface PositionsResponse {
  positions: Position[];
  generatedAt: string;
  isStale: boolean;
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

export interface TickerOverviewResponse {
  symbol: string;
  quote: UnderlyingQuote;
  marketCap: number | null;
  marketCapChangePct: number | null;
  revenueTtm: number | null;
  revenueTtmChangePct: number | null;
  netIncomeTtm: number | null;
  netIncomeTtmChangePct: number | null;
  epsTtm: number | null;
  epsTtmChangePct: number | null;
  sharesOutstanding: number | null;
  peRatio: number | null;
  forwardPeRatio: number | null;
  dividendAmount: number | null;
  dividendYieldPct: number | null;
  exDividendDate: string | null;
  volume: number | null;
  open: number | null;
  previousClose: number | null;
  dayRangeLow: number | null;
  dayRangeHigh: number | null;
  week52Low: number | null;
  week52High: number | null;
  beta: number | null;
  analystRating: string | null;
  priceTarget: number | null;
  priceTargetUpsidePct: number | null;
  earningsDate: string | null;
  sourceNotice: string | null;
  generatedAt: string;
  isStale: boolean;
}

export interface FundamentalReportStatus {
  reportType: string;
  available: boolean;
  message: string | null;
}

export interface FinancialPeriodColumn {
  label: string;
  periodEnding: string | null;
  fiscalPeriod: string | null;
}

export interface FinancialMetricRow {
  label: string;
  values: Array<number | string | null>;
}

export interface FinancialStatementTable {
  statementType: "income_statement" | "balance_sheet" | "cash_flow" | "ratios" | "estimates" | "summary";
  periodType: "annual" | "quarterly" | "ttm" | "current" | "unknown";
  title: string;
  currency: string | null;
  unit: string | null;
  columns: FinancialPeriodColumn[];
  rows: FinancialMetricRow[];
}

export interface TickerFinancialsResponse {
  symbol: string;
  reports: FundamentalReportStatus[];
  statements: FinancialStatementTable[];
  ratios: FinancialStatementTable[];
  estimates: FinancialStatementTable[];
  sourceNotices: string[];
  generatedAt: string;
  isStale: boolean;
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

export type OptionStrategyPermissionStatus = "permitted" | "blocked" | "unknown";

export interface OptionStrategyPermission {
  strategyKey: string;
  label: string;
  status: OptionStrategyPermissionStatus;
  permitted: boolean | null;
  detail: string | null;
}

export interface OptionStrategyPermissionsResponse {
  accountId: string;
  symbol: string;
  expiry: string;
  permissions: OptionStrategyPermission[];
  source: string;
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

export interface OptionIntentProfile {
  primaryIntent:
    | "income"
    | "accumulate_shares"
    | "exit_position"
    | "hedge"
    | "speculate_directionally"
    | "volatility_trade"
    | "repair_trade";
  secondaryIntent:
    | "income"
    | "accumulate_shares"
    | "exit_position"
    | "hedge"
    | "speculate_directionally"
    | "volatility_trade"
    | "repair_trade"
    | null;
  strategyFamily: "wheel" | "covered_call" | "cash_secured_put" | "spread" | "hybrid" | "custom";
  underlyingConviction: "low" | "medium" | "high";
  willingToBeAssigned: boolean;
  willingToSellShares: boolean;
  wouldRegretAssignment: boolean;
  desiredExitPrice: number | null;
  comfortableEntryPrice: number | null;
  maxPctSharesToCap: number;
  maxContractsPerUnderlying: number;
  minAcceptableReturnOnRisk: number;
  maxAcceptableDeltaForIncomeCalls: number;
  maxAcceptableDeltaForIncomePuts: number;
  avoidEarningsShortOptions: boolean;
  riskProfile: "conservative" | "medium" | "medium_aggressive" | "aggressive";
}

export interface OptionIntelligenceRequest {
  accountId: string | null;
  symbol: string;
  expiry: string;
  strike: number;
  right: "C" | "P";
  action: "BUY" | "SELL";
  quantity: number;
  entryPrice: number | null;
  intent: OptionIntentProfile;
}

export interface OptionStateVector {
  underlying: string;
  underlyingPrice: number;
  positionType: "short_call" | "short_put" | "long_call" | "long_put";
  strategyLabel: string;
  contracts: number;
  sharesControlled: number;
  sharesOwned: number;
  coveredStatus: "covered" | "partially-covered" | "uncovered" | "n/a";
  strike: number;
  expiration: string;
  dte: number;
  dteBucket: string;
  optionMidPrice: number | null;
  entryPrice: number | null;
  premiumCollected: number | null;
  markToMarketPnl: number | null;
  effectiveExitPrice: number | null;
  effectiveEntryPrice: number | null;
  moneyness: string;
  intrinsicValue: number;
  extrinsicValue: number | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  bidAskSpreadPct: number | null;
  spreadPctOfMid: number | null;
  openInterest: number | null;
  volume: number | null;
  liquidityScore: number;
  executionQualityWarning: boolean;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
  positionDelta: number | null;
  positionGamma: number | null;
  positionTheta: number | null;
  positionVega: number | null;
  netDeltaAfterShares: number | null;
  netGammaAfterPosition: number | null;
  netThetaAfterPosition: number | null;
  netVegaAfterPosition: number | null;
  strikeDistanceAbs: number;
  strikeDistancePct: number;
  moneynessBucket: string;
  probabilityItmEstimate: number | null;
  probabilityOtmEstimate: number | null;
  iv: number | null;
  ivRank: number | null;
  ivPercentile: number | null;
  realizedVol20d: number | null;
  realizedVol60d: number | null;
  ivVsRvSpread: number | null;
  ivTrend5d: string | null;
  ivTrend20d: string | null;
  termStructure: string | null;
  skewType: string | null;
  callPutIvSkew: number | null;
  thetaEfficiency: number | null;
  gammaRiskBucket: string;
  earningsBeforeExpiration: boolean;
  knownEventBeforeExpiration: boolean;
  eventType: string | null;
  portfolioValue: number | null;
  underlyingPositionValue: number | null;
  underlyingPctOfPortfolio: number | null;
  contractsShortTotalSameUnderlying: number;
  sharesAtRiskTotal: number;
  sharesOwnedTotal: number;
  pctSharesCapped: number;
  cashRequiredIfPutsAssigned: number;
  availableCash: number | null;
  marginRequired: number | null;
  assignmentCashImpact: number;
  priceTrend5d: string | null;
  priceTrend20d: string | null;
  priceTrend60d: string | null;
  recentDrawdownPct: number | null;
  distanceFrom20dHighPct: number | null;
  distanceFrom60dHighPct: number | null;
  above20dMovingAverage: boolean | null;
  above50dMovingAverage: boolean | null;
  above200dMovingAverage: boolean | null;
  regimeGuess: string | null;
  regimeConfidence: number | null;
  analysisConfidence: "low" | "medium" | "high";
  missingFields: string[];
}

export interface OptionIntelligenceRule {
  id: string;
  severity: "info" | "caution" | "warning" | "critical" | "block";
  category: string;
  message: string;
  plainEnglish: string;
  suggestedActions: string[];
}

export interface OptionIntelligenceScorecard {
  intentAlignmentScore: number;
  deltaScore: number;
  gammaScore: number;
  ivScore: number;
  regimeScore: number;
  liquidityScore: number;
  sizingScore: number;
  assignmentScore: number;
  overallScore: number;
  band: string;
}

export interface OptionIntelligenceScenarioRow {
  label: string;
  underlyingPrice: number | null;
  result: string;
}

export interface OptionIntelligenceResponse {
  stateVector: OptionStateVector;
  intent: OptionIntentProfile;
  scorecard: OptionIntelligenceScorecard;
  rules: OptionIntelligenceRule[];
  summary: string;
  topWarnings: string[];
  badges: string[];
  whatYouAreBetting: string;
  whatCanGoWrong: string;
  whatGoesRight: string;
  suggestedAdjustments: string[];
  scenarioTable: OptionIntelligenceScenarioRow[];
  generatedAt: string;
  isStale: boolean;
}

export interface UniverseCandidate {
  symbol: string;
  asOfDate: string;
  lastClose: number | null;
  priceReturn20d: number | null;
  priceReturn60d: number | null;
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
  sector: string | null;
  industry: string | null;
  themeCluster: string | null;
  marketCap: number | null;
  tradabilityBalance: number | null;
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
  strategyTag?: string | null;
  structureLabel?: string | null;
  legs?: OptionOrderLegRequest[];
  orderRef?: string | null;
}

export interface OptionOrderLegRequest {
  expiry: string;
  strike: number;
  right: "C" | "P";
  action: "BUY" | "SELL";
  ratio: number;
}

export interface OptionOrderLegPreview {
  expiry: string;
  strike: number;
  right: "C" | "P";
  action: "BUY" | "SELL";
  ratio: number;
  marketReferencePrice: number | null;
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
  strategyTag: string | null;
  structureLabel: string | null;
  legs: OptionOrderLegPreview[];
  marketReferencePrice: number | null;
  estimatedGrossPremium: number | null;
  conservativeCashImpact: number | null;
  brokerInitialMarginChange: number | null;
  brokerMaintenanceMarginChange: number | null;
  commissionEstimate: number | null;
  maxProfit: number | null;
  maxLoss: number | null;
  warningText: string | null;
  note: string | null;
  generatedAt: string;
}

export interface StockOrderRequest {
  accountId: string;
  symbol: string;
  action: "BUY" | "SELL";
  quantity: number;
  orderType: "LMT" | "MKT";
  limitPrice: number | null;
  tif: "DAY" | "GTC";
  orderRef?: string | null;
}

export interface StockOrderPreview {
  accountId: string;
  symbol: string;
  action: "BUY" | "SELL";
  quantity: number;
  orderType: "LMT" | "MKT";
  limitPrice: number | null;
  tif: "DAY" | "GTC";
  orderRef: string;
  openingOrClosing: "opening" | "closing" | "unknown";
  marketReferencePrice: number | null;
  estimatedGrossTradeValue: number | null;
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
  structureLabel: string | null;
  legCount: number;
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

export interface FinnhubSourceStatus {
  available: boolean;
  configured: boolean;
  status: "ready" | "degraded";
  apiBaseUrl: string;
  detail: string;
  maskedApiKey: string | null;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
}

export interface FinnhubConnectorConfigRequest {
  apiKey: string | null;
}

export interface OkxSourceStatus {
  available: boolean;
  status: "ready" | "degraded";
  authMode: "public";
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
  totalPnl: number | null;
  todayPnl: number | null;
  monthlyPnl: number | null;
  todayPnlPctBasis: number | null;
  monthlyPnlPctBasis: number | null;
  netContributions: number | null;
  visibleHoldingsCount: number;
  totalAccountsCount: number;
  holdings: CoinbaseHolding[];
  sourceNotice: string | null;
  generatedAt: string;
  isStale: boolean;
}

export interface FilesystemConnectorStatus {
  sourceId: string;
  connectorId: string;
  available: boolean;
  connected: boolean;
  status: "ready" | "degraded" | "not_connected";
  detail: string;
  displayName: string | null;
  directoryPath: string | null;
  positionsDirectoryPath: string | null;
  historyCsvPath: string | null;
  detectFooter: boolean;
  csvFilesCount: number;
  latestCsvPath: string | null;
  lastSuccessfulSyncAt: string | null;
  lastError: string | null;
}

export interface FilesystemConnectorConfigRequest {
  displayName: string;
  directoryPath: string | null;
  positionsDirectoryPath: string | null;
  historyCsvPath: string | null;
  detectFooter: boolean;
}

export interface FilesystemInvestmentAccount {
  accountId: string;
  name: string;
  currentBalance: number | null;
  isoCurrencyCode: string | null;
}

export interface FilesystemHolding {
  accountId: string;
  accountName: string;
  symbol: string | null;
  name: string;
  quantity: number | null;
  price: number | null;
  value: number | null;
  costBasis: number | null;
  gainLoss: number | null;
  isoCurrencyCode: string | null;
  sourceFile: string | null;
}

export interface FilesystemConnectorPortfolioResponse {
  sourceId: string;
  connectorId: string;
  displayName: string | null;
  directoryPath: string;
  latestCsvPath: string | null;
  historyCsvPath: string | null;
  totalValue: number;
  totalPnl: number | null;
  todayPnl: number | null;
  monthlyPnl: number | null;
  todayPnlPctBasis: number | null;
  monthlyPnlPctBasis: number | null;
  netContributions: number | null;
  investmentAccountsCount: number;
  holdingsCount: number;
  accounts: FilesystemInvestmentAccount[];
  holdings: FilesystemHolding[];
  sourceNotice: string | null;
  generatedAt: string;
  isStale: boolean;
}

export interface FilesystemDocumentFile {
  name: string;
  path: string;
  modifiedAt: string;
  sizeBytes: number;
}

export interface FilesystemDocumentFolderResponse {
  sourceId: string;
  connectorId: string;
  displayName: string | null;
  directoryPath: string;
  latestPdfPath: string | null;
  pdfFilesCount: number;
  files: FilesystemDocumentFile[];
  sourceNotice: string | null;
  generatedAt: string;
  isStale: boolean;
}

export interface CryptoMarketQuote {
  symbol: string;
  name: string;
  priceUsd: number;
}

export interface CryptoMarketResponse {
  source: string;
  quotes: CryptoMarketQuote[];
  generatedAt: string;
  sourceNotice: string | null;
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
  skippedFiles: number;
  failedFiles: number;
  downloadMode: "primary-document" | "all-attachments" | "metadata-only" | "full-filing-bundle";
  includeExhibits: boolean;
  resume: boolean;
  researchRootPath: string;
  stockPath: string;
  filingsPath: string;
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
  browserProvider: string;
  browserRenderingEnabled: boolean;
  browserTimeoutSeconds?: number | null;
}

export interface InvestorPdfDownloadRequest {
  ticker?: string;
  companyName?: string;
  cik?: string;
  lookbackYears?: number;
  startDate?: string;
  endDate?: string;
  outputDir?: string;
  seedUrl?: string;
  includeAnnualReports?: boolean;
  includeEarningsDecks?: boolean;
  includeInvestorPresentations?: boolean;
  includeCompanyReports?: boolean;
  includeSecExhibits?: boolean;
  resume?: boolean;
  forceRefresh?: boolean;
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
  cacheHit: boolean;
  cacheExpiresAt?: string | null;
  cacheMessage?: string | null;
}
