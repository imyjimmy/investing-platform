import type {
  ConnectionStatus,
  OpenOrdersResponse,
  OptionChainResponse,
  OptionPositionsResponse,
  RiskSummaryResponse,
  ScenarioResponse,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

export async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
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
    fetchJson<ScenarioResponse>(
      `/api/analytics/scenario?movePct=${movePct}&daysForward=${daysForward}&ivShockPct=${ivShockPct}`,
    ),
};
