import rawDashboardAccounts from "./dashboardAccounts.json";

export type DashboardAttachedSourceId = "coinbase";

export type DashboardAccountConfig = {
  key: string;
  name: string;
  headerEyebrow: string;
  routeAccountIds: string[];
  attachedSourceIds: DashboardAttachedSourceId[];
  netContributionsUsd: number | null;
};

export type DashboardAccountKey = DashboardAccountConfig["key"];

const FALLBACK_DASHBOARD_ACCOUNTS: DashboardAccountConfig[] = [
  {
    key: "primary",
    name: "Primary",
    headerEyebrow: "Configured brokerage account",
    routeAccountIds: [],
    attachedSourceIds: [],
    netContributionsUsd: null,
  },
];

export const DASHBOARD_ACCOUNTS = loadDashboardAccounts();
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

function loadDashboardAccounts(): DashboardAccountConfig[] {
  const envConfig = import.meta.env.VITE_DASHBOARD_ACCOUNTS_JSON;
  if (envConfig) {
    const parsed = parseDashboardAccounts(envConfig);
    if (parsed.length) {
      return parsed;
    }
  }
  const parsed = normalizeDashboardAccounts(rawDashboardAccounts);
  return parsed.length ? parsed : FALLBACK_DASHBOARD_ACCOUNTS;
}

function parseDashboardAccounts(value: string): DashboardAccountConfig[] {
  try {
    return normalizeDashboardAccounts(JSON.parse(value));
  } catch {
    return [];
  }
}

function normalizeDashboardAccounts(value: unknown): DashboardAccountConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const raw = item as Partial<Record<keyof DashboardAccountConfig, unknown>>;
      const key = typeof raw.key === "string" ? raw.key.trim() : "";
      const name = typeof raw.name === "string" ? raw.name.trim() : "";
      if (!key || !name) {
        return null;
      }
      return {
        key,
        name,
        headerEyebrow:
          typeof raw.headerEyebrow === "string" && raw.headerEyebrow.trim()
            ? raw.headerEyebrow.trim()
            : "Configured investing account",
        routeAccountIds: normalizeStringList(raw.routeAccountIds),
        attachedSourceIds: normalizeAttachedSourceIds(raw.attachedSourceIds),
        netContributionsUsd: normalizeOptionalNumber(raw.netContributionsUsd),
      };
    })
    .filter((account): account is DashboardAccountConfig => Boolean(account));
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => (typeof item === "string" ? item.trim().toUpperCase() : "")).filter(Boolean);
}

function normalizeAttachedSourceIds(value: unknown): DashboardAttachedSourceId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is DashboardAttachedSourceId => item === "coinbase");
}

function normalizeOptionalNumber(value: unknown): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  return value;
}
