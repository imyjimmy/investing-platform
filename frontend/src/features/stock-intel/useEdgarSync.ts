import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { sourceApi } from "../../lib/api";
import { queryKeys } from "../../lib/queryKeys";
import type { EdgarDownloadRequest, EdgarDownloadResponse } from "../../lib/types";
import { stockIntelMutationKeys } from "./stockIntelKeys";

export function useEdgarSync() {
  const queryClient = useQueryClient();
  const [syncResult, setSyncResult] = useState<EdgarDownloadResponse | undefined>(undefined);
  const [syncError, setSyncError] = useState<string | null>(null);
  const mutation = useMutation({
    mutationKey: stockIntelMutationKeys.edgarDownload,
    mutationFn: sourceApi.edgarDownload,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources.edgarStatus });
    },
  });

  async function runEdgarDownload(request: EdgarDownloadRequest) {
    setSyncError(null);
    try {
      const result = await mutation.mutateAsync(request);
      setSyncResult(result);
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : "EDGAR sync failed.");
    }
  }

  return {
    edgarSyncError: syncError,
    edgarSyncResult: syncResult,
    edgarSyncing: mutation.isPending,
    runEdgarDownload,
  };
}
