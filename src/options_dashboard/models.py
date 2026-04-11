"""Pydantic models shared across the API layer."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class DashboardModel(BaseModel):
    """Base model with camel-friendly serialization support."""

    model_config = ConfigDict(populate_by_name=True)


RiskLevel = Literal["Low", "Moderate", "Elevated", "High"]
StrategyTag = Literal["covered-call", "cash-secured-put", "short-option", "long-option", "stock", "other"]
QuoteSource = Literal["streaming", "historical", "unavailable"]
ExecutionMode = Literal["disabled", "paper"]
OrderAction = Literal["BUY", "SELL"]
OrderType = Literal["LMT", "MKT"]
TimeInForce = Literal["DAY", "GTC"]
EdgarDownloadMode = Literal["primary-document", "all-attachments", "metadata-only", "full-filing-bundle"]
EdgarPdfLayout = Literal["nested", "by-filing", "both"]
InvestorPdfCategory = Literal["annual-report", "earnings-deck", "investor-presentation", "company-report", "sec-exhibit"]


class ConnectionStatus(DashboardModel):
    mode: Literal["mock", "ibkr"]
    connected: bool
    status: Literal["connected", "disconnected", "degraded"]
    executionMode: ExecutionMode = "disabled"
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
    symbol: str
    secType: str
    orderType: str
    side: str
    quantity: float
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


class ChainRow(DashboardModel):
    strike: float
    distanceFromSpotPct: float
    callBid: float | None = None
    callAsk: float | None = None
    callMid: float | None = None
    callIV: float | None = None
    callDelta: float | None = None
    callTheta: float | None = None
    callAnnualizedYieldPct: float | None = None
    putBid: float | None = None
    putAsk: float | None = None
    putMid: float | None = None
    putIV: float | None = None
    putDelta: float | None = None
    putTheta: float | None = None
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
    marketReferencePrice: float | None = None
    estimatedGrossPremium: float | None = None
    conservativeCashImpact: float | None = None
    brokerInitialMarginChange: float | None = None
    brokerMaintenanceMarginChange: float | None = None
    commissionEstimate: float | None = None
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
    message: str | None = None
    submittedAt: datetime


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
