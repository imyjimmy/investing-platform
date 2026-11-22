import type { ReactNode } from "react";
import { DASHBOARD_ACCOUNTS } from "../../config/dashboardAccounts";
import { ShellIcon, type ShellIconName } from "./ShellIcon";
import { isBoolean, useShellPreference } from "./useShellPreferences";

export type WorkspaceSurface =
  | "dashboard"
  | "market"
  | "ticker"
  | "options"
  | "optionsValuation"
  | "optionsBuilder"
  | "optionsStructures"
  | "optionsVolatility"
  | "optionsScanner"
  | "crypto"
  | "cryptoLeverage"
  | "stockIntel"
  | "globalSettings";
export type WorkspaceLink = {
  key: WorkspaceSurface;
  title: string;
  group: string;
  icon: ShellIconName;
  testId?: string;
};
export const WORKSPACE_LINKS: WorkspaceLink[] = [
  { key: "dashboard", title: "Dashboard", group: "Workspace", icon: "home" },
  {
    key: "market",
    title: "Market",
    group: "Stocks",
    icon: "market",
    testId: "nav-stocks-market",
  },
  {
    key: "ticker",
    title: "Ticker",
    group: "Stocks",
    icon: "ticker",
    testId: "nav-stocks-ticker",
  },
  {
    key: "stockIntel",
    title: "Stock Intel",
    group: "Stocks",
    icon: "document",
    testId: "nav-stocks-intel",
  },
  {
    key: "options",
    title: "Chain",
    group: "Options",
    icon: "options",
    testId: "nav-options-chain",
  },
  {
    key: "optionsValuation",
    title: "Valuation",
    group: "Options",
    icon: "market",
    testId: "nav-options-valuation",
  },
  {
    key: "optionsBuilder",
    title: "Builder",
    group: "Options",
    icon: "builder",
    testId: "nav-options-builder",
  },
  {
    key: "optionsStructures",
    title: "Structures",
    group: "Options",
    icon: "grid",
    testId: "nav-options-structures",
  },
  {
    key: "optionsVolatility",
    title: "Volatility",
    group: "Options",
    icon: "wave",
    testId: "nav-options-volatility",
  },
  {
    key: "optionsScanner",
    title: "Scanner",
    group: "Options",
    icon: "search",
    testId: "nav-options-scanner",
  },
  {
    key: "crypto",
    title: "Market",
    group: "Crypto",
    icon: "crypto",
    testId: "nav-crypto-market",
  },
  {
    key: "cryptoLeverage",
    title: "Leverage",
    group: "Crypto",
    icon: "market",
    testId: "nav-crypto-leverage",
  },
  {
    key: "globalSettings",
    title: "Global Settings",
    group: "Workspace",
    icon: "settings",
  },
];
export const workspaceLabel = (key: WorkspaceSurface) => {
  const item = WORKSPACE_LINKS.find((link) => link.key === key)!;
  return item.group === "Workspace"
    ? item.title
    : `${item.group} · ${item.title}`;
};

export type AppSidebarProps = {
  activeWorkspace: WorkspaceSurface;
  onSelectWorkspace: (workspace: WorkspaceSurface) => void;
  selectedAccountKey: string;
  onSelectAccount: (key: string) => void;
  recentWorkspaces: WorkspaceSurface[];
  search: string;
};

export function AppSidebarNavigation({
  activeWorkspace,
  onSelectWorkspace,
  selectedAccountKey,
  onSelectAccount,
  recentWorkspaces,
  search,
}: AppSidebarProps) {
  const query = search.trim().toLowerCase();
  const matches = (text: string) => text.toLowerCase().includes(query);
  const accounts = DASHBOARD_ACCOUNTS.filter((account) =>
    matches(account.name),
  );
  const tools = WORKSPACE_LINKS.filter((item) =>
    matches(`${item.group} ${item.title}`),
  );
  return (
    <nav aria-label="Investing workspaces" className="shell-source-list">
      {accounts.length ? (
        <NavGroup title="Accounts" forceOpen={Boolean(query)}>
          {accounts.map((account) => (
            <button
              key={account.key}
              className={`shell-nav-row ${activeWorkspace === "dashboard" && selectedAccountKey === account.key ? "is-active" : ""}`}
              aria-current={
                activeWorkspace === "dashboard" &&
                selectedAccountKey === account.key
                  ? "page"
                  : undefined
              }
              onClick={() => onSelectAccount(account.key)}
              type="button"
            >
              <span className="shell-account-icon">
                <ShellIcon name="account" />
              </span>
              <span>{account.name}</span>
            </button>
          ))}
        </NavGroup>
      ) : null}
      {(query
        ? ["Workspace", "Stocks", "Options", "Crypto"]
        : ["Stocks", "Options", "Crypto"]
      ).map((group) => {
        const links = tools.filter((item) => item.group === group);
        return links.length ? (
          <NavGroup key={group} title={group} forceOpen={Boolean(query)}>
            {links.map((item) => (
              <NavRow
                key={item.key}
                item={item}
                active={activeWorkspace === item.key}
                onSelect={onSelectWorkspace}
              />
            ))}
          </NavGroup>
        ) : null;
      })}
      {!query && recentWorkspaces.length ? (
        <NavGroup title="Recents">
          {recentWorkspaces.map((key) => (
            <button
              className="shell-nav-row shell-recent-row"
              key={key}
              onClick={() => onSelectWorkspace(key)}
              type="button"
            >
              <ShellIcon name="clock" />
              <span>{workspaceLabel(key)}</span>
            </button>
          ))}
        </NavGroup>
      ) : null}
      {query && !tools.length && !accounts.length ? (
        <p className="shell-search-empty">
          No workspaces found for “{search}”.
        </p>
      ) : null}
    </nav>
  );
}

function NavRow({
  item,
  active,
  onSelect,
}: {
  item: WorkspaceLink;
  active: boolean;
  onSelect: (key: WorkspaceSurface) => void;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={`shell-nav-row ${active ? "is-active" : ""}`}
      data-testid={item.testId}
      onClick={() => onSelect(item.key)}
      type="button"
    >
      <ShellIcon name={item.icon} />
      <span>{item.title}</span>
    </button>
  );
}

function NavGroup({
  title,
  children,
  forceOpen = false,
}: {
  title: string;
  children: ReactNode;
  forceOpen?: boolean;
}) {
  const [collapsed, setCollapsed] = useShellPreference(
    `investing.shell.group.${title}.v1`,
    false,
    isBoolean,
  );
  const open = forceOpen || !collapsed;
  return (
    <section
      className="shell-source-group"
      aria-label={title}
      data-testid={`shell-group-${title.toLowerCase()}`}
    >
      <button
        aria-expanded={open}
        aria-controls={`shell-group-${title}`}
        className="shell-group-heading"
        onClick={() => setCollapsed((value) => !value)}
        disabled={forceOpen}
        type="button"
      >
        <span>{title}</span>
        <span className={open ? "is-expanded" : ""}>
          <ShellIcon name="chevron" />
        </span>
      </button>
      {open ? (
        <div id={`shell-group-${title}`} className="shell-source-group-list">
          {children}
        </div>
      ) : null}
    </section>
  );
}
