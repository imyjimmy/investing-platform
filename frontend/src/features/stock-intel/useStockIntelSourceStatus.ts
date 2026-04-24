import { useIsMutating, useQuery } from "@tanstack/react-query";

import { sourceApi } from "../../lib/api";
import { queryKeys } from "../../lib/queryKeys";
import { stockIntelMutationKeys } from "./stockIntelKeys";

export function useStockIntelSourceStatus() {
  const edgarStatusQuery = useQuery({
    queryKey: queryKeys.sources.edgarStatus,
    queryFn: sourceApi.edgarStatus,
  });

  const investorPdfStatusQuery = useQuery({
    queryKey: queryKeys.sources.investorPdfStatus,
    queryFn: sourceApi.investorPdfStatus,
  });

  const edgarSyncing = useIsMutating({ mutationKey: stockIntelMutationKeys.edgarDownload }) > 0;
  const investorPdfSyncing = useIsMutating({ mutationKey: stockIntelMutationKeys.investorPdfDownload }) > 0;

  return {
    edgarStatusError: edgarStatusQuery.error instanceof Error ? edgarStatusQuery.error.message : null,
    edgarStatusQuery,
    edgarSyncing,
    investorPdfStatusError: investorPdfStatusQuery.error instanceof Error ? investorPdfStatusQuery.error.message : null,
    investorPdfStatusQuery,
    investorPdfSyncing,
  };
}
