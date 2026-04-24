import { useEffect, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import type { ConnectorCatalogId } from "../../config/connectorCatalog";
import type { DashboardAccountKey } from "../../config/dashboardAccounts";
import { sourceApi } from "../../lib/api";
import { queryKeys } from "../../lib/queryKeys";
import type { FilesystemConnectorPortfolioResponse, FilesystemConnectorStatus, FilesystemDocumentFolderResponse } from "../../lib/types";

const CSV_FOLDER_CONNECTOR_ID: ConnectorCatalogId = "csvFolder";
const PDF_FOLDER_CONNECTOR_ID: ConnectorCatalogId = "pdfFolder";

export type ConnectorDraftState = {
  displayName: string;
  directoryPath: string;
  detectFooter: boolean;
};

type FilesystemConnectorConfigureVariables = {
  accountKey: DashboardAccountKey;
  connectorId: ConnectorCatalogId;
  displayName: string;
  directoryPath: string;
  detectFooter: boolean;
  sourceId?: string;
};

type UseConnectorSourcesArgs = {
  accountSettingsOpen: boolean;
  selectedDashboardAccountKey: DashboardAccountKey;
};

export function useConnectorSources({ accountSettingsOpen, selectedDashboardAccountKey }: UseConnectorSourcesArgs) {
  const queryClient = useQueryClient();
  const [connectorPickerOpen, setConnectorPickerOpen] = useState(false);
  const [connectorSetupError, setConnectorSetupError] = useState<string | null>(null);
  const [finnhubApiKeyInput, setFinnhubApiKeyInput] = useState("");
  const [connectorDraftsById, setConnectorDraftsById] = useState<Partial<Record<ConnectorCatalogId, ConnectorDraftState>>>({});

  const coinbaseStatusQuery = useQuery({
    queryKey: queryKeys.sources.coinbaseStatus,
    queryFn: sourceApi.coinbaseStatus,
    refetchInterval: 30_000,
  });

  const coinbasePortfolioQuery = useQuery({
    queryKey: queryKeys.sources.coinbasePortfolio,
    queryFn: sourceApi.coinbasePortfolio,
    enabled: coinbaseStatusQuery.data?.available ?? false,
    refetchInterval: 30_000,
  });

  const okxStatusQuery = useQuery({
    queryKey: queryKeys.sources.okxStatus,
    queryFn: sourceApi.okxStatus,
    refetchInterval: 30_000,
  });

  const finnhubStatusQuery = useQuery({
    queryKey: queryKeys.sources.finnhubStatus,
    queryFn: sourceApi.finnhubStatus,
    refetchInterval: 30_000,
  });

  const filesystemConnectorStatusesQuery = useQuery({
    queryKey: queryKeys.sources.filesystemConnectorStatuses(selectedDashboardAccountKey),
    queryFn: () => sourceApi.filesystemConnectorStatuses(selectedDashboardAccountKey),
    refetchInterval: 30_000,
  });
  const filesystemConnectorStatuses = filesystemConnectorStatusesQuery.data ?? [];
  const filesystemCsvConnectorStatuses = filesystemConnectorStatuses.filter((status) => status.connectorId === CSV_FOLDER_CONNECTOR_ID);
  const filesystemPdfConnectorStatuses = filesystemConnectorStatuses.filter((status) => status.connectorId === PDF_FOLDER_CONNECTOR_ID);

  const filesystemConnectorPortfolioQueries = useQueries({
    queries: filesystemCsvConnectorStatuses.map((connectorStatus) => ({
      queryKey: queryKeys.sources.filesystemConnectorPortfolio(selectedDashboardAccountKey, connectorStatus.sourceId),
      queryFn: () => sourceApi.filesystemConnectorPortfolio(selectedDashboardAccountKey, connectorStatus.sourceId),
      enabled: connectorStatus.connected,
      refetchInterval: 30_000,
    })),
  });

  const filesystemConnectorDocumentQueries = useQueries({
    queries: filesystemPdfConnectorStatuses.map((connectorStatus) => ({
      queryKey: queryKeys.sources.filesystemConnectorDocuments(selectedDashboardAccountKey, connectorStatus.sourceId),
      queryFn: () => sourceApi.filesystemConnectorDocuments(selectedDashboardAccountKey, connectorStatus.sourceId),
      enabled: connectorStatus.connected,
      refetchInterval: 30_000,
    })),
  });

  const finnhubConfigureMutation = useMutation({
    mutationFn: sourceApi.finnhubConfigure,
    onSuccess: async () => {
      setFinnhubApiKeyInput("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.sources.finnhubStatus }),
        queryClient.invalidateQueries({ queryKey: queryKeys.market.tickerOverview() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.market.tickerFinancials() }),
      ]);
    },
  });

  const filesystemConnectorConfigureMutation = useMutation({
    mutationFn: ({ accountKey, connectorId, displayName, directoryPath, detectFooter, sourceId }: FilesystemConnectorConfigureVariables) =>
      sourceApi.filesystemConnectorConfigure(accountKey, connectorId, { displayName, directoryPath, detectFooter }, sourceId),
    onSuccess: async (_data, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.sources.filesystemConnectorStatuses(variables.accountKey) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sources.filesystemConnectorPortfolio(variables.accountKey) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.sources.filesystemConnectorDocuments(variables.accountKey) }),
      ]);
    },
  });

  useEffect(() => {
    if (!accountSettingsOpen) {
      setConnectorPickerOpen(false);
      setConnectorSetupError(null);
    }
  }, [accountSettingsOpen]);

  useEffect(() => {
    if (!connectorPickerOpen) {
      return;
    }
    setConnectorDraftsById({});
  }, [connectorPickerOpen]);

  const filesystemConnectorStatusBySourceId = Object.fromEntries(
    filesystemConnectorStatuses.map((status) => [status.sourceId, status]),
  ) as Record<string, FilesystemConnectorStatus>;
  const filesystemConnectorPortfolioBySourceId = Object.fromEntries(
    filesystemConnectorPortfolioQueries.flatMap((query, index) => {
      const sourceId = filesystemCsvConnectorStatuses[index]?.sourceId;
      return sourceId && query.data ? [[sourceId, query.data]] : [];
    }),
  ) as Record<string, FilesystemConnectorPortfolioResponse>;
  const filesystemConnectorPortfolioLoadingBySourceId = Object.fromEntries(
    filesystemConnectorPortfolioQueries.flatMap((query, index) => {
      const sourceId = filesystemCsvConnectorStatuses[index]?.sourceId;
      return sourceId ? [[sourceId, query.isLoading]] : [];
    }),
  ) as Record<string, boolean>;
  const filesystemConnectorPortfolioErrorBySourceId = Object.fromEntries(
    filesystemConnectorPortfolioQueries.flatMap((query, index) => {
      const sourceId = filesystemCsvConnectorStatuses[index]?.sourceId;
      const error = query.error instanceof Error ? query.error.message : null;
      return sourceId ? [[sourceId, error]] : [];
    }),
  ) as Record<string, string | null>;
  const filesystemDocumentFolderBySourceId = Object.fromEntries(
    filesystemConnectorDocumentQueries.flatMap((query, index) => {
      const sourceId = filesystemPdfConnectorStatuses[index]?.sourceId;
      return sourceId && query.data ? [[sourceId, query.data]] : [];
    }),
  ) as Record<string, FilesystemDocumentFolderResponse>;
  const filesystemDocumentFolderLoadingBySourceId = Object.fromEntries(
    filesystemConnectorDocumentQueries.flatMap((query, index) => {
      const sourceId = filesystemPdfConnectorStatuses[index]?.sourceId;
      return sourceId ? [[sourceId, query.isLoading]] : [];
    }),
  ) as Record<string, boolean>;
  const filesystemDocumentFolderErrorBySourceId = Object.fromEntries(
    filesystemConnectorDocumentQueries.flatMap((query, index) => {
      const sourceId = filesystemPdfConnectorStatuses[index]?.sourceId;
      const error = query.error instanceof Error ? query.error.message : null;
      return sourceId ? [[sourceId, error]] : [];
    }),
  ) as Record<string, string | null>;

  return {
    coinbasePortfolioError: coinbasePortfolioQuery.error instanceof Error ? coinbasePortfolioQuery.error.message : null,
    coinbasePortfolioQuery,
    coinbaseStatusError: coinbaseStatusQuery.error instanceof Error ? coinbaseStatusQuery.error.message : null,
    coinbaseStatusQuery,
    connectorDraftsById,
    connectorPickerOpen,
    connectorSetupError,
    filesystemConnectorConfigureMutation,
    filesystemConnectorDocumentQueries,
    filesystemConnectorPortfolioBySourceId,
    filesystemConnectorPortfolioErrorBySourceId,
    filesystemConnectorPortfolioLoadingBySourceId,
    filesystemConnectorPortfolioQueries,
    filesystemConnectorStatusBySourceId,
    filesystemConnectorStatuses,
    filesystemConnectorStatusesError:
      filesystemConnectorStatusesQuery.error instanceof Error ? filesystemConnectorStatusesQuery.error.message : null,
    filesystemConnectorStatusesQuery,
    filesystemCsvConnectorStatuses,
    filesystemDocumentFolderBySourceId,
    filesystemDocumentFolderErrorBySourceId,
    filesystemDocumentFolderLoadingBySourceId,
    filesystemPdfConnectorStatuses,
    finnhubApiKeyInput,
    finnhubConfigureError: finnhubConfigureMutation.error instanceof Error ? finnhubConfigureMutation.error.message : null,
    finnhubConfigureMutation,
    finnhubStatusError: finnhubStatusQuery.error instanceof Error ? finnhubStatusQuery.error.message : null,
    finnhubStatusQuery,
    okxStatusError: okxStatusQuery.error instanceof Error ? okxStatusQuery.error.message : null,
    okxStatusQuery,
    setConnectorDraftsById,
    setConnectorPickerOpen,
    setConnectorSetupError,
    setFinnhubApiKeyInput,
  };
}
