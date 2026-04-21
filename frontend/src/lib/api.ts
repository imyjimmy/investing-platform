import type {
  CoinbasePortfolioResponse,
  CoinbaseSourceStatus,
  ConnectionStatus,
  CryptoMarketResponse,
  EdgarDownloadRequest,
  EdgarDownloadResponse,
  EdgarSourceStatus,
  FilesystemConnectorConfigRequest,
  FilesystemDocumentFolderResponse,
  FilesystemConnectorPortfolioResponse,
  FilesystemConnectorStatus,
  InvestorPdfDownloadRequest,
  InvestorPdfDownloadResponse,
  InvestorPdfSourceStatus,
  OpenOrdersResponse,
  OptionOrderPreview,
  OptionOrderRequest,
  OptionChainResponse,
  OptionPositionsResponse,
  PositionsResponse,
  OrderCancelResponse,
  RiskSummaryResponse,
  ScenarioResponse,
  SubmittedOrder,
  TickerOverviewResponse,
  UniverseSnapshotResponse,
} from "./types";

function resolveApiBaseUrl() {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL;
  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  if (typeof window === "undefined") {
    return "";
  }

  const protocol = window.location.protocol;
  if (protocol === "http:" || protocol === "https:") {
    return "";
  }

  return "http://127.0.0.1:8000";
}

const API_BASE = resolveApiBaseUrl();

function withAccountId(path: string, accountId?: string) {
  if (!accountId) {
    return path;
  }
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}accountId=${encodeURIComponent(accountId)}`;
}

function withAccountKey(path: string, accountKey: string) {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}accountKey=${encodeURIComponent(accountKey)}`;
}

function formatApiErrorDetail(detail: unknown): string | null {
  if (typeof detail === "string" && detail.trim()) {
    return detail.trim();
  }
  if (Array.isArray(detail)) {
    const entries = detail
      .map((entry) => formatValidationEntry(entry))
      .filter((entry): entry is string => Boolean(entry));
    return entries.length ? entries.join(" ") : null;
  }
  if (detail && typeof detail === "object") {
    try {
      return JSON.stringify(detail);
    } catch {
      return null;
    }
  }
  return null;
}

function formatValidationEntry(entry: unknown): string | null {
  if (!entry || typeof entry !== "object") {
    return typeof entry === "string" ? entry : null;
  }
  const candidate = entry as { loc?: unknown; msg?: unknown };
  const msg = typeof candidate.msg === "string" ? candidate.msg : null;
  const loc = Array.isArray(candidate.loc)
    ? candidate.loc
        .map((segment) => (typeof segment === "string" || typeof segment === "number" ? String(segment) : null))
        .filter((segment): segment is string => Boolean(segment))
        .filter((segment) => segment !== "body")
    : [];
  if (msg && loc.length) {
    return `${loc.join(".")}: ${msg}`;
  }
  return msg;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch (error) {
    const fallbackBase = API_BASE || "the configured API";
    throw new Error(`Could not reach local backend at ${fallbackBase}. The desktop app may still be starting its local service.`);
  }
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = (await response.json()) as { detail?: unknown };
      const formattedDetail = formatApiErrorDetail(payload.detail);
      if (formattedDetail) {
        message = formattedDetail;
      }
    } catch {
      // Keep the HTTP status text when the server does not return JSON.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function fetchJson<T>(path: string): Promise<T> {
  return requestJson<T>(path);
}

export async function postJson<T>(path: string, body?: unknown): Promise<T> {
  return requestJson<T>(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: body == null ? undefined : JSON.stringify(body),
  });
}

