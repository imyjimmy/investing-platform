import { useQuery } from "@tanstack/react-query";

import { sourceApi } from "../../lib/api";
import { queryKeys } from "../../lib/queryKeys";
import type { EdgarWorkspaceRequest } from "../../lib/types";

export function useEdgarIntelligenceStatus({
  enabled = true,
  jobId,
  request,
}: {
  enabled?: boolean;
  jobId?: string | null;
  request: EdgarWorkspaceRequest | null;
}) {
  const query = useQuery({
    queryKey: queryKeys.sources.edgarIntelligenceStatus(request, jobId ?? undefined),
    queryFn: () => {
      if (!request) {
        throw new Error("Select an EDGAR workspace before checking Qwen readiness.");
      }
      return sourceApi.edgarIntelligenceStatus(request, jobId ?? undefined);
    },
    enabled: enabled && request !== null,
    staleTime: 10_000,
    refetchInterval: 15_000,
    retry: false,
  });

  return {
    edgarIntelligenceStatus: query.data,
    edgarIntelligenceStatusError: query.error instanceof Error ? query.error.message : null,
    edgarIntelligenceStatusQuery: query,
  };
}
