import { DASHBOARD_ACCOUNTS } from "../../config/dashboardAccounts";
import type { ConnectionStatus } from "../../lib/types";

export type TradingAccountOption = {
  key: string;
  label: string;
  accountId: string | null;
  disabled: boolean;
};

export function buildTradingAccountOptions(
  connectionStatus: ConnectionStatus | undefined,
  selectedAccount: string | undefined,
): TradingAccountOption[] {
  const routeAccountIds = uniqueAccountIds([
    ...(connectionStatus?.managedAccounts ?? []),
    connectionStatus?.accountId,
    selectedAccount,
  ]);
  return DASHBOARD_ACCOUNTS.map((account) => {
    const accountId = account.routeAccountIds.find((routeAccountId) => routeAccountIds.includes(routeAccountId)) ?? null;
    return {
      key: account.key,
      label: account.name,
      accountId,
      disabled: !connectionStatus?.connected || !accountId,
    };
  });
}

export function activeTradingAccount(options: TradingAccountOption[], selectedAccount: string | undefined) {
  const enabledOptions = options.filter((option) => !option.disabled && option.accountId);
  return options.find((option) => !option.disabled && option.accountId === selectedAccount) ?? enabledOptions[0] ?? null;
}

function uniqueAccountIds(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim().toUpperCase() ?? "").filter(Boolean)));
}
