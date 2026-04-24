import { useState } from "react";

import type { StockIntelTab } from "./stockIntelTabs";
import { useEdgarSync } from "./useEdgarSync";
import { useInvestorPdfSync } from "./useInvestorPdfSync";
import { useStockIntelSourceStatus } from "./useStockIntelSourceStatus";

export function useStockIntelSync() {
  const [activeStockIntelTab, setActiveStockIntelTab] = useState<StockIntelTab>("sec");
  const {
    edgarStatusError,
    edgarStatusQuery,
    edgarSyncing,
    investorPdfStatusError,
    investorPdfStatusQuery,
    investorPdfSyncing,
  } = useStockIntelSourceStatus();
  const { edgarSyncError, edgarSyncResult, runEdgarDownload } = useEdgarSync();
  const { investorPdfSyncError, investorPdfSyncResult, runInvestorPdfDownload } = useInvestorPdfSync();

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
