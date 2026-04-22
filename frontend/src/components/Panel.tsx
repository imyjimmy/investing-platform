import type { PropsWithChildren, ReactNode } from "react";

interface PanelProps extends PropsWithChildren {
  title: ReactNode;
  eyebrow?: string;
  action?: ReactNode;
  className?: string;
  topDivider?: boolean;
}

export function Panel({ title, eyebrow, action, className = "", topDivider = true, children }: PanelProps) {
  return (
    <section className={`workspace-section ${topDivider ? "" : "workspace-section--flush"} section-anchor animate-rise ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          {eyebrow ? <div className="mb-1 text-[11px] uppercase tracking-[0.28em] text-muted">{eyebrow}</div> : null}
          <h2 className="text-lg font-semibold text-text">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
