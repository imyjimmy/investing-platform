import type {
  ConnectionStatus,
  OpenOrdersResponse,
  OptionPositionsResponse,
  OptionStrategyPermissionsResponse,
  PositionsResponse,
  RiskSummaryResponse,
} from "../types";
import { fetchJson, postJson, withAccountId } from "./transport";

export const accountApi = {
  connectionStatus: () => fetchJson<ConnectionStatus>("/api/connection-status"),
  connect: () => postJson<ConnectionStatus>("/api/connect"),
  reconnect: () => postJson<ConnectionStatus>("/api/reconnect"),
  positions: (accountId?: string) => fetchJson<PositionsResponse>(withAccountId("/api/account/positions", accountId)),
  riskSummary: (accountId?: string) => fetchJson<RiskSummaryResponse>(withAccountId("/api/account/risk-summary", accountId)),
  optionPositions: (accountId?: string) =>
    fetchJson<OptionPositionsResponse>(withAccountId("/api/account/options-positions", accountId)),
  optionStrategyPermissions: (accountId: string, symbol: string, expiry?: string) => {
    const params = new URLSearchParams({ accountId, symbol });
    if (expiry) {
      params.set("expiry", expiry);
    }
    return fetchJson<OptionStrategyPermissionsResponse>(`/api/account/options-strategy-permissions?${params.toString()}`);
  },
  openOrders: (accountId?: string) => fetchJson<OpenOrdersResponse>(withAccountId("/api/account/open-orders", accountId)),
};
