import rawDashboardAccounts from "./dashboardAccounts.json";

export type DashboardAttachedSourceId = "coinbase";

export type DashboardAccountConfig = {
  key: string;
  name: string;
  headerEyebrow: string;
  routeAccountIds: string[];
  attachedSourceIds: DashboardAttachedSourceId[];
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

export function dashboardAccountHasAttachedSource(
  account: DashboardAccountConfig | null | undefined,
  sourceId: DashboardAttachedSourceId,
) {
  return Boolean(account?.attachedSourceIds.includes(sourceId));
}

export function getDashboardAccountWithAttachedSource(sourceId: DashboardAttachedSourceId) {
  return DASHBOARD_ACCOUNTS.find((account) => account.attachedSourceIds.includes(sourceId)) ?? null;
}
