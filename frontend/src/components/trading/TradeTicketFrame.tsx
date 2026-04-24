import type { ReactNode } from "react";

type TradeTicketFrameProps = {
  children: ReactNode;
  title: string;
  eyebrow?: string;
  titleEndSlot?: ReactNode;
};

export function TradeTicketFrame({ children, title, eyebrow = "Trade Ticket", titleEndSlot }: TradeTicketFrameProps) {
  return (
    <div className="rounded-2xl border border-line/80 bg-panel px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-muted">{eyebrow}</div>
          <div className="mt-1 text-lg font-semibold text-text">{title}</div>
        </div>
        {titleEndSlot}
      </div>

      {children}
    </div>
  );
}
