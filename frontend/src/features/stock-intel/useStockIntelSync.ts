import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { sourceApi } from "../../lib/api";
import { queryKeys } from "../../lib/queryKeys";
import type {
  EdgarDownloadRequest,
  EdgarDownloadResponse,
  InvestorPdfDownloadRequest,
  InvestorPdfDownloadResponse,
} from "../../lib/types";

export type StockIntelTab = "sec" | "companyPdfs";

export function useStockIntelSync() {
  const queryClient = useQueryClient();
  const [activeStockIntelTab, setActiveStockIntelTab] = useState<StockIntelTab>("sec");
  const [edgarSyncing, setEdgarSyncing] = useState(false);
  const [edgarSyncResult, setEdgarSyncResult] = useState<EdgarDownloadResponse | undefined>(undefined);
  const [edgarSyncError, setEdgarSyncError] = useState<string | null>(null);
  const [investorPdfSyncing, setInvestorPdfSyncing] = useState(false);
  const [investorPdfSyncResult, setInvestorPdfSyncResult] = useState<InvestorPdfDownloadResponse | undefined>(undefined);
  const [investorPdfSyncError, setInvestorPdfSyncError] = useState<string | null>(null);

  const edgarStatusQuery = useQuery({
    queryKey: queryKeys.sources.edgarStatus,
    queryFn: sourceApi.edgarStatus,
  });

  const investorPdfStatusQuery = useQuery({
    queryKey: queryKeys.sources.investorPdfStatus,
    queryFn: sourceApi.investorPdfStatus,
  });

  const edgarDownloadMutation = useMutation({
    mutationFn: sourceApi.edgarDownload,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources.edgarStatus });
    },
  });

  const investorPdfDownloadMutation = useMutation({
    mutationFn: sourceApi.investorPdfDownload,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources.investorPdfStatus });
    },
  });

  async function runEdgarDownload(request: EdgarDownloadRequest) {
    setEdgarSyncing(true);
    setEdgarSyncError(null);
    try {
      const result = await edgarDownloadMutation.mutateAsync(request);
      setEdgarSyncResult(result);
    } catch (error) {
      setEdgarSyncError(error instanceof Error ? error.message : "EDGAR sync failed.");
    } finally {
      setEdgarSyncing(false);
    }
  }

  async function runInvestorPdfDownload(request: InvestorPdfDownloadRequest) {
    setInvestorPdfSyncing(true);
    setInvestorPdfSyncError(null);
    try {
      const result = await investorPdfDownloadMutation.mutateAsync(request);
      setInvestorPdfSyncResult(result);
    } catch (error) {
      setInvestorPdfSyncError(error instanceof Error ? error.message : "Investor PDF sync failed.");
    } finally {
      setInvestorPdfSyncing(false);
    }
  }

  return {
    activeStockIntelTab,
    edgarStatusError: edgarStatusQuery.error instanceof Error ? edgarStatusQuery.error.message : null,
    edgarStatusQuery,
    edgarSyncError,
    edgarSyncing,
    edgarSyncResult,
    investorPdfStatusError: investorPdfStatusQuery.error instanceof Error ? investorPdfStatusQuery.error.message : null,
    investorPdfStatusQuery,
    investorPdfSyncError,
    investorPdfSyncing,
    investorPdfSyncResult,
    runEdgarDownload,
    runInvestorPdfDownload,
    setActiveStockIntelTab,
  };
}
