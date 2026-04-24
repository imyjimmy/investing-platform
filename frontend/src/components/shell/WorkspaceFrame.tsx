import type { ReactNode } from "react";

import {
  workspaceBodyClassName,
  workspaceFrameClassName,
  workspaceHeaderClassName,
  workspacePanelClassName,
} from "./WorkspaceStage";

type WorkspaceFrameProps = {
  children: ReactNode;
  header?: ReactNode;
  tabsSlot?: ReactNode;
  bodyClassName?: string | null;
  headerClassName?: string;
  panelClassName?: string;
};

export function WorkspaceFrame({
  children,
  header,
  tabsSlot,
  bodyClassName = workspaceBodyClassName,
  headerClassName = workspaceHeaderClassName,
  panelClassName = workspacePanelClassName,
}: WorkspaceFrameProps) {
  return (
    <div className={workspaceFrameClassName}>
      {tabsSlot}
      <div className={panelClassName}>
        {header ? <header className={headerClassName}>{header}</header> : null}
        {bodyClassName === null ? children : <section className={bodyClassName}>{children}</section>}
      </div>
    </div>
  );
}
