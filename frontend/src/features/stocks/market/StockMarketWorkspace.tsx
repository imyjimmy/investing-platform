import { startTransition, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { MetricCard } from "../../../components/MetricCard";
import { Panel } from "../../../components/Panel";
import { ToolWorkspaceFrame } from "../../../components/shell/ToolWorkspaceFrame";
import { InlinePill, type InlinePillTone } from "../../../components/ui/InlinePill";
import { fmtBillions, fmtCurrencySmall, fmtMillions, fmtNumber, fmtWholeNumber } from "../../../lib/formatters";
import type { UniverseCandidate } from "../../../lib/types";
import { useMarketUniverse } from "./useMarketUniverse";

type MarketSector = string;

type MarketSortKey = "beta" | "avgDollarVolumeM" | "return20dPct" | "return60dPct" | "compositeScore" | "ivToHv20";
type MarketPreset = "high-beta" | "iv-watch" | "liquid-leaders" | "reset";
type MarketTargetWorkspace = "ticker" | "options";

type MarketRow = {
  symbol: string;
  name: string;
  sector: MarketSector;
  price: number | null;
  beta: number | null;
  return20dPct: number | null;
  return60dPct: number | null;
  avgDollarVolumeM: number | null;
  marketCapB: number | null;
  ivToHv20: number | null;
  optionVolume: number | null;
  compositeScore: number | null;
  eligible: boolean;
  whyItRanked: string | null;
};

type StockMarketWorkspaceProps = {
  gatewayPill: { label: string; tone: InlinePillTone };
  onOpenSymbol: (symbol: string, workspace: MarketTargetWorkspace) => void;
};

const MARKET_SORT_OPTIONS: Array<{ key: MarketSortKey; label: string }> = [
  { key: "beta", label: "Highest beta" },
  { key: "avgDollarVolumeM", label: "Most liquid" },
  { key: "return20dPct", label: "Strongest 20D move" },
  { key: "return60dPct", label: "Strongest 60D move" },
  { key: "compositeScore", label: "Highest score" },
  { key: "ivToHv20", label: "Highest IV/HV" },
];

export function StockMarketWorkspace({ gatewayPill, onOpenSymbol }: StockMarketWorkspaceProps) {
  const marketUniverseQuery = useMarketUniverse();
  const [marketMinBeta, setMarketMinBeta] = useState(1.7);
  const [marketMinPrice, setMarketMinPrice] = useState(10);
  const [marketMinDollarVolumeM, setMarketMinDollarVolumeM] = useState(200);
  const [marketMinIvToHv20, setMarketMinIvToHv20] = useState(0);
  const [marketSearch, setMarketSearch] = useState("");
  const [marketSectorFilter, setMarketSectorFilter] = useState<MarketSector | "All">("All");
  const [marketSortKey, setMarketSortKey] = useState<MarketSortKey>("beta");
  const [marketEligibleOnly, setMarketEligibleOnly] = useState(true);

  const marketRows = useMemo(() => (marketUniverseQuery.data?.rows ?? []).map(toMarketRow), [marketUniverseQuery.data?.rows]);
  const marketSectors = useMemo(
    () => Array.from(new Set(marketRows.map((row) => row.sector).filter(Boolean))).sort(),
    [marketRows],
  );

  const marketScreenRows = useMemo(() => {
    const marketSearchNeedle = marketSearch.trim().toLowerCase();
    return marketRows
      .filter((row) => !marketSearchNeedle || row.symbol.toLowerCase().includes(marketSearchNeedle) || row.name.toLowerCase().includes(marketSearchNeedle))
      .filter((row) => (row.beta ?? 0) >= marketMinBeta)
      .filter((row) => (row.price ?? 0) >= marketMinPrice)
      .filter((row) => (row.avgDollarVolumeM ?? 0) >= marketMinDollarVolumeM)
      .filter((row) => (row.ivToHv20 ?? 0) >= marketMinIvToHv20)
      .filter((row) => marketSectorFilter === "All" || row.sector === marketSectorFilter)
      .filter((row) => !marketEligibleOnly || row.eligible)
      .slice()
      .sort((left, right) => {
        const delta = sortableMarketValue(right, marketSortKey) - sortableMarketValue(left, marketSortKey);
        if (Math.abs(delta) > 0.0001) {
          return delta;
        }
        return (right.beta ?? 0) - (left.beta ?? 0);
      });
  }, [
    marketEligibleOnly,
    marketMinBeta,
    marketMinDollarVolumeM,
    marketMinIvToHv20,
    marketMinPrice,
    marketRows,
    marketSearch,
    marketSectorFilter,
    marketSortKey,
  ]);
  const marketTopRows = marketScreenRows.slice(0, 12);
  const marketChartRows = marketScreenRows.filter((row) => row.beta != null).slice(0, 8).map((row) => ({
    symbol: row.symbol,
    beta: row.beta ?? 0,
  }));
  const averageScreenBeta =
    averageNullable(marketScreenRows.map((row) => row.beta));
  const averageScreenVolume =
    averageNullable(marketScreenRows.map((row) => row.avgDollarVolumeM));
  const highVelocityCount = marketScreenRows.filter((row) => (row.beta ?? 0) >= 2).length;
  const topScreenSymbol = marketScreenRows[0] ?? null;
  const advancingCount = marketScreenRows.filter((row) => (row.return20dPct ?? 0) > 0).length;
  const decliningCount = marketScreenRows.filter((row) => (row.return20dPct ?? 0) < 0).length;
  const elevatedIvCount = marketScreenRows.filter((row) => (row.ivToHv20 ?? 0) >= 1.2).length;
  const marketSectorMix = Array.from(
    marketScreenRows.reduce((accumulator, row) => {
      accumulator.set(row.sector, (accumulator.get(row.sector) ?? 0) + 1);
      return accumulator;
    }, new Map<MarketSector, number>()),
  )
    .map(([sector, count]) => ({ sector, count }))
    .sort((left, right) => right.count - left.count);
  const marketCandidateRows = marketScreenRows
    .slice()
    .sort((left, right) => {
      const scoreLeft = candidateScore(left);
      const scoreRight = candidateScore(right);
      return scoreRight - scoreLeft;
    })
    .slice(0, 5);

  function applyMarketPreset(preset: MarketPreset) {
    startTransition(() => {
      if (preset === "high-beta") {
        setMarketSearch("");
        setMarketMinBeta(1.9);
        setMarketMinPrice(10);
        setMarketMinDollarVolumeM(200);
        setMarketMinIvToHv20(0);
        setMarketSectorFilter("All");
        setMarketSortKey("beta");
        setMarketEligibleOnly(true);
        return;
      }
      if (preset === "iv-watch") {
        setMarketSearch("");
        setMarketMinBeta(1.3);
        setMarketMinPrice(5);
        setMarketMinDollarVolumeM(150);
        setMarketMinIvToHv20(1.2);
        setMarketSectorFilter("All");
        setMarketSortKey("ivToHv20");
        setMarketEligibleOnly(true);
        return;
      }
      if (preset === "liquid-leaders") {
        setMarketSearch("");
        setMarketMinBeta(1.3);
        setMarketMinPrice(20);
        setMarketMinDollarVolumeM(800);
        setMarketMinIvToHv20(0);
        setMarketSectorFilter("All");
        setMarketSortKey("avgDollarVolumeM");
        setMarketEligibleOnly(true);
        return;
      }
      setMarketSearch("");
      setMarketMinBeta(1.7);
      setMarketMinPrice(10);
      setMarketMinDollarVolumeM(200);
      setMarketMinIvToHv20(0);
      setMarketSectorFilter("All");
      setMarketSortKey("beta");
      setMarketEligibleOnly(true);
    });
  }

  return (
    <ToolWorkspaceFrame
      description="Screen the US stock universe by beta, crowding, and liquidity, then push the names that matter into `Ticker` or `Options` without detouring through the dashboard."
      eyebrow="Stocks"
      headerSlot={
        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-muted">
          <InlinePill label={`Gateway session · ${gatewayPill.label.toLowerCase()}`} tone={gatewayPill.tone} />
          <InlinePill
            label={
              marketUniverseQuery.isLoading
                ? "Universe · loading"
                : marketUniverseQuery.data
                  ? `Universe · ${marketUniverseQuery.data.snapshotDate}`
                  : "Universe · unavailable"
            }
            tone={marketUniverseQuery.data?.isStale ? "caution" : marketUniverseQuery.error ? "danger" : "neutral"}
          />
          <InlinePill label="Overlay account · off" tone="neutral" />
        </div>
      }
      title="Market"
    >
      <div className="grid gap-6">
        <Panel eyebrow="Universe" title="US Stock Screener" topDivider={false}>
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-5">
            <label className="panel-soft rounded-2xl p-4">
              <div className="mb-3 text-[11px] uppercase tracking-[0.22em] text-muted">Search</div>
              <input
                className="w-full rounded-xl border border-line/80 bg-panel px-3 py-3 text-sm text-text outline-none transition focus:border-accent/60"
                data-testid="market-search-input"
                onChange={(event) => setMarketSearch(event.target.value.toUpperCase())}
                placeholder="Symbol or company"
                spellCheck={false}
                type="text"
                value={marketSearch}
              />
              <div className="mt-3 text-xs text-muted">Search works across ticker and company name.</div>
            </label>
            <RangeField label="Min beta" max={3} min={1} onChange={setMarketMinBeta} step={0.05} value={marketMinBeta} />
            <RangeField label="Min price" max={200} min={5} onChange={setMarketMinPrice} step={5} value={marketMinPrice} />
            <RangeField
              label="Min avg $ volume (M)"
              max={2000}
              min={50}
              onChange={setMarketMinDollarVolumeM}
              step={25}
              value={marketMinDollarVolumeM}
            />
            <RangeField
              label="Min IV/HV"
              max={3}
              min={0}
              onChange={setMarketMinIvToHv20}
              step={0.05}
              value={marketMinIvToHv20}
            />
          </div>
          {marketUniverseQuery.error ? (
            <div className="mt-4 rounded-2xl border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger">
              {marketUniverseQuery.error instanceof Error ? marketUniverseQuery.error.message : "Could not load the market universe."}
            </div>
          ) : marketUniverseQuery.data?.sourceNotice ? (
            <div className="mt-4 rounded-2xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-muted">
              {marketUniverseQuery.data.sourceNotice}
            </div>
          ) : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded-full border border-accent/25 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:border-accent/45 hover:bg-accent/16"
                data-testid="market-preset-high-beta"
                onClick={() => applyMarketPreset("high-beta")}
                type="button"
              >
                High beta
              </button>
              <button
                className="rounded-full border border-line/80 bg-panelSoft px-3 py-1.5 text-xs font-medium text-muted transition hover:border-accent/25 hover:text-text"
                data-testid="market-preset-iv-watch"
                onClick={() => applyMarketPreset("iv-watch")}
                type="button"
              >
                IV watch
              </button>
              <button
                className="rounded-full border border-line/80 bg-panelSoft px-3 py-1.5 text-xs font-medium text-muted transition hover:border-accent/25 hover:text-text"
                data-testid="market-preset-liquid-leaders"
                onClick={() => applyMarketPreset("liquid-leaders")}
                type="button"
              >
                Liquid leaders
              </button>
              <button
                className="rounded-full border border-line/80 bg-panelSoft px-3 py-1.5 text-xs font-medium text-muted transition hover:border-accent/25 hover:text-text"
                data-testid="market-preset-reset"
                onClick={() => applyMarketPreset("reset")}
                type="button"
              >
                Reset screen
              </button>
              <ToggleChip checked={marketEligibleOnly} label="Eligible only" onToggle={() => setMarketEligibleOnly((value) => !value)} />
            </div>

            <div className="panel-soft rounded-2xl p-4">
              <div className="mb-3 text-[11px] uppercase tracking-[0.22em] text-muted">Sort and sector</div>
              <select
                className="w-full rounded-xl border border-line/80 bg-panel px-3 py-3 text-sm text-text outline-none transition focus:border-accent/60"
                onChange={(event) => setMarketSectorFilter(event.target.value as MarketSector | "All")}
                value={marketSectorFilter}
              >
                <option value="All">All sectors</option>
                {marketSectors.map((sector) => (
                  <option key={sector} value={sector}>
                    {sector}
                  </option>
                ))}
              </select>
              <div className="mt-3 text-[11px] uppercase tracking-[0.22em] text-muted">Sort</div>
              <select
                className="mt-2 w-full rounded-xl border border-line/80 bg-panel px-3 py-3 text-sm text-text outline-none transition focus:border-accent/60"
                onChange={(event) => setMarketSortKey(event.target.value as MarketSortKey)}
                value={marketSortKey}
              >
                {MARKET_SORT_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="mt-3 text-xs text-muted">The screen stays stock-universe first. Drill into one name only after it survives the market filter.</div>
            </div>
          </div>
        </Panel>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard hint="Names matching the current screen." label="Matches" value={fmtWholeNumber(marketScreenRows.length)} />
          <MetricCard hint="Average beta across the visible results." label="Avg beta" value={fmtNumber(averageScreenBeta)} />
          <MetricCard hint="Average daily dollar volume for this filtered set." label="Avg $ volume" value={averageScreenVolume != null ? `$${fmtMillions(averageScreenVolume)}` : "-"} />
          <MetricCard hint="Names with weekly momentum still pointing up." label="Advancers" value={fmtWholeNumber(advancingCount)} />
          <MetricCard
            hint={topScreenSymbol ? `${topScreenSymbol.name} · ${topScreenSymbol.sector}` : "No symbols currently match the screen."}
            label="Top result"
            value={topScreenSymbol ? `${topScreenSymbol.symbol} · ${fmtNumber(topScreenSymbol.beta)}` : "-"}
          />
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
          <Panel eyebrow="Pulse" title="Market Posture">
            <div className="grid gap-4 md:grid-cols-3">
              <MarketPulseMetric label="High-beta pocket" value={fmtWholeNumber(highVelocityCount)} detail="Names at beta 2.0+ inside the current screen." />
              <MarketPulseMetric label="Elevated IV/HV" value={fmtWholeNumber(elevatedIvCount)} detail="Names with front volatility running above recent realized movement." />
              <MarketPulseMetric label="20D breadth" value={`${fmtWholeNumber(advancingCount)} / ${fmtWholeNumber(decliningCount)}`} detail="Advancers versus decliners in the visible result set." />
            </div>
          </Panel>

          <Panel eyebrow="Queue" title="Candidates To Open Next">
            <div className="grid gap-3">
              {marketCandidateRows.map((row, index) => (
                <div key={`${row.symbol}-candidate`} className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">Candidate {index + 1}</div>
                      <div className="mt-1 text-lg font-semibold text-text">{row.symbol}</div>
                      <div className="mt-1 text-sm text-muted">{row.name} · {row.sector}</div>
                    </div>
                    <div className="rounded-full border border-accent/20 bg-accent/10 px-3 py-1 text-xs uppercase tracking-[0.16em] text-accent">
                      beta {fmtNumber(row.beta)}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted">
                    <InlinePill label={`20d ${fmtNumber(row.return20dPct, "%")}`} tone={(row.return20dPct ?? 0) >= 0 ? "safe" : "danger"} />
                    <InlinePill label={`iv/hv ${fmtNumber(row.ivToHv20)}`} tone={(row.ivToHv20 ?? 0) >= 1.2 ? "caution" : "neutral"} />
                    <InlinePill label={`vol $${fmtMillions(row.avgDollarVolumeM)}`} tone="neutral" />
                  </div>
                  <div className="mt-4 flex gap-2">
                    <OpenSymbolButton
                      label="Open ticker"
                      onClick={() => onOpenSymbol(row.symbol, "ticker")}
                      testId={`market-candidate-open-ticker-${row.symbol}`}
                      tone="neutral"
                    />
                    <OpenSymbolButton
                      label="Open options"
                      onClick={() => onOpenSymbol(row.symbol, "options")}
                      testId={`market-candidate-open-options-${row.symbol}`}
                      tone="accent"
                    />
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
          <Panel eyebrow="Ranking" title="Screen Results">
            {marketTopRows.length ? (
              <div className="overflow-x-auto rounded-2xl border border-line/80 bg-panel">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-panel/95 text-[11px] uppercase tracking-[0.18em] text-muted">
                    <tr className="border-b border-line/70">
                      <th className="px-4 py-3">Symbol</th>
                      <th className="px-4 py-3">Beta</th>
                      <th className="px-4 py-3">Price</th>
                      <th className="px-4 py-3">20D</th>
                      <th className="px-4 py-3">60D</th>
                      <th className="px-4 py-3">Avg $ Vol</th>
                      <th className="px-4 py-3">Mkt Cap</th>
                      <th className="px-4 py-3">IV/HV</th>
                      <th className="px-4 py-3">Sector</th>
                      <th className="px-4 py-3 text-right">Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {marketTopRows.map((row) => (
                      <tr key={row.symbol} className="border-b border-line/70 last:border-b-0" data-testid={`market-result-row-${row.symbol}`}>
                        <td className="px-4 py-3">
                          <div className="font-medium text-text">{row.symbol}</div>
                          <div className="mt-1 text-xs text-muted">{row.name}</div>
                        </td>
                        <td className="px-4 py-3 text-text">{fmtNumber(row.beta)}</td>
                        <td className="px-4 py-3 text-text">{fmtCurrencySmall(row.price)}</td>
                        <td className={`px-4 py-3 ${pnlTone(row.return20dPct)}`}>{fmtNumber(row.return20dPct, "%")}</td>
                        <td className={`px-4 py-3 ${pnlTone(row.return60dPct)}`}>{fmtNumber(row.return60dPct, "%")}</td>
                        <td className="px-4 py-3 text-text">${fmtMillions(row.avgDollarVolumeM)}</td>
                        <td className="px-4 py-3 text-text">${fmtBillions(row.marketCapB)}</td>
                        <td className="px-4 py-3 text-text">{fmtNumber(row.ivToHv20)}</td>
                        <td className="px-4 py-3 text-muted">{row.sector}</td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <OpenSymbolButton
                              label="Ticker"
                              onClick={() => onOpenSymbol(row.symbol, "ticker")}
                              testId={`market-open-ticker-${row.symbol}`}
                              tone="neutral"
                            />
                            <OpenSymbolButton
                              label="Options"
                              onClick={() => onOpenSymbol(row.symbol, "options")}
                              testId={`market-open-options-${row.symbol}`}
                              tone="accent"
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
                No symbols match the current beta, price, and liquidity screen yet. Loosen a filter to broaden the universe.
              </div>
            )}
          </Panel>

          <div className="grid gap-4">
            <Panel eyebrow="Signal" title="Beta Leaders">
              {marketChartRows.length ? (
                <div className="h-[320px] rounded-2xl border border-line/80 bg-panelSoft px-3 py-3">
                  <ResponsiveContainer height="100%" width="100%">
                    <BarChart data={marketChartRows} layout="vertical" margin={{ top: 8, right: 12, left: 4, bottom: 8 }}>
                      <CartesianGrid horizontal={false} stroke="rgba(133,155,149,0.14)" />
                      <XAxis domain={[1, 3]} tick={{ fill: "#8f9f98", fontSize: 11 }} tickLine={false} type="number" />
                      <YAxis dataKey="symbol" tick={{ fill: "#d5dfdb", fontSize: 12 }} tickLine={false} type="category" width={52} />
                      <Tooltip
                        contentStyle={{
                          background: "#101a1e",
                          border: "1px solid rgba(104, 144, 129, 0.22)",
                          borderRadius: "14px",
                          color: "#e8f1ed",
                        }}
                        cursor={{ fill: "rgba(84, 138, 119, 0.08)" }}
                        formatter={(value: number) => [fmtNumber(value), "Beta"]}
                      />
                      <Bar dataKey="beta" fill="#4f8e78" radius={[0, 8, 8, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
                  The beta chart will populate once at least one symbol passes the screen.
                </div>
              )}
            </Panel>

            <Panel eyebrow="Distribution" title="Sector Mix">
              <div className="grid gap-3">
                {marketSectorMix.length ? (
                  marketSectorMix.slice(0, 6).map((entry) => {
                    const share = marketScreenRows.length ? (entry.count / marketScreenRows.length) * 100 : 0;
                    return (
                      <div key={entry.sector}>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-text">{entry.sector}</span>
                          <span className="text-muted">{fmtWholeNumber(entry.count)} · {fmtNumber(share, "%")}</span>
                        </div>
                        <div className="mt-2 h-2 rounded-full bg-panel">
                          <div className="h-2 rounded-full bg-accent/70" style={{ width: `${share}%` }} />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
                    Sector mix appears once the screen returns names.
                  </div>
                )}
              </div>
            </Panel>

            <Panel eyebrow="Method" title="Screen Notes">
              <div className="grid gap-3">
                <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-muted">What this prototype assumes</div>
                  <div className="mt-2 text-sm text-muted">
                    This view reads the backend universe snapshot from <span className="mono">/api/market/universe</span>; the scanner service owns the ranked rows and the UI only filters them.
                  </div>
                </div>
                <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
                  Beta is shown here as a stock-universe factor, not an options Greek. The tool is built so we can later rank by any factor that belongs to the overall market, not just one chain.
                </div>
              </div>
            </Panel>
          </div>
        </div>
      </div>
    </ToolWorkspaceFrame>
  );
}

function ToggleChip({ checked, label, onToggle }: { checked: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      className={`rounded-2xl border px-3 py-2 text-sm transition ${
        checked ? "border-accent/45 bg-accent/10 text-accent" : "border-line bg-panelSoft text-muted hover:text-text"
      }`}
      onClick={onToggle}
      type="button"
    >
      {label}
    </button>
  );
}

function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="panel-soft rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between text-[11px] uppercase tracking-[0.22em] text-muted">
        <span>{label}</span>
        <span className="text-text">{value}</span>
      </div>
      <input
        className="w-full accent-accent"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function MarketPulseMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-text">{value}</div>
      <div className="mt-2 text-sm text-muted">{detail}</div>
    </div>
  );
}

function OpenSymbolButton({
  label,
  onClick,
  tone,
  testId,
}: {
  label: string;
  onClick: () => void;
  tone: "neutral" | "accent";
  testId?: string;
}) {
  return (
    <button
      className={
        tone === "accent"
          ? "rounded-full border border-accent/25 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:border-accent/45 hover:bg-accent/16"
          : "rounded-full border border-line/80 bg-panelSoft px-3 py-1.5 text-xs font-medium text-muted transition hover:border-accent/25 hover:text-text"
      }
      data-testid={testId}
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

function pnlTone(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "text-muted";
  }
  if (value > 0) {
    return "text-safe";
  }
  if (value < 0) {
    return "text-danger";
  }
  return "text-text";
}

function toMarketRow(candidate: UniverseCandidate): MarketRow {
  return {
    symbol: candidate.symbol,
    name: candidate.industry ?? candidate.themeCluster ?? candidate.sector ?? "Universe candidate",
    sector: candidate.sector ?? candidate.themeCluster ?? "Other",
    price: candidate.lastClose,
    beta: candidate.betaQqq60d ?? candidate.betaQqq120d ?? candidate.betaSpy120d,
    return20dPct: toPercent(candidate.priceReturn20d),
    return60dPct: toPercent(candidate.priceReturn60d),
    avgDollarVolumeM: candidate.avgDailyDollarVolume20d != null ? candidate.avgDailyDollarVolume20d / 1_000_000 : null,
    marketCapB: candidate.marketCap != null ? candidate.marketCap / 1_000_000_000 : null,
    ivToHv20: candidate.ivToHv20,
    optionVolume: candidate.totalOptionVolume,
    compositeScore: candidate.compositeScore,
    eligible: candidate.eligible,
    whyItRanked: candidate.whyItRanked,
  };
}

function sortableMarketValue(row: MarketRow, key: MarketSortKey) {
  if (key === "beta") {
    return row.beta ?? 0;
  }
  if (key === "avgDollarVolumeM") {
    return row.avgDollarVolumeM ?? 0;
  }
  if (key === "return20dPct") {
    return row.return20dPct ?? 0;
  }
  if (key === "return60dPct") {
    return row.return60dPct ?? 0;
  }
  if (key === "compositeScore") {
    return row.compositeScore ?? 0;
  }
  return row.ivToHv20 ?? 0;
}

function averageNullable(values: Array<number | null | undefined>) {
  const presentValues = values.filter((value): value is number => value != null && !Number.isNaN(value));
  if (!presentValues.length) {
    return null;
  }
  return presentValues.reduce((total, value) => total + value, 0) / presentValues.length;
}

function candidateScore(row: MarketRow) {
  return (
    (row.compositeScore ?? 0) * 100
    + (row.beta ?? 0) * 10
    + (row.ivToHv20 ?? 0) * 5
    + (row.avgDollarVolumeM ?? 0) / 100
  );
}

function toPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return null;
  }
  return value * 100;
}
