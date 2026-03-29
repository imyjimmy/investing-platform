import type { ConnectionStatus } from "../lib/types";

export function StatusBadge({ status }: { status: ConnectionStatus | undefined }) {
  const tone =
    status?.connected ? "border-safe/30 bg-safe/10 text-safe" : "border-danger/30 bg-danger/10 text-danger";
  const label = status?.connected ? `${status.marketDataMode} ${status.mode.toUpperCase()}` : "DISCONNECTED";
  return <span className={`rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${tone}`}>{label}</span>;
}
