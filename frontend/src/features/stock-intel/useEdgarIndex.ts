import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { sourceApi } from "../../lib/api";
import type { EdgarIntelligenceIndexRequest, EdgarIntelligenceIndexResponse } from "../../lib/types";
import { stockIntelMutationKeys } from "./stockIntelKeys";

export function useEdgarIndex() {
  const queryClient = useQueryClient();
  const [indexResult, setIndexResult] = useState<EdgarIntelligenceIndexResponse | undefined>(undefined);
  const [indexError, setIndexError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationKey: stockIntelMutationKeys.edgarIntelligenceIndex,
    mutationFn: sourceApi.edgarIntelligenceIndex,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["edgar-intelligence-status"] });
      void queryClient.invalidateQueries({ queryKey: ["edgar-workspace"] });
    },
  });

  async function runEdgarIndex(request: EdgarIntelligenceIndexRequest) {
    setIndexError(null);
    try {
      const result = await mutation.mutateAsync(request);
      setIndexResult(result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "EDGAR intelligence indexing failed.";
      setIndexError(message);
      throw error;
    }
  }

  return {
    edgarIndexError: indexError,
    edgarIndexResult: indexResult,
    edgarIndexing: mutation.isPending,
    runEdgarIndex,
  };
}
