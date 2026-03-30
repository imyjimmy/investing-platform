import type {
    ConnectionStatus,
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
  riskSummary: () => fetchJson<RiskSummaryResponse>("/api/account/risk-summary"),
  optionPositions: () => fetchJson<OptionPositionsResponse>("/api/account/options-positions"),
  openOrders: () => fetchJson<OpenOrdersResponse>("/api/account/open-orders"),
  chain: (symbol: string, expiry?: string) =>
    fetchJson<OptionChainResponse>(`/api/market/chain/${symbol}${expiry ? `?expiry=${expiry}` : ""}`),
  scenario: (movePct: number, daysForward: number, ivShockPct: number) =>
    fetchJson<ScenarioResponse>(`/api/analytics/scenario?movePct=${movePct}&daysForward=${daysForward}&ivShockPct=${ivShockPct}`),
  previewOptionOrder: (request: OptionOrderRequest) => postJson<OptionOrderPreview>("/api/execution/options/preview", request),
  submitOptionOrder: (request: OptionOrderRequest) => postJson<SubmittedOrder>("/api/execution/options/submit", request),
  cancelOrder: (orderId: number, accountId: string) =>
    postJson<OrderCancelResponse>(`/api/execution/orders/${orderId}/cancel?accountId=${encodeURIComponent(accountId)}`),
};
