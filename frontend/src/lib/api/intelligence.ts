import type { StockIntelligenceRequest, StockIntelligenceResponse } from "../types";
import { postJson } from "./transport";

export const intelligenceApi = {
  stockAsk: (request: StockIntelligenceRequest) => postJson<StockIntelligenceResponse>("/api/intelligence/stock/ask", request),
};
