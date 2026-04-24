import type { ReactNode } from "react";

import {
  workspaceEyebrowClassName,
  workspaceTitleClassName,
} from "./WorkspaceStage";
import { WorkspaceFrame } from "./WorkspaceFrame";

type ToolWorkspaceFrameProps = {
  title: string;
  eyebrow?: string;
  description?: string;
  headerSlot?: ReactNode;
  titleMetaSlot?: ReactNode;
  titleRowSlot?: ReactNode;
  titleEndSlot?: ReactNode;
  children: ReactNode;
};

export function ToolWorkspaceFrame({
  title,
  eyebrow,
  description,
  headerSlot,
  titleMetaSlot,
  titleRowSlot,
  titleEndSlot,
  children,
}: ToolWorkspaceFrameProps) {
  const header = (
    <div className="grid gap-4">
      {titleRowSlot ? (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between lg:gap-4">
          <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
            <div className="shrink-0">
              {eyebrow ? <div className={workspaceEyebrowClassName}>{eyebrow}</div> : null}
              <div className="flex flex-wrap items-center gap-3">
                <h1 className={workspaceTitleClassName}>{title}</h1>
                {titleMetaSlot}
              </div>
            </div>
            <div className="min-w-0 lg:w-full lg:max-w-[56rem] lg:flex-[0_1_56rem]">{titleRowSlot}</div>
          </div>
          {titleEndSlot ? <div className="shrink-0">{titleEndSlot}</div> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
          <div className="min-w-0 flex-1">
            {eyebrow ? <div className={workspaceEyebrowClassName}>{eyebrow}</div> : null}
            <div className="flex flex-wrap items-center gap-3">
              <h1 className={workspaceTitleClassName}>{title}</h1>
              {titleMetaSlot}
            </div>
          </div>
          {titleEndSlot ? <div className="shrink-0">{titleEndSlot}</div> : null}
        </div>
      )}
      {description ? <p className="max-w-3xl text-sm text-muted">{description}</p> : null}
      {headerSlot}
    </div>
  );

  return <WorkspaceFrame header={header}>{children}</WorkspaceFrame>;
}
