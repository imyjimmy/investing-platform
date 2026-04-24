import type { ReactNode } from "react";

export type WorkspaceRoute<WorkspaceKey extends string> = {
  key: WorkspaceKey;
  render: () => ReactNode;
};

type WorkspaceRouterProps<WorkspaceKey extends string> = {
  activeWorkspace: WorkspaceKey;
  routes: Array<WorkspaceRoute<WorkspaceKey>>;
};

export function WorkspaceRouter<WorkspaceKey extends string>({ activeWorkspace, routes }: WorkspaceRouterProps<WorkspaceKey>) {
  const route = routes.find((candidate) => candidate.key === activeWorkspace);
  return <>{route?.render() ?? null}</>;
}
