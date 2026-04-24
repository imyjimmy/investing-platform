import { MetricCard } from "../../components/MetricCard";
import { Panel } from "../../components/Panel";
import { ToolWorkspaceFrame } from "../../components/shell/ToolWorkspaceFrame";
import { InlinePill } from "../../components/ui/InlinePill";

export function CryptoLeverageWorkspace() {
  return (
    <ToolWorkspaceFrame
      description="Watch derivatives-led pressure, crowding, and forced-unwind risk without opening directly into exchange account balances."
      eyebrow="Crypto"
      title="Crypto Leverage"
    >
      <div className="grid gap-6">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard hint="Aggregate BTC and ETH perpetual open interest placeholder until derivatives feeds are connected." label="Open Interest" value="$28.4B" />
          <MetricCard hint="Weighted funding snapshot across major perpetual venues." label="Funding" value="0.018%" />
          <MetricCard hint="Perpetual premium versus spot across the major crypto pair set." label="Basis" value="4.2%" />
          <MetricCard hint="Directional pressure estimate; not tied to an account connector." label="Crowding" value="Long-heavy" />
        </div>

        <Panel eyebrow="Derivatives Context" title="Leverage Map">
          <div className="grid gap-3">
            {[
              { label: "BTC perpetuals", detail: "Open interest expanding while funding sits modestly positive.", tone: "caution" as const },
              { label: "ETH perpetuals", detail: "Funding is calm, basis remains constructive, and liquidation pressure is contained.", tone: "safe" as const },
              { label: "Alt majors", detail: "Crowding read is pending until broader exchange coverage is connected.", tone: "neutral" as const },
            ].map((row) => (
              <div key={row.label} className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-sm font-medium text-text">{row.label}</div>
                    <div className="mt-1 text-sm text-muted">{row.detail}</div>
                  </div>
                  <InlinePill label={row.tone === "safe" ? "Stable" : row.tone === "caution" ? "Watch" : "Planned"} tone={row.tone} />
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="Source Model" title="Data Boundary">
          <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
            This workspace is intentionally market-native. Exchange connectors can provide data later, but the sidebar entry stays a crypto leverage tool rather than a connector or balances page.
          </div>
        </Panel>
      </div>
    </ToolWorkspaceFrame>
  );
}