export const api = {
  connectionStatus: () => fetchJson<ConnectionStatus>("/api/connection-status"),
  connect: () => postJson<ConnectionStatus>("/api/connect"),
  reconnect: () => postJson<ConnectionStatus>("/api/reconnect"),
  coinbaseStatus: () => fetchJson<CoinbaseSourceStatus>("/api/sources/coinbase/status"),
  coinbasePortfolio: () => fetchJson<CoinbasePortfolioResponse>("/api/sources/coinbase/portfolio"),
  filesystemConnectorStatuses: (accountKey: string) =>
    fetchJson<FilesystemConnectorStatus[]>(withAccountKey("/api/sources/filesystem/connectors", accountKey)),
  filesystemConnectorConfigure: (
    accountKey: string,
    connectorId: string,
    request: FilesystemConnectorConfigRequest,
    sourceId?: string,
  ) =>
    postJson<FilesystemConnectorStatus>(
      withAccountKey(
        sourceId
          ? `/api/sources/filesystem/connectors/${encodeURIComponent(connectorId)}/configure?sourceId=${encodeURIComponent(sourceId)}`
          : `/api/sources/filesystem/connectors/${encodeURIComponent(connectorId)}/configure`,
        accountKey,
      ),
      request,
    ),
  filesystemConnectorPortfolio: (accountKey: string, sourceId: string) =>
    fetchJson<FilesystemConnectorPortfolioResponse>(
      withAccountKey(`/api/sources/filesystem/sources/${encodeURIComponent(sourceId)}/portfolio`, accountKey),
    ),
  filesystemConnectorDocuments: (accountKey: string, sourceId: string) =>
    fetchJson<FilesystemDocumentFolderResponse>(
      withAccountKey(`/api/sources/filesystem/sources/${encodeURIComponent(sourceId)}/documents`, accountKey),
    ),
  cryptoMajors: () => fetchJson<CryptoMarketResponse>("/api/market/crypto-majors"),
  positions: (accountId?: string) => fetchJson<PositionsResponse>(withAccountId("/api/account/positions", accountId)),
  riskSummary: (accountId?: string) => fetchJson<RiskSummaryResponse>(withAccountId("/api/account/risk-summary", accountId)),
  optionPositions: (accountId?: string) =>
    fetchJson<OptionPositionsResponse>(withAccountId("/api/account/options-positions", accountId)),
  openOrders: (accountId?: string) => fetchJson<OpenOrdersResponse>(withAccountId("/api/account/open-orders", accountId)),
  tickerOverview: (symbol: string) => fetchJson<TickerOverviewResponse>(`/api/market/ticker/${encodeURIComponent(symbol)}`),
  chain: (symbol: string, expiry?: string) =>
    fetchJson<OptionChainResponse>(`/api/market/chain/${symbol}${expiry ? `?expiry=${expiry}` : ""}`),
  marketUniverse: () => fetchJson<UniverseSnapshotResponse>("/api/market/universe"),
  scenario: (movePct: number, daysForward: number, ivShockPct: number, accountId?: string) =>
    fetchJson<ScenarioResponse>(
      withAccountId(`/api/analytics/scenario?movePct=${movePct}&daysForward=${daysForward}&ivShockPct=${ivShockPct}`, accountId),
    ),
  edgarStatus: () => fetchJson<EdgarSourceStatus>("/api/sources/edgar/status"),
  edgarDownload: (request: EdgarDownloadRequest) => postJson<EdgarDownloadResponse>("/api/sources/edgar/download", request),
  edgarLastSync: (request: EdgarDownloadRequest) => postJson<EdgarDownloadResponse | null>("/api/sources/edgar/last-sync", request),
  investorPdfStatus: () => fetchJson<InvestorPdfSourceStatus>("/api/sources/investor-pdfs/status"),
  investorPdfDownload: (request: InvestorPdfDownloadRequest) =>
    postJson<InvestorPdfDownloadResponse>("/api/sources/investor-pdfs/download", request),
  investorPdfLastSync: (request: InvestorPdfDownloadRequest) =>
    postJson<InvestorPdfDownloadResponse | null>("/api/sources/investor-pdfs/last-sync", request),
  previewOptionOrder: (request: OptionOrderRequest) => postJson<OptionOrderPreview>("/api/execution/options/preview", request),
  submitOptionOrder: (request: OptionOrderRequest) => postJson<SubmittedOrder>("/api/execution/options/submit", request),
  cancelOrder: (orderId: number, accountId: string) =>
    postJson<OrderCancelResponse>(`/api/execution/orders/${orderId}/cancel?accountId=${encodeURIComponent(accountId)}`),
};
