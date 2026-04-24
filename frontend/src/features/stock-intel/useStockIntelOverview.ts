import { useMemo } from "react";

import { useStockIntelSourceStatus } from "./useStockIntelSourceStatus";

export type StockIntelSourceOverview = {
  countsTowardHealth: boolean;
  detail: string;
  id: "edgar" | "investor-pdfs";
  status: string;
  title: string;
  tone: "safe" | "caution" | "danger";
};

export function useStockIntelOverview() {
  const {
    edgarStatusError,
    edgarStatusQuery,
    edgarSyncing,
    investorPdfStatusError,
    investorPdfStatusQuery,
    investorPdfSyncing,
  } = useStockIntelSourceStatus();

  const sourceCards = useMemo<StockIntelSourceOverview[]>(
    () => [
      {
        id: "edgar",
        title: "EDGAR",
        status: edgarStatusQuery.isLoading ? "Checking" : edgarSyncing ? "Syncing" : edgarStatusQuery.data?.available ? "Ready" : "Offline",
        detail: edgarStatusQuery.isLoading ? "Loading SEC filing source state" : edgarStatusError ?? "SEC filing research source",
        tone: edgarStatusQuery.isLoading ? "caution" : edgarStatusQuery.data?.available ? "safe" : "danger",
        countsTowardHealth: true,
      },
      {
        id: "investor-pdfs",
        title: "Investor PDFs",
        status: investorPdfStatusQuery.isLoading
          ? "Checking"
          : investorPdfSyncing
            ? "Syncing"
            : investorPdfStatusQuery.data?.available
              ? "Ready"
              : "Offline",
        detail: investorPdfStatusQuery.isLoading
          ? "Loading investor PDF source state"
          : investorPdfStatusError ?? "Annual reports and exhibit PDF library",
        tone: investorPdfStatusQuery.isLoading ? "caution" : investorPdfStatusQuery.data?.available ? "safe" : "danger",
        countsTowardHealth: true,
      },
    ],
    [
      edgarStatusError,
      edgarStatusQuery.data?.available,
      edgarStatusQuery.isLoading,
      edgarSyncing,
      investorPdfStatusError,
      investorPdfStatusQuery.data?.available,
      investorPdfStatusQuery.isLoading,
      investorPdfSyncing,
    ],
  );

  return {
    researchRootPath: edgarStatusQuery.data?.researchRootPath ?? investorPdfStatusQuery.data?.researchRootPath ?? null,
    sourceCards,
  };
}
