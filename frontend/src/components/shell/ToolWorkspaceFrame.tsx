import type { ReactNode } from "react";

type ToolWorkspaceFrameProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  headerSlot?: ReactNode;
  titleRowSlot?: ReactNode;
  titleEndSlot?: ReactNode;
  children: ReactNode;
  compact?: boolean;
};

export function ToolWorkspaceFrame({
  title,
  eyebrow,
  description,
  headerSlot,
  titleRowSlot,
  titleEndSlot,
  children,
  compact = false,
}: ToolWorkspaceFrameProps) {
  return (
    <div className="chrome-header-frame">
      <div className="account-workspace panel overflow-hidden rounded-[16px]">
        <header className={compact ? "border-b border-line/70 px-4 py-6 lg:px-5" : "border-b border-line/70 px-10 py-7 lg:px-12"}>
          <div className="grid gap-4">
            {titleRowSlot ? (
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
                <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
                  <div className="shrink-0">
                    {eyebrow ? <div className="mb-1 text-[11px] uppercase tracking-[0.28em] text-muted">{eyebrow}</div> : null}
                    <div className="flex flex-wrap items-center gap-3">
                      <h1 className="text-3xl font-semibold tracking-tight text-text">{title}</h1>
                    </div>
                  </div>
                  <div className="min-w-0 lg:w-full lg:max-w-[56rem] lg:flex-[0_1_56rem]">{titleRowSlot}</div>
                </div>
                {titleEndSlot ? <div className="shrink-0">{titleEndSlot}</div> : null}
              </div>
            ) : (
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
                <div className="min-w-0 flex-1">
                  {eyebrow ? <div className="mb-1 text-[11px] uppercase tracking-[0.28em] text-muted">{eyebrow}</div> : null}
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="text-3xl font-semibold tracking-tight text-text">{title}</h1>
                  </div>
                </div>
              </div>
            )}
            {description ? <p className="max-w-3xl text-sm text-muted">{description}</p> : null}
            {headerSlot}
          </div>
        </header>

        <section className={compact ? "px-4 py-6 lg:px-5" : "px-10 py-8 lg:px-12"}>{children}</section>
      </div>
    </div>
  );
}
