import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { sourceApi } from "../../lib/api";
import { queryKeys } from "../../lib/queryKeys";
import type { InvestorPdfDownloadRequest, InvestorPdfDownloadResponse } from "../../lib/types";
import { stockIntelMutationKeys } from "./stockIntelKeys";

export function useInvestorPdfSync() {
  const queryClient = useQueryClient();
  const [syncResult, setSyncResult] = useState<InvestorPdfDownloadResponse | undefined>(undefined);
  const [syncError, setSyncError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationKey: stockIntelMutationKeys.investorPdfDownload,
    mutationFn: sourceApi.investorPdfDownload,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources.investorPdfStatus });
    },
  });

  async function runInvestorPdfDownload(request: InvestorPdfDownloadRequest) {
    setSyncError(null);
    try {
      const result = await mutation.mutateAsync(request);
      setSyncResult(result);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "Investor PDF sync failed.");
    }
  }

  return {
    investorPdfSyncError: syncError,
    investorPdfSyncResult: syncResult,
    investorPdfSyncing: mutation.isPending,
    runInvestorPdfDownload,
  };
}
