import { MetricCard } from "../../components/MetricCard";
import { ToolWorkspaceFrame } from "../../components/shell/ToolWorkspaceFrame";
import { ErrorState } from "../../components/ui/ErrorState";
import { formatTimestamp, fmtCurrency } from "../../lib/formatters";
import { useCryptoMajors } from "./useCryptoMajors";

export function CryptoMarketWorkspace() {
  const cryptoMajorsQuery = useCryptoMajors();

  return (
    <ToolWorkspaceFrame
      description="Track the crypto market without jumping directly into one account's holdings. Account-owned balances stay on the dashboard."
      title="Crypto Market"
    >
      {cryptoMajorsQuery.isLoading ? (
        <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">Loading BTC and ETH prices...</div>
      ) : cryptoMajorsQuery.error instanceof Error ? (
        <ErrorState message={cryptoMajorsQuery.error.message} />
      ) : cryptoMajorsQuery.data ? (
        <div className="grid gap-6">
          <div className="grid gap-4 md:grid-cols-2">
            {cryptoMajorsQuery.data.quotes.map((quote) => (
              <div key={quote.symbol} className="rounded-[20px] border border-line/80 bg-panelSoft px-6 py-6">
                <div className="text-[11px] uppercase tracking-[0.28em] text-accent">{quote.name}</div>
                <div className="mt-2 text-sm text-muted">{quote.symbol}/USD</div>
                <div className="mt-6 text-4xl font-semibold tracking-tight text-text">{fmtCurrency(quote.priceUsd)}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Source" value={cryptoMajorsQuery.data.source} />
            <MetricCard label="Assets" value={`${cryptoMajorsQuery.data.quotes.length} majors`} />
            <MetricCard label="Updated" value={formatTimestamp(cryptoMajorsQuery.data.generatedAt)} />
            <MetricCard label="Account overlay" value="Off" />
          </div>

          {cryptoMajorsQuery.data.sourceNotice ? (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm ${
                cryptoMajorsQuery.data.isStale
                  ? "border-caution/25 bg-caution/8 text-caution"
                  : "border-line/80 bg-panelSoft text-muted"
              }`}
            >
              {cryptoMajorsQuery.data.sourceNotice}
            </div>
          ) : null}
        </div>
      ) : (
        <ErrorState message="Crypto prices are unavailable." />
      )}
    </ToolWorkspaceFrame>
  );
}
