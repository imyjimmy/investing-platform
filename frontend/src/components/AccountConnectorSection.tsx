import type { PropsWithChildren } from "react";

import { Panel } from "./Panel";

interface AccountConnectorSectionProps extends PropsWithChildren {
  title: string;
  eyebrow?: string;
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
}

export function AccountConnectorSection({
  title,
  eyebrow,
  collapsed,
  onToggle,
  className = "",
  children,
}: AccountConnectorSectionProps) {
  return (
    <Panel
      className={className}
      eyebrow={eyebrow}
      title={
        <div className="flex items-center gap-3">
          <span>{title}</span>
          <button
            aria-expanded={!collapsed}
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-line/70 bg-panelSoft text-muted transition hover:border-accent/30 hover:text-text"
            onClick={onToggle}
            type="button"
          >
            <ChevronIcon collapsed={collapsed} />
          </button>
        </div>
      }
    >
      {!collapsed ? children : null}
    </Panel>
  );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      style={{ transform: collapsed ? "rotate(0deg)" : "rotate(180deg)", transition: "transform 180ms ease" }}
      viewBox="0 0 16 16"
      width="16"
    >
      <path d="m4 6 4 4 4-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}
