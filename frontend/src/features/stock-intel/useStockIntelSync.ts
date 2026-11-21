import { useStockIntelSession } from "./StockIntelSession";
import { useInvestorPdfSync } from "./useInvestorPdfSync";
import { useStockIntelSourceStatus } from "./useStockIntelSourceStatus";

export function useStockIntelSync() {
  const { activeStockIntelTab, setActiveStockIntelTab, filingSync } = useStockIntelSession();
  const {
    edgarStatusError,
    edgarStatusQuery,
    edgarSyncing,
    investorPdfStatusError,
    investorPdfStatusQuery,
    investorPdfSyncing,
  } = useStockIntelSourceStatus();
  const { edgarSyncError, edgarSyncResult, runEdgarSync } = filingSync;
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
    runEdgarSync,
    runInvestorPdfDownload,
    setActiveStockIntelTab,
  };
}
