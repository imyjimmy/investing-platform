import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";

import { executionApi } from "../../lib/api";
import { queryKeys } from "../../lib/queryKeys";
import type { SubmittedOrder } from "../../lib/types";

type OrderRequestBase = {
  accountId: string;
};

type PositionInvalidationTarget = "options" | "stocks";

type MutationSuccessHandler<Data, Variables> = (data: Data, variables: Variables) => Promise<void> | void;

type UseOrderMutationsOptions<Request extends OrderRequestBase, Preview> = {
  previewOrder: (request: Request) => Promise<Preview>;
  submitOrder: (request: Request) => Promise<SubmittedOrder>;
  positionInvalidationTarget: PositionInvalidationTarget;
  onPreviewSuccess?: MutationSuccessHandler<Preview, Request>;
  onSubmitSuccess?: MutationSuccessHandler<SubmittedOrder, Request>;
  onCancelSuccess?: MutationSuccessHandler<unknown, CancelOrderVariables>;
};

type CancelOrderVariables = {
  accountId: string;
  orderId: number;
};

export function useOrderMutations<Request extends OrderRequestBase, Preview>({
  previewOrder,
  submitOrder,
  positionInvalidationTarget,
  onPreviewSuccess,
  onSubmitSuccess,
  onCancelSuccess,
}: UseOrderMutationsOptions<Request, Preview>) {
  const queryClient = useQueryClient();

  const previewMutation = useMutation({
    mutationFn: previewOrder,
    onSuccess: onPreviewSuccess,
  });

  const submitMutation = useMutation({
    mutationFn: submitOrder,
    onSuccess: async (data, variables) => {
      await onSubmitSuccess?.(data, variables);
      await invalidateOrderAccountState(queryClient, variables.accountId, positionInvalidationTarget);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: ({ accountId, orderId }: CancelOrderVariables) => executionApi.cancelOrder(orderId, accountId),
    onSuccess: async (data, variables) => {
      await onCancelSuccess?.(data, variables);
      await invalidateOrderAccountState(queryClient, variables.accountId, positionInvalidationTarget);
    },
  });

  return {
    cancelMutation,
    previewMutation,
    submitMutation,
  };
}

function invalidateOrderAccountState(
  queryClient: QueryClient,
  accountId: string,
  positionInvalidationTarget: PositionInvalidationTarget,
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.account.riskSummary(accountId) }),
    queryClient.invalidateQueries({ queryKey: positionQueryKey(accountId, positionInvalidationTarget) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.account.openOrders(accountId) }),
  ]);
}

function positionQueryKey(accountId: string, positionInvalidationTarget: PositionInvalidationTarget) {
  return positionInvalidationTarget === "options"
    ? queryKeys.account.optionPositions(accountId)
    : queryKeys.account.positions(accountId);
}
