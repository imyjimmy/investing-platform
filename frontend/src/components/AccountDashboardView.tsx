import type { ReactNode } from "react";

import {
  DASHBOARD_ACCOUNTS,
  getDashboardAccountByKey,
  type DashboardAccountKey,
} from "../config/dashboardAccounts";
import { WorkspaceFrame } from "./shell/WorkspaceFrame";
import { ChromeTabs } from "./ui/ChromeTabs";

interface AccountDashboardViewProps {
  selectedAccountKey: DashboardAccountKey;
  accountSettingsOpen: boolean;
  onSelectAccount: (accountKey: DashboardAccountKey) => void;
  onToggleSettings: () => void;
  headerStatusIndicatorClassName: string;
  headerStatusLabel: string;
  headerRouteLabel: string;
  summaryContent: ReactNode;
  settingsContent: ReactNode;
  bodyContent: ReactNode;
}

export function AccountDashboardView({
  selectedAccountKey,
  accountSettingsOpen,
  onSelectAccount,
  onToggleSettings,
  headerStatusIndicatorClassName,
  headerStatusLabel,
  headerRouteLabel,
  summaryContent,
  settingsContent,
  bodyContent,
}: AccountDashboardViewProps) {
  const selectedAccount = getDashboardAccountByKey(selectedAccountKey);

  const tabsSlot = (
    <ChromeTabs
      activeKey={selectedAccount.key}
      ariaLabel="Dashboard accounts"
      onSelect={onSelectAccount}
      tabs={DASHBOARD_ACCOUNTS.map((account) => ({ key: account.key, label: account.name }))}
    />
  );
  const header = (
    <>
      <button
        aria-expanded={accountSettingsOpen}
        aria-label={accountSettingsOpen ? "Return to account page" : "Open account settings"}
        className={`absolute right-10 top-3 inline-flex h-8 w-8 items-center justify-center transition ${
          accountSettingsOpen ? "rounded-md bg-accent/10 text-accent" : "rounded-md text-muted hover:text-text"
        }`}
        onClick={onToggleSettings}
        type="button"
      >
        <GearIcon />
      </button>

      <div className="flex flex-col gap-4 pr-12">
        <div>
          <div className="mb-2 text-[11px] uppercase tracking-[0.32em] text-accent">{selectedAccount.headerEyebrow}</div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-text">
              {accountSettingsOpen ? `${selectedAccount.name} Settings` : selectedAccount.name}
            </h1>
          </div>
          {accountSettingsOpen ? (
            <p className="mt-2 max-w-3xl text-sm text-muted">
              {`Manage the account-bound connectors and defaults for ${selectedAccount.name}.`}
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted">
              <div className="inline-flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${headerStatusIndicatorClassName}`} />
                <span>{headerStatusLabel}</span>
              </div>
              <div>{headerRouteLabel}</div>
            </div>
          )}
        </div>
      </div>

      {!accountSettingsOpen ? (
        <div className="mt-6">
          <h2 className="text-2xl font-semibold tracking-tight text-text">Account Summary</h2>
          <div className="mt-4">{summaryContent}</div>
        </div>
      ) : null}
    </>
  );

  return (
    <WorkspaceFrame
      bodyClassName="account-workspace-body flex flex-col gap-6 px-10 pt-6 pb-6 lg:px-12"
      header={header}
      headerClassName="chrome-header-body relative px-10 py-5 lg:px-12"
      panelClassName="account-workspace panel rounded-[16px]"
      tabsSlot={tabsSlot}
    >
      {accountSettingsOpen ? settingsContent : bodyContent}
    </WorkspaceFrame>
  );
}

function GearIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 20 20" width="20">
      <path
        d="M8.1 3.2h3.8l.45 1.75a5.9 5.9 0 0 1 1.15.67l1.67-.86 1.9 3.28-1.35 1.25c.04.24.06.47.06.71s-.02.47-.06.71l1.35 1.25-1.9 3.28-1.67-.86a5.9 5.9 0 0 1-1.15.67l-.45 1.75H8.1l-.45-1.75a5.9 5.9 0 0 1-1.15-.67l-1.67.86-1.9-3.28 1.35-1.25A4.8 4.8 0 0 1 4.2 10c0-.24.02-.47.06-.71L2.91 8.04l1.9-3.28 1.67.86c.36-.27.74-.5 1.15-.67z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.35"
      />
      <circle cx="10" cy="10" r="2.35" stroke="currentColor" strokeWidth="1.35" />
    </svg>
  );
}
