import type { ReactNode } from "react";

export const workspaceFrameClassName = "chrome-header-frame";
export const workspacePanelClassName = "account-workspace panel overflow-hidden rounded-[16px]";
export const workspaceHeaderClassName = "workspace-frame-header";
export const workspaceBodyClassName = "workspace-frame-body";
export const workspaceDividedBodyClassName = "workspace-frame-body workspace-frame-body--divided";
export const workspaceEyebrowClassName = "workspace-frame-eyebrow";
export const workspaceTitleClassName = "workspace-frame-title";

type WorkspaceStageProps = {
  children: ReactNode;
};

export function WorkspaceStage({ children }: WorkspaceStageProps) {
  return <div className="workspace-stage-inner mx-auto w-full">{children}</div>;
}
