import type {
    ConnectionStatus,
    EdgarDownloadRequest,
    EdgarDownloadResponse,
    EdgarSourceStatus,
    InvestorPdfDownloadRequest,
    InvestorPdfDownloadResponse,
    InvestorPdfSourceStatus,
    OpenOrdersResponse,
    OptionOrderPreview,
    OptionOrderRequest,
    OptionChainResponse,
    OptionPositionsResponse,
    OrderCancelResponse,
    RiskSummaryResponse,
    ScenarioResponse,
    SubmittedOrder,
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

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) {
        message = payload.detail;
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
  connect: () => fetchJson<ConnectionStatus>("/api/connect"),
  reconnect: () => fetchJson<ConnectionStatus>("/api/reconnect"),
  riskSummary: (accountId?: string) => fetchJson<RiskSummaryResponse>(withAccountId("/api/account/risk-summary", accountId)),
  optionPositions: (accountId?: string) =>
    fetchJson<OptionPositionsResponse>(withAccountId("/api/account/options-positions", accountId)),
  openOrders: (accountId?: string) => fetchJson<OpenOrdersResponse>(withAccountId("/api/account/open-orders", accountId)),
  chain: (symbol: string, expiry?: string) =>
    fetchJson<OptionChainResponse>(`/api/market/chain/${symbol}${expiry ? `?expiry=${expiry}` : ""}`),
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
