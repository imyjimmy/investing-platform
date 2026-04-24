import { EdgarWorkspace } from "../../components/EdgarWorkspace";
import { InvestorPdfsWorkspace } from "../../components/InvestorPdfsWorkspace";
import { ChromeTabs } from "../../components/ui/ChromeTabs";
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
    runEdgarDownload,
    runInvestorPdfDownload,
    setActiveStockIntelTab,
  } = useStockIntelSync();

  return (
    <>
      <ChromeTabs
        activeKey={activeStockIntelTab}
        ariaLabel="Stock Intel tools"
        onSelect={setActiveStockIntelTab}
        tabs={[
          { key: "sec", label: "SEC Tool" },
          { key: "companyPdfs", label: "Company PDFs" },
        ]}
      />
      {activeStockIntelTab === "sec" ? (
        <EdgarWorkspace
          defaultTicker={defaultTicker}
          onRun={(request) => {
            void runEdgarDownload(request);
          }}
          status={edgarStatusQuery.data}
          statusLoading={edgarStatusQuery.isLoading}
          statusError={edgarStatusError}
          syncError={edgarSyncError}
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
