import rawDashboardAccounts from "./dashboardAccounts.json";

export type PlannedAccountConnectorId = "plaidFidelity" | "plaidChase";

export type DashboardAccountConfig = {
  key: string;
  name: string;
  headerEyebrow: string;
  routeAccountIds: string[];
  dashboardSections: {
    coinbase: boolean;
  };
  plannedConnectors: PlannedAccountConnectorId[];
};

export type DashboardAccountKey = DashboardAccountConfig["key"];

export const DASHBOARD_ACCOUNTS = rawDashboardAccounts as DashboardAccountConfig[];
export const DEFAULT_DASHBOARD_ACCOUNT_KEY: DashboardAccountKey = DASHBOARD_ACCOUNTS[0]?.key ?? "";

export function getDashboardAccountByKey(accountKey: DashboardAccountKey | null | undefined) {
  return DASHBOARD_ACCOUNTS.find((account) => account.key === accountKey) ?? DASHBOARD_ACCOUNTS[0];
}

export function getDashboardAccountForRoute(routedAccount: string | null | undefined) {
  if (!routedAccount) {
    return null;
  }
  const normalizedRouteAccount = routedAccount.trim().toUpperCase();
  return DASHBOARD_ACCOUNTS.find((account) => account.routeAccountIds.includes(normalizedRouteAccount)) ?? null;
}

export function dashboardAccountOwnsRoute(accountKey: DashboardAccountKey, routedAccount: string | null | undefined) {
  if (!routedAccount) {
    return false;
  }
  const normalizedRouteAccount = routedAccount.trim().toUpperCase();
  const account = getDashboardAccountByKey(accountKey);
  return Boolean(account?.routeAccountIds.includes(normalizedRouteAccount));
}

export function getDashboardAccountWithCoinbase() {
  return DASHBOARD_ACCOUNTS.find((account) => account.dashboardSections.coinbase) ?? null;
}
