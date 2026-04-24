export type ChromeTabItem<T extends string> = {
  key: T;
  label: string;
  disabled?: boolean;
};

type ChromeTabsProps<T extends string> = {
  activeKey: T;
  ariaLabel?: string;
  onSelect: (key: T) => void;
  tabs: Array<ChromeTabItem<T>>;
  variant?: "attached" | "inline";
};

export function ChromeTabs<T extends string>({ activeKey, ariaLabel, onSelect, tabs, variant = "attached" }: ChromeTabsProps<T>) {
  return (
    <div className={`chrome-tabs-shell ${variant === "inline" ? "is-inline" : ""}`}>
      <div aria-label={ariaLabel} className="chrome-tab-strip" role="tablist">
        {tabs.map((tab) => {
          const active = tab.key === activeKey;
          return (
            <button
              key={tab.key}
              aria-current={active ? "page" : undefined}
              aria-selected={active}
              className={`chrome-tab ${active ? "is-active" : ""} ${tab.disabled ? "is-disabled" : ""}`}
              disabled={tab.disabled}
              onClick={() => onSelect(tab.key)}
              role="tab"
              type="button"
            >
              <span className="chrome-tab-title truncate text-sm font-medium">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
