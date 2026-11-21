import { useMutation, useQueryClient } from "@tanstack/react-query";

import { sourceApi } from "../../lib/api/sources";
import { stockIntelMutationKeys } from "./stockIntelKeys";

export function useEdgarQuestion() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: stockIntelMutationKeys.edgarAsk,
    mutationFn: sourceApi.edgarAsk,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["edgar-intelligence-status"] });
      void queryClient.invalidateQueries({ queryKey: ["edgar-workspace"] });
    },
  });

  return {
    edgarQuestionError: mutation.error?.message,
    edgarQuestionResult: mutation.data,
    submittedRequest: mutation.variables,
    edgarQuestioning: mutation.isPending,
    runEdgarQuestion: mutation.mutateAsync,
  };
}
