import { EdgarWorkspace } from "../../components/EdgarWorkspace";
import { EdgarQwenWorkspace } from "../../components/EdgarQwenWorkspace";
import { InvestorPdfsWorkspace } from "../../components/InvestorPdfsWorkspace";
import { ChromeTabs } from "../../components/ui/ChromeTabs";
import { stockIntelTabs } from "./stockIntelTabs";
import { useStockIntelSync } from "./useStockIntelSync";

type StockIntelWorkspaceProps = {
  defaultTicker: string;
};

export function StockIntelWorkspace({ defaultTicker }: StockIntelWorkspaceProps) {
  const {
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
  } = useStockIntelSync();

  return (
    <>
      <ChromeTabs
        activeKey={activeStockIntelTab}
        ariaLabel="Stock Intel tools"
        onSelect={setActiveStockIntelTab}
        tabs={stockIntelTabs}
      />
      {activeStockIntelTab === "sec" ? (
        <EdgarWorkspace
          defaultTicker={defaultTicker}
          onRun={(request) => {
            void runEdgarSync(request);
          }}
          status={edgarStatusQuery.data}
          statusLoading={edgarStatusQuery.isLoading}
          statusError={edgarStatusError}
          syncError={edgarSyncError}
          syncResult={edgarSyncResult}
          syncing={edgarSyncing}
        />
      ) : activeStockIntelTab === "qwen" ? (
        <EdgarQwenWorkspace
          defaultTicker={defaultTicker}
          status={edgarStatusQuery.data}
          statusLoading={edgarStatusQuery.isLoading}
          statusError={edgarStatusError}
          syncResult={edgarSyncResult}
          syncing={edgarSyncing}
        />
      ) : (
        <InvestorPdfsWorkspace
          defaultTicker={defaultTicker}
          onRun={(request) => {
            void runInvestorPdfDownload(request);
          }}
          status={investorPdfStatusQuery.data}
          statusLoading={investorPdfStatusQuery.isLoading}
          statusError={investorPdfStatusError}
          syncError={investorPdfSyncError}
          syncResult={investorPdfSyncResult}
          syncing={investorPdfSyncing}
        />
      )}
    </>
  );
}
