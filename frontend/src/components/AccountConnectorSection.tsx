import type { PropsWithChildren, ReactNode } from "react";

import { AccountSource } from "./account-sources/AccountSource";

interface AccountConnectorSectionProps extends PropsWithChildren {
  title: string;
  eyebrow?: string;
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
  action?: ReactNode;
  details?: ReactNode;
}

export function AccountConnectorSection({
  title,
  eyebrow,
  collapsed,
  onToggle,
  className = "",
  action,
  details,
  children,
}: AccountConnectorSectionProps) {
  return (
    <AccountSource
      action={action}
      className={className}
      collapsed={collapsed}
      details={details}
      eyebrow={eyebrow}
      onToggle={onToggle}
      title={title}
    >
      {children}
    </AccountSource>
  );
}
