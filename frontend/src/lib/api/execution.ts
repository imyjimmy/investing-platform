import type {
  OptionIntelligenceRequest,
  OptionIntelligenceResponse,
  OptionOrderPreview,
  OptionOrderRequest,
  OrderCancelResponse,
  StockOrderPreview,
  StockOrderRequest,
  SubmittedOrder,
} from "../types";
import { postJson } from "./transport";

export const executionApi = {
  optionIntelligence: (request: OptionIntelligenceRequest) =>
    postJson<OptionIntelligenceResponse>("/api/analytics/options-intelligence", request),
  previewOptionOrder: (request: OptionOrderRequest) => postJson<OptionOrderPreview>("/api/execution/options/preview", request),
  submitOptionOrder: (request: OptionOrderRequest) => postJson<SubmittedOrder>("/api/execution/options/submit", request),
  previewStockOrder: (request: StockOrderRequest) => postJson<StockOrderPreview>("/api/execution/stocks/preview", request),
  submitStockOrder: (request: StockOrderRequest) => postJson<SubmittedOrder>("/api/execution/stocks/submit", request),
  cancelOrder: (orderId: number, accountId: string) =>
    postJson<OrderCancelResponse>(`/api/execution/orders/${orderId}/cancel?accountId=${encodeURIComponent(accountId)}`),
};
