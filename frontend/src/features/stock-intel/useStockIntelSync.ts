import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { sourceApi } from "../../lib/api";
import { queryKeys } from "../../lib/queryKeys";
import type {
  EdgarDownloadRequest,
  EdgarDownloadResponse,
  InvestorPdfDownloadRequest,
  InvestorPdfDownloadResponse,
} from "../../lib/types";
import { stockIntelMutationKeys } from "./stockIntelKeys";
import { useStockIntelSourceStatus } from "./useStockIntelSourceStatus";

export type StockIntelTab = "sec" | "companyPdfs";

export function useStockIntelSync() {
  const queryClient = useQueryClient();
  const [activeStockIntelTab, setActiveStockIntelTab] = useState<StockIntelTab>("sec");
  const [edgarSyncResult, setEdgarSyncResult] = useState<EdgarDownloadResponse | undefined>(undefined);
  const [edgarSyncError, setEdgarSyncError] = useState<string | null>(null);
  const [investorPdfSyncResult, setInvestorPdfSyncResult] = useState<InvestorPdfDownloadResponse | undefined>(undefined);
  const [investorPdfSyncError, setInvestorPdfSyncError] = useState<string | null>(null);
  const {
    edgarStatusError,
    edgarStatusQuery,
    edgarSyncing,
    investorPdfStatusError,
    investorPdfStatusQuery,
    investorPdfSyncing,
  } = useStockIntelSourceStatus();

  const edgarDownloadMutation = useMutation({
    mutationKey: stockIntelMutationKeys.edgarDownload,
    mutationFn: sourceApi.edgarDownload,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources.edgarStatus });
    },
  });

  const investorPdfDownloadMutation = useMutation({
    mutationKey: stockIntelMutationKeys.investorPdfDownload,
    mutationFn: sourceApi.investorPdfDownload,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources.investorPdfStatus });
    },
  });

  async function runEdgarDownload(request: EdgarDownloadRequest) {
    setEdgarSyncError(null);
    try {
      const result = await edgarDownloadMutation.mutateAsync(request);
      setEdgarSyncResult(result);
    } catch (error) {
      setEdgarSyncError(error instanceof Error ? error.message : "EDGAR sync failed.");
    }
  }

  async function runInvestorPdfDownload(request: InvestorPdfDownloadRequest) {
    setInvestorPdfSyncError(null);
    try {
      const result = await investorPdfDownloadMutation.mutateAsync(request);
      setInvestorPdfSyncResult(result);
    } catch (error) {
      setInvestorPdfSyncError(error instanceof Error ? error.message : "Investor PDF sync failed.");
    }
  }

  return {
    activeStockIntelTab,
    edgarStatusError,
    edgarStatusQuery,
    edgarSyncError,
    edgarSyncing,
    edgarSyncResult,
    investorPdfStatusError,
    investorPdfStatusQuery,
    investorPdfSyncError,
    investorPdfSyncing,
    investorPdfSyncResult,
    runEdgarDownload,
    runInvestorPdfDownload,
    setActiveStockIntelTab,
  };
}
