import { type KeyboardEvent, type ReactNode } from "react";

type SourceTone = "live" | "off" | "planned";

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

type AppSidebarProps = {
  activeWorkspace: WorkspaceSurface;
  onSelectWorkspace: (workspace: WorkspaceSurface) => void;
};

export function AppSidebarNavigation({ activeWorkspace, onSelectWorkspace }: AppSidebarProps) {
  return (
    <div className="shell-source-list">
      <ShellSourceGroup title="Stocks">
        <ShellSourceRow
          active={activeWorkspace === "market"}
          icon={<MarketIcon />}
          onSelect={() => onSelectWorkspace("market")}
          testId="nav-stocks-market"
          title="Market"
          tone="live"
        />

        <ShellSourceRow
          active={activeWorkspace === "ticker"}
          icon={<BrokerIcon />}
          onSelect={() => onSelectWorkspace("ticker")}
          testId="nav-stocks-ticker"
          title="Ticker"
          tone="live"
        />

        <ShellSourceRow
          active={activeWorkspace === "stockIntel"}
          icon={<DocumentIcon />}
          onSelect={() => onSelectWorkspace("stockIntel")}
          testId="nav-stocks-intel"
          title="Stock Intel"
          tone="live"
        />

        <ShellSourceSubsection title="Options" />

        <ShellSourceRow
          active={activeWorkspace === "options"}
          icon={<OptionsIcon />}
          onSelect={() => onSelectWorkspace("options")}
          testId="nav-options-chain"
          title="Chain"
          tone="live"
        />

        <ShellSourceRow
          active={activeWorkspace === "optionsValuation"}
          icon={<ValuationIcon />}
          onSelect={() => onSelectWorkspace("optionsValuation")}
          testId="nav-options-valuation"
          title="Valuation"
          tone="live"
        />

        <ShellSourceRow
          active={activeWorkspace === "optionsBuilder"}
          icon={<BuilderIcon />}
          onSelect={() => onSelectWorkspace("optionsBuilder")}
          testId="nav-options-builder"
          title="Builder"
          tone="live"
        />

        <ShellSourceRow
          active={activeWorkspace === "optionsStructures"}
          icon={<StructuresIcon />}
          onSelect={() => onSelectWorkspace("optionsStructures")}
          testId="nav-options-structures"
          title="Structures"
          tone="live"
        />

        <ShellSourceRow
          active={activeWorkspace === "optionsVolatility"}
          icon={<VolatilityIcon />}
          onSelect={() => onSelectWorkspace("optionsVolatility")}
          testId="nav-options-volatility"
          title="Volatility"
          tone="live"
        />

        <ShellSourceRow
          active={activeWorkspace === "optionsScanner"}
          icon={<ScannerIcon />}
          onSelect={() => onSelectWorkspace("optionsScanner")}
          testId="nav-options-scanner"
          title="Scanner"
          tone="live"
        />
      </ShellSourceGroup>

      <ShellSourceGroup title="Crypto">
        <ShellSourceRow
          active={activeWorkspace === "crypto"}
          icon={<MarketIcon />}
          onSelect={() => onSelectWorkspace("crypto")}
          title="Market"
          tone="live"
        />

        <ShellSourceRow
          active={activeWorkspace === "cryptoLeverage"}
          icon={<LeverageIcon />}
          onSelect={() => onSelectWorkspace("cryptoLeverage")}
          title="Leverage"
          tone="live"
        />
      </ShellSourceGroup>
    </div>
  );
}

export function AppSidebarFooter({ activeWorkspace, onSelectWorkspace }: AppSidebarProps) {
  return (
    <button
      className={`shell-settings-row ${activeWorkspace === "globalSettings" ? "is-active" : ""}`}
      onClick={() => onSelectWorkspace("globalSettings")}
      type="button"
    >
      <span className="shell-row-icon">
        <GearIcon />
      </span>
      <span className="shell-settings-label">Global Settings</span>
    </button>
  );
}

function ShellSourceGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="shell-source-group" data-testid={`shell-group-${slugifyTestId(title)}`}>
      <div className="shell-source-group-title">{title}</div>
      <div className="shell-source-group-list">{children}</div>
    </section>
  );
}

function ShellSourceSubsection({ title }: { title: string }) {
  return (
    <div className="shell-source-subsection" aria-hidden="true">
      <span>{title}</span>
    </div>
  );
}

