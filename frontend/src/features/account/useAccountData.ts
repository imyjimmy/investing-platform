import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { accountApi } from "../../lib/api";
import { queryKeys } from "../../lib/queryKeys";

function uniqueAccounts(accounts: Array<string | null | undefined>) {
  return Array.from(new Set(accounts.map((accountId) => accountId?.trim().toUpperCase()).filter(Boolean) as string[]));
}

export function useAccountData() {
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(undefined);

  const connectionQuery = useQuery({
    queryKey: queryKeys.account.connectionStatus,
    queryFn: accountApi.connectionStatus,
    refetchInterval: 10_000,
  });

  const riskSummaryQuery = useQuery({
    queryKey: queryKeys.account.riskSummary(selectedAccountId),
    queryFn: () => accountApi.riskSummary(selectedAccountId),
    refetchInterval: false,
  });

  const positionsQuery = useQuery({
    queryKey: queryKeys.account.positions(selectedAccountId),
    queryFn: () => accountApi.positions(selectedAccountId),
    refetchInterval: false,
  });

  const optionPositionsQuery = useQuery({
    queryKey: queryKeys.account.optionPositions(selectedAccountId),
    queryFn: () => accountApi.optionPositions(selectedAccountId),
    refetchInterval: false,
  });

  const openOrdersQuery = useQuery({
    queryKey: queryKeys.account.openOrders(selectedAccountId),
    queryFn: () => accountApi.openOrders(selectedAccountId),
    refetchInterval: false,
  });

  const connectMutation = useMutation({ mutationFn: accountApi.connect });
  const reconnectMutation = useMutation({ mutationFn: accountApi.reconnect });

  useEffect(() => {
    const availableAccounts = uniqueAccounts([
      ...(connectionQuery.data?.managedAccounts ?? []),
      connectionQuery.data?.accountId,
      riskSummaryQuery.data?.account.accountId,
    ]);
    if (availableAccounts.length === 0) {
      return;
    }
    if (!selectedAccountId || !availableAccounts.includes(selectedAccountId)) {
      setSelectedAccountId(availableAccounts[0]);
    }
  }, [connectionQuery.data?.accountId, connectionQuery.data?.managedAccounts, riskSummaryQuery.data?.account.accountId, selectedAccountId]);

  const risk = riskSummaryQuery.data;
  const positions = positionsQuery.data?.positions ?? [];
  const optionPositions = optionPositionsQuery.data?.positions ?? [];
  const openOrders = openOrdersQuery.data?.orders ?? [];
  const accountId = risk?.account.accountId ?? connectionQuery.data?.accountId ?? null;
  const executionEnabled = connectionQuery.data?.executionMode === "enabled";
  const selectedAccount = selectedAccountId ?? accountId ?? undefined;

  return {
    accountId,
    connectMutation,
    connectionQuery,
    executionEnabled,
    openOrders,
    openOrdersQuery,
    optionPositions,
    optionPositionsQuery,
    positions,
    positionsQuery,
    reconnectMutation,
    risk,
    riskSummaryQuery,
    selectedAccount,
    selectedAccountId,
    setSelectedAccountId,
  };
}
