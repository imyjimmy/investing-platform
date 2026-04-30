import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { sourceApi } from "../../lib/api";
import type { EdgarQuestionRequest, EdgarQuestionResponse } from "../../lib/types";
import { stockIntelMutationKeys } from "./stockIntelKeys";

export function useEdgarQuestion() {
  const queryClient = useQueryClient();
  const [questionResult, setQuestionResult] = useState<EdgarQuestionResponse | undefined>(undefined);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationKey: stockIntelMutationKeys.edgarAsk,
    mutationFn: sourceApi.edgarAsk,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["edgar-intelligence-status"] });
      void queryClient.invalidateQueries({ queryKey: ["edgar-workspace"] });
    },
  });

  async function runEdgarQuestion(request: EdgarQuestionRequest) {
    setQuestionError(null);
    try {
      const result = await mutation.mutateAsync(request);
      setQuestionResult(result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Qwen could not answer this EDGAR question.";
      setQuestionError(message);
      throw error;
    }
  }

  return {
    edgarQuestionError: questionError,
    edgarQuestionResult: questionResult,
    edgarQuestioning: mutation.isPending,
    runEdgarQuestion,
  };
}
