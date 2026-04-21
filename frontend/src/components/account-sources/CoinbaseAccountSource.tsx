import type { PropsWithChildren } from "react";

import { AccountSource, AccountSourcePill, type AccountSourceTone } from "./AccountSource";

interface CoinbaseAccountSourceProps extends PropsWithChildren {
  collapsed: boolean;
  onToggle: () => void;
  statusLabel: string;
  statusTone: AccountSourceTone;
}

export function CoinbaseAccountSource({
  collapsed,
  onToggle,
  statusLabel,
  statusTone,
  children,
}: CoinbaseAccountSourceProps) {
  return (
    <AccountSource
      collapsed={collapsed}
      details={
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <AccountSourcePill label={statusLabel} tone={statusTone} />
        </div>
      }
      eyebrow="Coinbase source"
      onToggle={onToggle}
      title="Coinbase"
    >
      {children}
    </AccountSource>
  );
}
