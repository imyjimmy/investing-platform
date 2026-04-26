import { useCallback, useState } from "react";

import { executionApi } from "../../lib/api";
import type {
  OptionOrderPreview,
  OptionOrderRequest,
  StockOrderPreview,
  StockOrderRequest,
  SubmittedOrder,
} from "../../lib/types";
import { useOrderMutations } from "./useOrderMutations";

type OrderRequestBase = {
  accountId: string;
};

type UseTradeTicketOptions<Request extends OrderRequestBase, Preview> = {
  executionEnabled: boolean;
  positionInvalidationTarget: "options" | "stocks";
  previewOrder: (request: Request) => Promise<Preview>;
  request: Request | null;
  submitOrder: (request: Request) => Promise<SubmittedOrder>;
};

export function useTradeTicket<Request extends OrderRequestBase, Preview>({
  executionEnabled,
  positionInvalidationTarget,
  previewOrder,
  request,
  submitOrder,
}: UseTradeTicketOptions<Request, Preview>) {
  const [previewRequestKey, setPreviewRequestKey] = useState<string | null>(null);
  const ticketRequestKey = request ? orderRequestKey(request) : null;
  const { cancelMutation, previewMutation, submitMutation } = useOrderMutations({
    previewOrder,
    submitOrder,
    positionInvalidationTarget,
    onPreviewSuccess: (_data, variables) => setPreviewRequestKey(orderRequestKey(variables)),
    onSubmitSuccess: (_data, variables) => setPreviewRequestKey(orderRequestKey(variables)),
  });
  const previewIsCurrent = Boolean(previewMutation.data && previewRequestKey && ticketRequestKey === previewRequestKey);
  const submitIsCurrent = Boolean(submitMutation.data && previewRequestKey && ticketRequestKey === previewRequestKey);
  const previewError = previewMutation.error instanceof Error ? previewMutation.error.message : null;
  const submitError = submitMutation.error instanceof Error ? submitMutation.error.message : null;
  const canPreviewTicket = executionEnabled && Boolean(request);
  const canSubmitTicket = canPreviewTicket && previewIsCurrent;
  const resetTicketFeedback = useCallback(() => {
    previewMutation.reset();
    submitMutation.reset();
    setPreviewRequestKey(null);
  }, [previewMutation, submitMutation]);

  return {
    canPreviewTicket,
    canSubmitTicket,
    cancelMutation,
    previewError,
    previewIsCurrent,
    previewMutation,
    resetTicketFeedback,
    submitError,
    submitIsCurrent,
    submitMutation,
  };
}

export function useStockTradeTicket(request: StockOrderRequest | null, executionEnabled: boolean) {
  return useTradeTicket<StockOrderRequest, StockOrderPreview>({
    executionEnabled,
    positionInvalidationTarget: "stocks",
    previewOrder: executionApi.previewStockOrder,
    request,
    submitOrder: executionApi.submitStockOrder,
  });
}

export function useOptionTradeTicket(request: OptionOrderRequest | null, executionEnabled: boolean) {
  return useTradeTicket<OptionOrderRequest, OptionOrderPreview>({
    executionEnabled,
    positionInvalidationTarget: "options",
    previewOrder: executionApi.previewOptionOrder,
    request,
    submitOrder: executionApi.submitOptionOrder,
  });
}

function orderRequestKey(request: unknown) {
  return JSON.stringify(request);
}
