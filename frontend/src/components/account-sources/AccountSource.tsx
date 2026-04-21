import type { PropsWithChildren, ReactNode } from "react";

import { Panel } from "../Panel";

export type AccountSourceTone = "neutral" | "safe" | "caution" | "danger" | "accent";

export interface AccountSourceProps extends PropsWithChildren {
  title: string;
  eyebrow?: string;
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
  action?: ReactNode;
  details?: ReactNode;
}

const pillToneClasses: Record<AccountSourceTone, string> = {
  neutral: "border-line/70 bg-panelSoft text-muted",
  safe: "border-safe/25 bg-safe/10 text-safe",
  caution: "border-caution/25 bg-caution/10 text-caution",
  danger: "border-danger/25 bg-danger/10 text-danger",
  accent: "border-accent/25 bg-accent/10 text-accent",
};

export function AccountSource({
  title,
  eyebrow,
  collapsed,
  onToggle,
  className = "",
  action,
  details,
  children,
}: AccountSourceProps) {
  return (
    <Panel
      action={action}
      className={className}
      eyebrow={eyebrow}
      title={
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
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
          {details ? <div>{details}</div> : null}
        </div>
      }
    >
      {!collapsed ? children : null}
    </Panel>
  );
}

export function AccountSourcePill({ label, tone = "neutral" }: { label: string; tone?: AccountSourceTone }) {
  return (
    <span className={`inline-flex rounded-full border px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] ${pillToneClasses[tone]}`}>
      {label}
    </span>
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
