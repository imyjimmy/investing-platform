"""Pydantic models shared across the API layer."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class DashboardModel(BaseModel):
    """Base model with camel-friendly serialization support."""

    model_config = ConfigDict(populate_by_name=True)


RiskLevel = Literal["Low", "Moderate", "Elevated", "High"]
OptionAnalysisSeverity = Literal["info", "caution", "warning", "critical", "block"]
OptionAnalysisConfidence = Literal["low", "medium", "high"]
OptionPrimaryIntent = Literal[
    "income",
    "accumulate_shares",
    "exit_position",
    "hedge",
    "speculate_directionally",
    "volatility_trade",
    "repair_trade",
]
OptionStrategyFamily = Literal["wheel", "covered_call", "cash_secured_put", "spread", "hybrid", "custom"]
UnderlyingConviction = Literal["low", "medium", "high"]
IntentRiskProfile = Literal["conservative", "medium", "medium_aggressive", "aggressive"]
OptionPositionType = Literal["short_call", "short_put", "long_call", "long_put"]
StrategyTag = Literal[
    "covered-call",
    "cash-secured-put",
    "call-credit-spread",
    "call-debit-spread",
    "put-credit-spread",
    "put-debit-spread",
    "short-option",
    "long-option",
    "stock",
    "other",
]
QuoteSource = Literal["streaming", "historical", "unavailable"]
ExecutionMode = Literal["disabled", "enabled"]
RouteKind = Literal["live", "paper", "unknown"]
OrderAction = Literal["BUY", "SELL"]
OrderType = Literal["LMT", "MKT"]
TimeInForce = Literal["DAY", "GTC"]
EdgarDownloadMode = Literal["primary-document", "all-attachments", "metadata-only", "full-filing-bundle"]
EdgarPdfLayout = Literal["nested", "by-filing", "both"]
InvestorPdfCategory = Literal["annual-report", "earnings-deck", "investor-presentation", "company-report", "sec-exhibit"]
FinancialStatementType = Literal["income_statement", "balance_sheet", "cash_flow", "ratios", "estimates", "summary"]
FinancialPeriodType = Literal["annual", "quarterly", "ttm", "current", "unknown"]


class ConnectionStatus(DashboardModel):
    mode: Literal["mock", "ibkr"]
    connected: bool
    status: Literal["connected", "disconnected", "degraded"]
    executionMode: ExecutionMode = "disabled"
    routedAccountType: RouteKind = "unknown"
    host: str
    port: int
    clientId: int
    accountId: str | None = None
    managedAccounts: list[str] = Field(default_factory=list)
    marketDataType: int
    marketDataMode: str
    usingMockData: bool
    lastSuccessfulConnectAt: datetime | None = None
    lastHeartbeatAt: datetime | None = None
    nextReconnectAttemptAt: datetime | None = None
    lastError: str | None = None


class HealthResponse(DashboardModel):
    ok: bool
    service: str
    version: str
    timestamp: datetime
    connection: ConnectionStatus


class AlertItem(DashboardModel):
    level: Literal["info", "warning", "critical"]
    title: str
    detail: str
    symbol: str | None = None


class AccountSnapshot(DashboardModel):
    accountId: str | None = None
    netLiquidation: float
    availableFunds: float
    excessLiquidity: float
    buyingPower: float
    initMarginReq: float
    maintMarginReq: float
    cashBalance: float | None = None
    marginUsagePct: float
    optionPositionsCount: int
    openOrdersCount: int
    estimatedPremiumExpiringThisWeek: float
    estimatedCommittedCapital: float
    estimatedFreeOptionSellingCapacity: float
    generatedAt: datetime
    isStale: bool = False


class Position(DashboardModel):
    symbol: str
    secType: str
    conId: int | None = None
    quantity: float
    avgCost: float
    marketPrice: float
    marketValue: float
    unrealizedPnL: float
    realizedPnL: float | None = None
    currency: str = "USD"


class OptionPosition(DashboardModel):
    symbol: str
    secType: str = "OPT"
    conId: int | None = None
    underlyingConId: int | None = None
    expiry: str
    strike: float
    right: Literal["C", "P"]
    multiplier: int = 100
    quantity: int
    shortOrLong: Literal["short", "long"]
    avgCost: float
    currentMid: float | None = None
    bid: float | None = None
    ask: float | None = None
    marketPrice: float | None = None
    marketValue: float | None = None
    unrealizedPnL: float | None = None
    realizedPnL: float | None = None
    delta: float | None = None
    gamma: float | None = None
    theta: float | None = None
    vega: float | None = None
    impliedVol: float | None = None
    dte: int
    underlyingSpot: float | None = None
    moneynessPct: float | None = None
    distanceToStrikePct: float | None = None
    collateralEstimate: float = 0.0
    brokerMarginImpact: float | None = None
    assignmentRiskLevel: RiskLevel
    coveredStatus: Literal["covered", "partially-covered", "uncovered", "n/a"] = "n/a"
    coveredContracts: int = 0
    strategyTag: StrategyTag = "other"
    premiumEstimate: float = 0.0
    marketDataStatus: str = "UNKNOWN"


class OpenOrderExposure(DashboardModel):
    orderId: int
    status: str = "Submitted"
    symbol: str
    secType: str
    orderType: str
    side: str
    quantity: float
    filledQuantity: float = 0.0
    remainingQuantity: float | None = None
    limitPrice: float | None = None
    estimatedCapitalImpact: float
    estimatedCredit: float = 0.0
    openingOrClosing: Literal["opening", "closing", "unknown"]
    expiry: str | None = None
    strike: float | None = None
    right: Literal["C", "P"] | None = None
    strategyTag: StrategyTag = "other"
    note: str | None = None


class UnderlyingQuote(DashboardModel):
    symbol: str
    price: float
    bid: float | None = None
    ask: float | None = None
    last: float | None = None
    close: float | None = None
    currency: str = "USD"
    marketDataStatus: str = "UNKNOWN"
    generatedAt: datetime


class TickerOverviewResponse(DashboardModel):
    symbol: str
    quote: UnderlyingQuote
    marketCap: float | None = None
    marketCapChangePct: float | None = None
    revenueTtm: float | None = None
    revenueTtmChangePct: float | None = None
    netIncomeTtm: float | None = None
    netIncomeTtmChangePct: float | None = None
    epsTtm: float | None = None
    epsTtmChangePct: float | None = None
    sharesOutstanding: float | None = None
    peRatio: float | None = None
    forwardPeRatio: float | None = None
    dividendAmount: float | None = None
    dividendYieldPct: float | None = None
    exDividendDate: date | None = None
    volume: int | None = None
    open: float | None = None
    previousClose: float | None = None
    dayRangeLow: float | None = None
    dayRangeHigh: float | None = None
    week52Low: float | None = None
    week52High: float | None = None
    beta: float | None = None
    analystRating: str | None = None
    priceTarget: float | None = None
    priceTargetUpsidePct: float | None = None
    earningsDate: date | None = None
    sourceNotice: str | None = None
    generatedAt: datetime
    isStale: bool = False


class FundamentalReportStatus(DashboardModel):
    reportType: str
    available: bool
    message: str | None = None


class FinancialPeriodColumn(DashboardModel):
    label: str
    periodEnding: date | None = None
    fiscalPeriod: str | None = None


class FinancialMetricRow(DashboardModel):
    label: str
    values: list[float | str | None]


class FinancialStatementTable(DashboardModel):
    statementType: FinancialStatementType
    periodType: FinancialPeriodType = "unknown"
    title: str
    currency: str | None = None
    unit: str | None = None
    columns: list[FinancialPeriodColumn] = Field(default_factory=list)
    rows: list[FinancialMetricRow] = Field(default_factory=list)


class TickerFinancialsResponse(DashboardModel):
    symbol: str
    reports: list[FundamentalReportStatus] = Field(default_factory=list)
    statements: list[FinancialStatementTable] = Field(default_factory=list)
    ratios: list[FinancialStatementTable] = Field(default_factory=list)
    estimates: list[FinancialStatementTable] = Field(default_factory=list)
    sourceNotices: list[str] = Field(default_factory=list)
    generatedAt: datetime
    isStale: bool = False


class ChainRow(DashboardModel):
    strike: float
    distanceFromSpotPct: float
    callBid: float | None = None
    callAsk: float | None = None
    callMid: float | None = None
    callVolume: int | None = None
    callOpenInterest: int | None = None
    callIV: float | None = None
    callDelta: float | None = None
    callGamma: float | None = None
    callTheta: float | None = None
    callVega: float | None = None
    callRho: float | None = None
    callAnnualizedYieldPct: float | None = None
    putBid: float | None = None
    putAsk: float | None = None
    putMid: float | None = None
    putVolume: int | None = None
    putOpenInterest: int | None = None
    putIV: float | None = None
    putDelta: float | None = None
    putGamma: float | None = None
    putTheta: float | None = None
    putVega: float | None = None
    putRho: float | None = None
    putAnnualizedYieldPct: float | None = None
    conservativePutCollateral: float | None = None


class ChainHighlight(DashboardModel):
    label: str
    right: Literal["C", "P"]
    strike: float
    expiry: str
    metricLabel: str
    metricValue: float
    description: str


class OptionChainResponse(DashboardModel):
    symbol: str
    selectedExpiry: str
    expiries: list[str]
    underlying: UnderlyingQuote
    rows: list[ChainRow]
    highlights: list[ChainHighlight] = Field(default_factory=list)
    quoteSource: QuoteSource = "unavailable"
    quoteAsOf: datetime | None = None
    quoteNotice: str | None = None
    generatedAt: datetime
    isStale: bool = False


class PositionsResponse(DashboardModel):
    positions: list[Position]
    generatedAt: datetime
    isStale: bool = False


class OptionPositionsResponse(DashboardModel):
    positions: list[OptionPosition]
    generatedAt: datetime
    isStale: bool = False


class OpenOrdersResponse(DashboardModel):
    orders: list[OpenOrderExposure]
    totalCommittedCapital: float
    putSellingCapital: float
    stockOrderCapital: float
    generatedAt: datetime
    isStale: bool = False


class CollateralSummary(DashboardModel):
    conservativeCashSecuredPutEstimate: float
    brokerReportedMarginImpact: float | None = None
    openOrderCommittedCapital: float
    safetyBuffer: float
    availableFunds: float
    excessLiquidity: float
    estimatedFreeOptionSellingCapacity: float
    generatedAt: datetime


class PremiumSummary(DashboardModel):
    estimatedPremiumExpiringThisWeek: float
    coveredCallPremiumThisWeek: float
    putPremiumThisWeek: float
    estimatedOpenShortOptionPremium: float
    methodology: str
    generatedAt: datetime


class TickerExposureRow(DashboardModel):
    symbol: str
    stockMarketValue: float
    netStockShares: float
    shortPutContracts: int
    coveredCallContracts: int
    netOptionContracts: int
    shortPutCollateral: float
    openOrderCapital: float
    premiumExpiringThisWeek: float
    assignmentExposure: float
    concentrationPct: float
    riskLevel: RiskLevel


class ExpiryExposureRow(DashboardModel):
    expiry: str
    weekLabel: str
    positionsCount: int
    shortPutCollateral: float
    coveredCallContracts: int
    premiumExpiringThisWeek: float
    assignmentRiskContracts: int


class ExposureByTickerResponse(DashboardModel):
    rows: list[TickerExposureRow]
    generatedAt: datetime
    isStale: bool = False


class ExposureByExpiryResponse(DashboardModel):
    rows: list[ExpiryExposureRow]
    generatedAt: datetime
    isStale: bool = False


class RiskSummaryResponse(DashboardModel):
    account: AccountSnapshot
    collateral: CollateralSummary
    premium: PremiumSummary
    exposureByTicker: list[TickerExposureRow]
    exposureByExpiry: list[ExpiryExposureRow]
    positionsClosestToMoney: list[OptionPosition]
    alerts: list[AlertItem]
    watchlist: list[str]
    generatedAt: datetime
    isStale: bool = False


class ScenarioTickerImpact(DashboardModel):
    symbol: str
    currentPrice: float
    projectedPrice: float
    stockPnL: float
    optionIntrinsicPnL: float
    totalApproxPnL: float
    assignedPutNotional: float
    callAwayNotional: float
    note: str


class ScenarioResponse(DashboardModel):
    movePct: float
    daysForward: int
    ivShockPct: float
    totalApproxPnL: float
    totalAssignedPutNotional: float
    totalCallAwayNotional: float
    impacts: list[ScenarioTickerImpact]
    methodology: str
    generatedAt: datetime
    isStale: bool = False


class OptionIntentProfile(DashboardModel):
    primaryIntent: OptionPrimaryIntent = "income"
    secondaryIntent: OptionPrimaryIntent | None = None
    strategyFamily: OptionStrategyFamily = "custom"
    underlyingConviction: UnderlyingConviction = "medium"
    willingToBeAssigned: bool = True
    willingToSellShares: bool = True
    wouldRegretAssignment: bool = False
    desiredExitPrice: float | None = Field(default=None, ge=0.0)
    comfortableEntryPrice: float | None = Field(default=None, ge=0.0)
    maxPctSharesToCap: float = Field(default=0.30, ge=0.0, le=1.0)
    maxContractsPerUnderlying: int = Field(default=6, ge=1, le=100)
    minAcceptableReturnOnRisk: float = Field(default=0.02, ge=0.0, le=1.0)
    maxAcceptableDeltaForIncomeCalls: float = Field(default=0.25, ge=0.01, le=1.0)
    maxAcceptableDeltaForIncomePuts: float = Field(default=0.30, ge=0.01, le=1.0)
    avoidEarningsShortOptions: bool = True
    riskProfile: IntentRiskProfile = "medium_aggressive"


class OptionIntelligenceRequest(DashboardModel):
    accountId: str | None = None
    symbol: str
    expiry: str
    strike: float
    right: Literal["C", "P"]
    action: OrderAction = "SELL"
    quantity: int = Field(default=1, gt=0)
    entryPrice: float | None = Field(default=None, ge=0.0)
    intent: OptionIntentProfile = Field(default_factory=OptionIntentProfile)

    @field_validator("accountId")
    @classmethod
    def _normalize_account_id(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().upper()
        return normalized or None

    @field_validator("symbol")
    @classmethod
    def _normalize_symbol(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not normalized:
            raise ValueError("Symbol is required.")
        return normalized

    @field_validator("expiry")
    @classmethod
    def _normalize_expiry(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) == 8 and normalized.isdigit():
            return f"{normalized[:4]}-{normalized[4:6]}-{normalized[6:8]}"
        return normalized

    @field_validator("strike")
    @classmethod
    def _normalize_strike(cls, value: float) -> float:
        return round(float(value), 4)


class OptionStateVector(DashboardModel):
    underlying: str
    underlyingPrice: float
    positionType: OptionPositionType
    strategyLabel: str
    contracts: int
    sharesControlled: int
    sharesOwned: int
    coveredStatus: Literal["covered", "partially-covered", "uncovered", "n/a"] = "n/a"
    strike: float
    expiration: str
    dte: int
    dteBucket: str
    optionMidPrice: float | None = None
    entryPrice: float | None = None
    premiumCollected: float | None = None
    markToMarketPnl: float | None = None
    effectiveExitPrice: float | None = None
    effectiveEntryPrice: float | None = None
    moneyness: str
    intrinsicValue: float
    extrinsicValue: float | None = None
    bid: float | None = None
    ask: float | None = None
    mid: float | None = None
    bidAskSpreadPct: float | None = None
    spreadPctOfMid: float | None = None
    openInterest: int | None = None
    volume: int | None = None
    liquidityScore: int
    executionQualityWarning: bool = False
    delta: float | None = None
    gamma: float | None = None
    theta: float | None = None
    vega: float | None = None
    rho: float | None = None
    positionDelta: float | None = None
    positionGamma: float | None = None
    positionTheta: float | None = None
    positionVega: float | None = None
    netDeltaAfterShares: float | None = None
    netGammaAfterPosition: float | None = None
    netThetaAfterPosition: float | None = None
    netVegaAfterPosition: float | None = None
    strikeDistanceAbs: float
    strikeDistancePct: float
    moneynessBucket: str
    probabilityItmEstimate: float | None = None
    probabilityOtmEstimate: float | None = None
    iv: float | None = None
    ivRank: float | None = None
    ivPercentile: float | None = None
    realizedVol20d: float | None = None
    realizedVol60d: float | None = None
    ivVsRvSpread: float | None = None
    ivTrend5d: str | None = None
    ivTrend20d: str | None = None
    termStructure: str | None = None
    skewType: str | None = None
    callPutIvSkew: float | None = None
    thetaEfficiency: float | None = None
    gammaRiskBucket: str
    earningsBeforeExpiration: bool = False
    knownEventBeforeExpiration: bool = False
    eventType: str | None = None
    portfolioValue: float | None = None
    underlyingPositionValue: float | None = None
    underlyingPctOfPortfolio: float | None = None
    contractsShortTotalSameUnderlying: int = 0
    sharesAtRiskTotal: int = 0
    sharesOwnedTotal: int = 0
    pctSharesCapped: float = 0.0
    cashRequiredIfPutsAssigned: float = 0.0
    availableCash: float | None = None
    marginRequired: float | None = None
    assignmentCashImpact: float = 0.0
    priceTrend5d: str | None = None
    priceTrend20d: str | None = None
    priceTrend60d: str | None = None
    recentDrawdownPct: float | None = None
    distanceFrom20dHighPct: float | None = None
    distanceFrom60dHighPct: float | None = None
    above20dMovingAverage: bool | None = None
    above50dMovingAverage: bool | None = None
    above200dMovingAverage: bool | None = None
    regimeGuess: str | None = None
    regimeConfidence: float | None = None
    analysisConfidence: OptionAnalysisConfidence = "medium"
    missingFields: list[str] = Field(default_factory=list)


class OptionIntelligenceRule(DashboardModel):
    id: str
    severity: OptionAnalysisSeverity
    category: str
    message: str
    plainEnglish: str
    suggestedActions: list[str] = Field(default_factory=list)


class OptionIntelligenceScorecard(DashboardModel):
    intentAlignmentScore: int
    deltaScore: int
    gammaScore: int
    ivScore: int
    regimeScore: int
    liquidityScore: int
    sizingScore: int
    assignmentScore: int
    overallScore: int
    band: str


class OptionIntelligenceScenarioRow(DashboardModel):
    label: str
    underlyingPrice: float | None = None
    result: str


class OptionIntelligenceResponse(DashboardModel):
    stateVector: OptionStateVector
    intent: OptionIntentProfile
    scorecard: OptionIntelligenceScorecard
    rules: list[OptionIntelligenceRule]
    summary: str
    topWarnings: list[str] = Field(default_factory=list)
    badges: list[str] = Field(default_factory=list)
    whatYouAreBetting: str
    whatCanGoWrong: str
    whatGoesRight: str
    suggestedAdjustments: list[str] = Field(default_factory=list)
    scenarioTable: list[OptionIntelligenceScenarioRow] = Field(default_factory=list)
    generatedAt: datetime
    isStale: bool = False


class UniverseCandidate(DashboardModel):
    symbol: str
    asOfDate: date
    lastClose: float | None = None
    betaQqq60d: float | None = None
    betaQqq120d: float | None = None
    betaSpy120d: float | None = None
    hv20: float | None = None
    hv60: float | None = None
    atmFrontMonthIv: float | None = None
    atm3045dIv: float | None = None
    ivToHv20: float | None = None
    avgDailyDollarVolume20d: float | None = None
    totalOptionVolume: int | None = None
    totalOptionOpenInterest: int | None = None
    compositeScore: float | None = None
    betaComponent: float | None = None
    impliedVolComponent: float | None = None
    recommendedStrategy: str | None = None
    whyItRanked: str | None = None
    eligible: bool = False


class UniverseSnapshotResponse(DashboardModel):
    snapshotDate: date
    rows: list[UniverseCandidate]
    sourceNotice: str | None = None
    generatedAt: datetime
    isStale: bool = False


class OptionOrderRequest(DashboardModel):
    accountId: str
    symbol: str
    expiry: str
    strike: float
    right: Literal["C", "P"]
    action: OrderAction
    quantity: int = Field(gt=0)
    orderType: OrderType = "LMT"
    limitPrice: float | None = Field(default=None, ge=0.0)
    tif: TimeInForce = "DAY"
    orderRef: str | None = None
    strategyTag: StrategyTag | None = None
    structureLabel: str | None = None
    legs: list["OptionOrderLegRequest"] = Field(default_factory=list)

    @field_validator("accountId")
    @classmethod
    def _normalize_account_id(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not normalized:
            raise ValueError("Account ID is required.")
        return normalized

    @field_validator("symbol")
    @classmethod
    def _normalize_symbol(cls, value: str) -> str:
        normalized = value.strip().upper()
        if not normalized:
            raise ValueError("Symbol is required.")
        return normalized

    @field_validator("expiry")
    @classmethod
    def _normalize_expiry(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) == 8 and normalized.isdigit():
            return f"{normalized[:4]}-{normalized[4:6]}-{normalized[6:8]}"
        return normalized

    @field_validator("limitPrice")
    @classmethod
    def _validate_limit_price(cls, value: float | None, info) -> float | None:
        order_type = info.data.get("orderType")
        if order_type == "LMT" and value is None:
            raise ValueError("Limit price is required for limit orders.")
        if order_type == "MKT":
            return None
        return round(float(value), 4) if value is not None else value

    @field_validator("strike")
    @classmethod
    def _normalize_strike(cls, value: float) -> float:
        return round(float(value), 4)

    @field_validator("structureLabel")
    @classmethod
    def _normalize_structure_label(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    def resolved_legs(self) -> list["OptionOrderLegRequest"]:
        if self.legs:
            return self.legs
        return [OptionOrderLegRequest(expiry=self.expiry, strike=self.strike, right=self.right, action=self.action, ratio=1)]


class OptionOrderLegRequest(DashboardModel):
    expiry: str
    strike: float
    right: Literal["C", "P"]
    action: OrderAction
    ratio: int = Field(default=1, gt=0)

    @field_validator("expiry")
    @classmethod
    def _normalize_expiry(cls, value: str) -> str:
        normalized = value.strip()
        if len(normalized) == 8 and normalized.isdigit():
            return f"{normalized[:4]}-{normalized[4:6]}-{normalized[6:8]}"
        return normalized

    @field_validator("strike")
    @classmethod
    def _normalize_strike(cls, value: float) -> float:
        return round(float(value), 4)


class OptionOrderLegPreview(DashboardModel):
    expiry: str
    strike: float
    right: Literal["C", "P"]
    action: OrderAction
    ratio: int = 1
    marketReferencePrice: float | None = None


class OptionOrderPreview(DashboardModel):
    accountId: str
    symbol: str
    expiry: str
    strike: float
    right: Literal["C", "P"]
    action: OrderAction
    quantity: int
    orderType: OrderType
    limitPrice: float | None = None
    tif: TimeInForce
    orderRef: str
    openingOrClosing: Literal["opening", "closing", "unknown"]
    strategyTag: StrategyTag | None = None
    structureLabel: str | None = None
    legs: list[OptionOrderLegPreview] = Field(default_factory=list)
    marketReferencePrice: float | None = None
    estimatedGrossPremium: float | None = None
    conservativeCashImpact: float | None = None
    brokerInitialMarginChange: float | None = None
    brokerMaintenanceMarginChange: float | None = None
    commissionEstimate: float | None = None
    maxProfit: float | None = None
    maxLoss: float | None = None
    warningText: str | None = None
    note: str | None = None
    generatedAt: datetime


class SubmittedOrder(DashboardModel):
    orderId: int
    permId: int | None = None
    clientId: int | None = None
    status: str
    filledQuantity: float
    remainingQuantity: float
    structureLabel: str | None = None
    legCount: int = 1
    message: str | None = None
    submittedAt: datetime


OptionOrderRequest.model_rebuild()


class OrderCancelResponse(DashboardModel):
    orderId: int
    accountId: str
    status: str
    message: str | None = None
    cancelledAt: datetime


class CoinbaseSourceStatus(DashboardModel):
    available: bool
    status: Literal["ready", "degraded"]
    authMode: Literal["jwt", "bearer", "missing", "unsupported"]
    apiBaseUrl: str
    detail: str
    lastSuccessfulSyncAt: datetime | None = None
    lastError: str | None = None


class FinnhubSourceStatus(DashboardModel):
    available: bool
    configured: bool
    status: Literal["ready", "degraded"]
    apiBaseUrl: str
    detail: str
    maskedApiKey: str | None = None
    lastSuccessfulSyncAt: datetime | None = None
    lastError: str | None = None


class FinnhubConnectorConfigRequest(DashboardModel):
    apiKey: str | None = None


class CoinbaseHolding(DashboardModel):
    accountId: str
    accountName: str
    accountType: str
    primary: bool = False
    ready: bool | None = None
    currencyCode: str
    currencyName: str | None = None
    currencyType: str | None = None
    balance: float
    availableBalance: float | None = None
    holdBalance: float | None = None
    usdRate: float | None = None
    usdValue: float | None = None
    allocationPct: float | None = None
    isCashLike: bool = False
    updatedAt: datetime | None = None


class CoinbasePortfolioResponse(DashboardModel):
    totalUsdValue: float
    cryptoUsdValue: float
    cashLikeUsdValue: float
    visibleHoldingsCount: int
    totalAccountsCount: int
    holdings: list[CoinbaseHolding]
    sourceNotice: str | None = None
    generatedAt: datetime
    isStale: bool = False


class FilesystemConnectorStatus(DashboardModel):
    sourceId: str
    connectorId: str
    available: bool
    connected: bool
    status: Literal["ready", "degraded", "not_connected"]
    detail: str
    displayName: str | None = None
    directoryPath: str | None = None
    detectFooter: bool = False
    csvFilesCount: int = 0
    latestCsvPath: str | None = None
    lastSuccessfulSyncAt: datetime | None = None
    lastError: str | None = None


class FilesystemConnectorConfigRequest(DashboardModel):
    displayName: str
    directoryPath: str
    detectFooter: bool = True


class FilesystemInvestmentAccount(DashboardModel):
    accountId: str
    name: str
    currentBalance: float | None = None
    isoCurrencyCode: str | None = None


class FilesystemHolding(DashboardModel):
    accountId: str
    accountName: str
    symbol: str | None = None
    name: str
    quantity: float | None = None
    price: float | None = None
    value: float | None = None
    costBasis: float | None = None
    gainLoss: float | None = None
    isoCurrencyCode: str | None = None
    sourceFile: str | None = None


class FilesystemConnectorPortfolioResponse(DashboardModel):
    sourceId: str
    connectorId: str
    displayName: str | None = None
    directoryPath: str
    latestCsvPath: str | None = None
    totalValue: float
    investmentAccountsCount: int
    holdingsCount: int
    accounts: list[FilesystemInvestmentAccount] = Field(default_factory=list)
    holdings: list[FilesystemHolding] = Field(default_factory=list)
    sourceNotice: str | None = None
    generatedAt: datetime
    isStale: bool = False


class FilesystemDocumentFile(DashboardModel):
    name: str
    path: str
    modifiedAt: datetime
    sizeBytes: int


class FilesystemDocumentFolderResponse(DashboardModel):
    sourceId: str
    connectorId: str
    displayName: str | None = None
    directoryPath: str
    latestPdfPath: str | None = None
    pdfFilesCount: int
    files: list[FilesystemDocumentFile] = Field(default_factory=list)
    sourceNotice: str | None = None
    generatedAt: datetime
    isStale: bool = False


class CryptoMarketQuote(DashboardModel):
    symbol: str
    name: str
    priceUsd: float


class CryptoMarketResponse(DashboardModel):
    source: str
    quotes: list[CryptoMarketQuote]
    generatedAt: datetime
    sourceNotice: str | None = None
    isStale: bool = False


class OkxSourceStatus(DashboardModel):
    available: bool
    status: Literal["ready", "degraded"]
    authMode: Literal["public"] = "public"
    apiBaseUrl: str
    detail: str
    lastSuccessfulSyncAt: datetime | None = None
    lastError: str | None = None


class EdgarSourceStatus(DashboardModel):
    available: bool
    status: Literal["ready", "degraded"]
    researchRootPath: str
    stocksRootPath: str
    edgarUserAgent: str
    maxRequestsPerSecond: float
    timeoutSeconds: float


class EdgarDownloadRequest(DashboardModel):
    ticker: str | None = None
    companyName: str | None = None
    cik: str | None = None
    formTypes: list[str] = Field(default_factory=list)
    startDate: date | None = None
    endDate: date | None = None
    downloadMode: EdgarDownloadMode = "primary-document"
    pdfLayout: EdgarPdfLayout = "both"
    pdfFolderFormat: str | None = None
    outputDir: str | None = None
    includeExhibits: bool = True
    resume: bool = True
    maxRequestsPerSecond: float | None = Field(default=None, gt=0)
    userAgent: str | None = None

    @field_validator("ticker")
    @classmethod
    def _normalize_ticker(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().upper()
        return normalized or None

    @field_validator("companyName")
    @classmethod
    def _normalize_company_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("cik")
    @classmethod
    def _normalize_cik(cls, value: str | None) -> str | None:
        if value is None:
            return None
        digits = "".join(character for character in value if character.isdigit())
        return digits or None

    @field_validator("formTypes")
    @classmethod
    def _normalize_form_types(cls, value: list[str]) -> list[str]:
        deduped: list[str] = []
        for form_type in value:
            normalized = form_type.strip().upper()
            if normalized and normalized not in deduped:
                deduped.append(normalized)
        return deduped

    @model_validator(mode="after")
    def _validate_identifier(self) -> "EdgarDownloadRequest":
        if not any([self.ticker, self.companyName, self.cik]):
            raise ValueError("Provide a ticker, company name, or CIK.")
        if self.startDate and self.endDate and self.startDate > self.endDate:
            raise ValueError("startDate must be on or before endDate.")
        return self


class EdgarDownloadResponse(DashboardModel):
    companyName: str
    ticker: str
    cik: str
    totalFilingsConsidered: int
    matchedFilings: int
    metadataFilesSynced: int
    downloadedFiles: int
    generatedPdfs: int
    skippedFiles: int
    failedFiles: int
    downloadMode: EdgarDownloadMode
    pdfLayout: EdgarPdfLayout
    pdfFolderFormat: str | None = None
    includeExhibits: bool
    resume: bool
    researchRootPath: str
    stockPath: str
    filingsPath: str
    pdfsPath: str
    edgarPath: str
    exportsJsonPath: str
    exportsCsvPath: str
    manifestPath: str
    syncedAt: datetime


class InvestorPdfSourceStatus(DashboardModel):
    available: bool
    status: Literal["ready", "degraded"]
    researchRootPath: str
    stocksRootPath: str
    pdfFolderName: str = "pdfs"
    timeoutSeconds: float


class InvestorPdfDownloadRequest(DashboardModel):
    ticker: str | None = None
    companyName: str | None = None
    cik: str | None = None
    lookbackYears: int = Field(default=5, ge=1, le=50)
    startDate: date | None = None
    endDate: date | None = None
    outputDir: str | None = None
    includeAnnualReports: bool = True
    includeEarningsDecks: bool = True
    includeInvestorPresentations: bool = True
    includeCompanyReports: bool = True
    includeSecExhibits: bool = True
    resume: bool = True
    maxRequestsPerSecond: float | None = Field(default=None, gt=0)
    userAgent: str | None = None

    @field_validator("ticker")
    @classmethod
    def _normalize_investor_pdf_ticker(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip().upper()
        return normalized or None

    @field_validator("companyName")
    @classmethod
    def _normalize_investor_pdf_company_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("cik")
    @classmethod
    def _normalize_investor_pdf_cik(cls, value: str | None) -> str | None:
        if value is None:
            return None
        digits = "".join(character for character in value if character.isdigit())
        return digits or None

    @model_validator(mode="after")
    def _validate_investor_pdf_request(self) -> "InvestorPdfDownloadRequest":
        if not any([self.ticker, self.companyName, self.cik]):
            raise ValueError("Provide a ticker, company name, or CIK.")
        if self.startDate and self.endDate and self.startDate > self.endDate:
            raise ValueError("startDate must be on or before endDate.")
        if not any(
            [
                self.includeAnnualReports,
                self.includeEarningsDecks,
                self.includeInvestorPresentations,
                self.includeCompanyReports,
                self.includeSecExhibits,
            ]
        ):
            raise ValueError("Select at least one PDF category to search.")
        return self


class InvestorPdfArtifact(DashboardModel):
    title: str
    category: InvestorPdfCategory
    sourceLabel: str
    sourceUrl: str
    host: str
    publishedAt: str | None = None
    year: int | None = None
    savedPath: str | None = None


class InvestorPdfDownloadResponse(DashboardModel):
    companyName: str
    ticker: str
    cik: str
    lookbackYears: int
    startDate: date | None = None
    endDate: date | None = None
    discoveredCandidates: int
    matchedPdfs: int
    downloadedFiles: int
    skippedFiles: int
    failedFiles: int
    resume: bool
    researchRootPath: str
    stockPath: str
    pdfsPath: str
    workspacePath: str
    exportsJsonPath: str
    exportsCsvPath: str
    manifestPath: str
    artifacts: list[InvestorPdfArtifact] = Field(default_factory=list)
    syncedAt: datetime