function ShellSourceRow({
  title,
  icon,
  tone,
  active = false,
  children,
  onSelect,
  testId,
}: {
  title: string;
  icon?: ReactNode;
  tone: SourceTone;
  active?: boolean;
  children?: ReactNode;
  onSelect?: () => void;
  testId?: string;
}) {
  const interactiveProps = onSelect
    ? {
        onClick: onSelect,
        onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        },
        role: "button" as const,
        tabIndex: 0,
      }
    : {};

  return (
    <section
      className={`shell-source-row ${active ? "is-active" : ""} is-${tone} ${onSelect ? "is-selectable" : ""}`}
      data-testid={testId}
      {...interactiveProps}
    >
      <div className="shell-source-top">
        {icon ? <span className="shell-row-icon">{icon}</span> : null}
        <div className="shell-source-copy">
          <div className="shell-source-title">{title}</div>
        </div>
      </div>
      {children ? (
        <div
          className="shell-source-extra"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

function slugifyTestId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function BrokerIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M4 14.5h12" opacity="0.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <path d="M5 12V8.5M10 12V5.5M15 12V7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  );
}

function MarketIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M4.2 14.8h11.6" opacity="0.45" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <path d="m4.8 12.3 2.8-2.7 2.4 1.9 4.4-4.7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" />
      <path d="M12.6 6.8h2.9v2.9" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M6.5 3.75h4.8l2.7 2.7v9.8H6.5z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M11.3 3.75v2.9h2.7" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.5" />
      <path d="M8.3 10h4.8M8.3 12.8h4.1" opacity="0.55" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  );
}

function OptionsIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M4.25 14.75h11.5" opacity="0.45" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <path d="M6.2 11.7c1.15-2.6 2.67-3.9 4.55-3.9 1.36 0 2.54.63 3.55 1.9" stroke="currentColor" strokeLinecap="round" strokeWidth="1.55" />
      <circle cx="6" cy="12" r="1.1" fill="currentColor" />
      <circle cx="14.2" cy="9.6" r="1.1" fill="currentColor" />
    </svg>
  );
}

function ValuationIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M4.1 15.1h11.8" opacity="0.45" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
      <path d="M5.2 12.5 8 8.1l2.35 2.3 4.45-5.4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" />
      <path d="M12.6 5h2.2v2.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.45" />
      <circle cx="7.8" cy="8.2" fill="currentColor" r="0.9" />
      <circle cx="10.4" cy="10.4" fill="currentColor" r="0.9" />
    </svg>
  );
}

function BuilderIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M5.2 5.2h9.6M5.2 10h9.6M5.2 14.8h9.6" opacity="0.45" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
      <path d="M6 14.2 9.5 7l2.25 4.4L14 6.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" />
    </svg>
  );
}

function StructuresIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <rect height="4.4" rx="1.4" stroke="currentColor" strokeWidth="1.4" width="4.4" x="3.7" y="4" />
      <rect height="4.4" rx="1.4" stroke="currentColor" strokeWidth="1.4" width="4.4" x="11.9" y="4" />
      <rect height="4.4" rx="1.4" stroke="currentColor" strokeWidth="1.4" width="4.4" x="7.8" y="11.6" />
      <path d="M8.1 6.2h3.8M10 8.4v3.2" opacity="0.55" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
    </svg>
  );
}

function VolatilityIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M4 14.6h12" opacity="0.45" stroke="currentColor" strokeLinecap="round" strokeWidth="1.35" />
      <path d="M4.8 11.5c1.3 0 1.3-5.9 2.6-5.9s1.3 8.8 2.6 8.8 1.3-6.9 2.6-6.9 1.3 4 2.6 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.55" />
    </svg>
  );
}

function ScannerIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <circle cx="8.6" cy="8.6" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="m12 12 3.5 3.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
      <path d="M6.5 8.4h4.2M8.6 6.3v4.2" opacity="0.55" stroke="currentColor" strokeLinecap="round" strokeWidth="1.25" />
    </svg>
  );
}

function LeverageIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 20 20" width="18">
      <path d="M4.2 14.8h11.6" opacity="0.45" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
      <path d="M5.3 11.8 8.1 7.5l3.2 3 3.4-5.2" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" />
      <path d="M13.15 5.3h1.55v1.55" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.55" />
      <path d="M6 6.2v6.1M10 8.4v3.9M14 4.9v7.4" opacity="0.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.2" />
    </svg>
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
