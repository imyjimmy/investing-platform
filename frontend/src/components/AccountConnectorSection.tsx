import type { PropsWithChildren, ReactNode } from "react";

import { Panel } from "./Panel";

interface AccountConnectorSectionProps extends PropsWithChildren {
  title: string;
  eyebrow?: string;
  collapsed: boolean;
  onToggle: () => void;
  detail?: string;
  status?: ReactNode;
  className?: string;
}

export function AccountConnectorSection({
  title,
  eyebrow,
  collapsed,
  onToggle,
  detail,
  status,
  className = "",
  children,
}: AccountConnectorSectionProps) {
  return (
    <Panel
      action={
        <div className="flex flex-wrap items-center justify-end gap-3">
          {status}
          {detail ? <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{detail}</div> : null}
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
      className={className}
      eyebrow={eyebrow}
      title={title}
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
      style={{ transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)", transition: "transform 180ms ease" }}
      viewBox="0 0 16 16"
      width="16"
    >
      <path d="m4 6 4 4 4-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
    </svg>
  );
}
