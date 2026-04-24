import type {
  CryptoMarketResponse,
  OptionChainResponse,
  ScenarioResponse,
  TickerFinancialsResponse,
  TickerOverviewResponse,
  UniverseSnapshotResponse,
} from "../types";
import { fetchJson, withAccountId } from "./transport";

export const marketApi = {
  cryptoMajors: () => fetchJson<CryptoMarketResponse>("/api/market/crypto-majors"),
  tickerOverview: (symbol: string) => fetchJson<TickerOverviewResponse>(`/api/market/ticker/${encodeURIComponent(symbol)}`),
  tickerFinancials: (symbol: string) =>
    fetchJson<TickerFinancialsResponse>(`/api/market/ticker/${encodeURIComponent(symbol)}/financials`),
  chain: (
    symbol: string,
    expiry?: string,
    strikeLimit?: number,
    lowerMoneynessPct?: number,
    upperMoneynessPct?: number,
    minMoneynessPct?: number,
    maxMoneynessPct?: number,
  ) => {
    const params = new URLSearchParams();
    if (expiry) {
      params.set("expiry", expiry);
    }
    if (strikeLimit) {
      params.set("strikeLimit", String(strikeLimit));
    }
    if (lowerMoneynessPct != null) {
      params.set("lowerMoneynessPct", String(lowerMoneynessPct));
    }
    if (upperMoneynessPct != null) {
      params.set("upperMoneynessPct", String(upperMoneynessPct));
    }
    if (minMoneynessPct != null) {
      params.set("minMoneynessPct", String(minMoneynessPct));
    }
    if (maxMoneynessPct != null) {
      params.set("maxMoneynessPct", String(maxMoneynessPct));
    }
    const query = params.toString();
    return fetchJson<OptionChainResponse>(`/api/market/chain/${encodeURIComponent(symbol)}${query ? `?${query}` : ""}`);
  },
  marketUniverse: () => fetchJson<UniverseSnapshotResponse>("/api/market/universe"),
  scenario: (movePct: number, daysForward: number, ivShockPct: number, accountId?: string) =>
    fetchJson<ScenarioResponse>(
      withAccountId(`/api/analytics/scenario?movePct=${movePct}&daysForward=${daysForward}&ivShockPct=${ivShockPct}`, accountId),
    ),
};
