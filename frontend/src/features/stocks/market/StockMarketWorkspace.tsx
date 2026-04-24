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

type MarketSector =
  | "Consumer"
  | "Energy"
  | "Financials"
  | "Healthcare"
  | "Materials"
  | "Semiconductors"
  | "Software"
  | "Space"
  | "Technology";

type MarketSortKey = "beta" | "avgDollarVolumeM" | "weekChangePct" | "monthChangePct" | "shortInterestPct";
type MarketPreset = "high-beta" | "squeeze-watch" | "liquid-leaders" | "reset";
type MarketTargetWorkspace = "ticker" | "options";

type MarketRow = {
  symbol: string;
  name: string;
  sector: MarketSector;
  price: number;
  beta: number;
  weekChangePct: number;
  monthChangePct: number;
  avgDollarVolumeM: number;
  marketCapB: number;
  shortInterestPct: number;
  optionsable: boolean;
  shortable: boolean;
};

type StockMarketWorkspaceProps = {
  gatewayPill: { label: string; tone: InlinePillTone };
  onOpenSymbol: (symbol: string, workspace: MarketTargetWorkspace) => void;
};

const MARKET_SORT_OPTIONS: Array<{ key: MarketSortKey; label: string }> = [
  { key: "beta", label: "Highest beta" },
  { key: "avgDollarVolumeM", label: "Most liquid" },
  { key: "weekChangePct", label: "Strongest 1W move" },
  { key: "monthChangePct", label: "Strongest 1M move" },
  { key: "shortInterestPct", label: "Highest short interest" },
];

const MARKET_SCREEN_ROWS: MarketRow[] = [
  { symbol: "SMCI", name: "Super Micro Computer", sector: "Technology", price: 84.2, beta: 2.63, weekChangePct: 9.1, monthChangePct: 18.6, avgDollarVolumeM: 1880, marketCapB: 49.1, shortInterestPct: 9.4, optionsable: true, shortable: true },
  { symbol: "MSTR", name: "Strategy", sector: "Technology", price: 1712.5, beta: 2.58, weekChangePct: 7.3, monthChangePct: 24.8, avgDollarVolumeM: 2140, marketCapB: 115.4, shortInterestPct: 7.2, optionsable: true, shortable: true },
  { symbol: "UPST", name: "Upstart Holdings", sector: "Financials", price: 41.8, beta: 2.52, weekChangePct: 11.2, monthChangePct: 16.5, avgDollarVolumeM: 402, marketCapB: 4.1, shortInterestPct: 14.6, optionsable: true, shortable: true },
  { symbol: "COIN", name: "Coinbase Global", sector: "Financials", price: 238.7, beta: 2.34, weekChangePct: 5.7, monthChangePct: 14.9, avgDollarVolumeM: 1675, marketCapB: 58.8, shortInterestPct: 5.9, optionsable: true, shortable: true },
  { symbol: "APP", name: "AppLovin", sector: "Software", price: 79.4, beta: 2.29, weekChangePct: 8.8, monthChangePct: 19.2, avgDollarVolumeM: 923, marketCapB: 27.4, shortInterestPct: 6.1, optionsable: true, shortable: true },
  { symbol: "AFRM", name: "Affirm Holdings", sector: "Financials", price: 48.9, beta: 2.23, weekChangePct: 4.4, monthChangePct: 10.1, avgDollarVolumeM: 611, marketCapB: 15.2, shortInterestPct: 8.3, optionsable: true, shortable: true },
  { symbol: "SOUN", name: "SoundHound AI", sector: "Software", price: 6.3, beta: 2.21, weekChangePct: 14.6, monthChangePct: 27.3, avgDollarVolumeM: 278, marketCapB: 2.5, shortInterestPct: 15.8, optionsable: true, shortable: true },
  { symbol: "RKLB", name: "Rocket Lab", sector: "Space", price: 10.4, beta: 2.16, weekChangePct: 6.5, monthChangePct: 12.6, avgDollarVolumeM: 246, marketCapB: 5.1, shortInterestPct: 9.8, optionsable: true, shortable: true },
  { symbol: "IONQ", name: "IonQ", sector: "Technology", price: 13.9, beta: 2.09, weekChangePct: 3.2, monthChangePct: 9.4, avgDollarVolumeM: 190, marketCapB: 3.0, shortInterestPct: 12.2, optionsable: true, shortable: true },
  { symbol: "ASTS", name: "AST SpaceMobile", sector: "Space", price: 5.9, beta: 2.04, weekChangePct: 12.4, monthChangePct: 31.8, avgDollarVolumeM: 162, marketCapB: 1.8, shortInterestPct: 24.7, optionsable: true, shortable: true },
  { symbol: "PLTR", name: "Palantir Technologies", sector: "Software", price: 31.6, beta: 1.91, weekChangePct: 2.7, monthChangePct: 8.2, avgDollarVolumeM: 1540, marketCapB: 72.6, shortInterestPct: 4.6, optionsable: true, shortable: true },
  { symbol: "NVDA", name: "NVIDIA", sector: "Semiconductors", price: 201.0, beta: 1.88, weekChangePct: 5.5, monthChangePct: 13.7, avgDollarVolumeM: 9320, marketCapB: 4930.0, shortInterestPct: 1.1, optionsable: true, shortable: true },
  { symbol: "CELH", name: "Celsius Holdings", sector: "Consumer", price: 63.5, beta: 1.82, weekChangePct: -1.9, monthChangePct: 6.3, avgDollarVolumeM: 294, marketCapB: 14.8, shortInterestPct: 11.4, optionsable: true, shortable: true },
  { symbol: "CRWD", name: "CrowdStrike", sector: "Software", price: 388.1, beta: 1.74, weekChangePct: 3.9, monthChangePct: 7.8, avgDollarVolumeM: 1234, marketCapB: 95.1, shortInterestPct: 2.0, optionsable: true, shortable: true },
  { symbol: "HIMS", name: "Hims & Hers Health", sector: "Healthcare", price: 18.4, beta: 1.72, weekChangePct: 10.9, monthChangePct: 22.6, avgDollarVolumeM: 211, marketCapB: 4.2, shortInterestPct: 13.2, optionsable: true, shortable: true },
  { symbol: "HOOD", name: "Robinhood Markets", sector: "Financials", price: 22.8, beta: 1.67, weekChangePct: 4.8, monthChangePct: 11.7, avgDollarVolumeM: 708, marketCapB: 20.3, shortInterestPct: 6.9, optionsable: true, shortable: true },
  { symbol: "XOM", name: "Exxon Mobil", sector: "Energy", price: 119.7, beta: 1.58, weekChangePct: 1.2, monthChangePct: 4.6, avgDollarVolumeM: 1410, marketCapB: 475.0, shortInterestPct: 0.8, optionsable: true, shortable: true },
  { symbol: "FCX", name: "Freeport-McMoRan", sector: "Materials", price: 46.1, beta: 1.55, weekChangePct: 2.3, monthChangePct: 5.4, avgDollarVolumeM: 497, marketCapB: 66.0, shortInterestPct: 1.9, optionsable: true, shortable: true },
];

const MARKET_SECTORS = Array.from(new Set(MARKET_SCREEN_ROWS.map((row) => row.sector)));

export function StockMarketWorkspace({ gatewayPill, onOpenSymbol }: StockMarketWorkspaceProps) {
  const [marketMinBeta, setMarketMinBeta] = useState(1.7);
  const [marketMinPrice, setMarketMinPrice] = useState(10);
  const [marketMinDollarVolumeM, setMarketMinDollarVolumeM] = useState(200);
  const [marketMinShortInterestPct, setMarketMinShortInterestPct] = useState(0);
  const [marketSearch, setMarketSearch] = useState("");
  const [marketSectorFilter, setMarketSectorFilter] = useState<MarketSector | "All">("All");
  const [marketSortKey, setMarketSortKey] = useState<MarketSortKey>("beta");
  const [marketOptionableOnly, setMarketOptionableOnly] = useState(true);
  const [marketShortableOnly, setMarketShortableOnly] = useState(false);

  const marketScreenRows = useMemo(() => {
    const marketSearchNeedle = marketSearch.trim().toLowerCase();
    return MARKET_SCREEN_ROWS
      .filter((row) => !marketSearchNeedle || row.symbol.toLowerCase().includes(marketSearchNeedle) || row.name.toLowerCase().includes(marketSearchNeedle))
      .filter((row) => row.beta >= marketMinBeta)
      .filter((row) => row.price >= marketMinPrice)
      .filter((row) => row.avgDollarVolumeM >= marketMinDollarVolumeM)
      .filter((row) => row.shortInterestPct >= marketMinShortInterestPct)
      .filter((row) => marketSectorFilter === "All" || row.sector === marketSectorFilter)
      .filter((row) => !marketOptionableOnly || row.optionsable)
      .filter((row) => !marketShortableOnly || row.shortable)
      .slice()
      .sort((left, right) => {
        const delta = right[marketSortKey] - left[marketSortKey];
        if (Math.abs(delta) > 0.0001) {
          return delta;
        }
        return right.beta - left.beta;
      });
  }, [
    marketMinBeta,
    marketMinDollarVolumeM,
    marketMinPrice,
    marketMinShortInterestPct,
    marketOptionableOnly,
    marketSearch,
    marketSectorFilter,
    marketShortableOnly,
    marketSortKey,
  ]);
  const marketTopRows = marketScreenRows.slice(0, 12);
  const marketChartRows = marketScreenRows.slice(0, 8).map((row) => ({
    symbol: row.symbol,
    beta: row.beta,
  }));
  const averageScreenBeta =
    marketScreenRows.length > 0 ? marketScreenRows.reduce((sum, row) => sum + row.beta, 0) / marketScreenRows.length : null;
  const averageScreenVolume =
    marketScreenRows.length > 0 ? marketScreenRows.reduce((sum, row) => sum + row.avgDollarVolumeM, 0) / marketScreenRows.length : null;
  const highVelocityCount = marketScreenRows.filter((row) => row.beta >= 2).length;
  const topScreenSymbol = marketScreenRows[0] ?? null;
  const advancingCount = marketScreenRows.filter((row) => row.weekChangePct > 0).length;
  const decliningCount = marketScreenRows.filter((row) => row.weekChangePct < 0).length;
  const crowdedCount = marketScreenRows.filter((row) => row.shortInterestPct >= 10).length;
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
      const scoreLeft = left.beta * 28 + left.shortInterestPct * 1.8 + left.weekChangePct * 3 + Math.min(left.avgDollarVolumeM / 40, 32);
      const scoreRight = right.beta * 28 + right.shortInterestPct * 1.8 + right.weekChangePct * 3 + Math.min(right.avgDollarVolumeM / 40, 32);
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
        setMarketMinShortInterestPct(0);
        setMarketSectorFilter("All");
        setMarketSortKey("beta");
        setMarketOptionableOnly(true);
        setMarketShortableOnly(false);
        return;
      }
      if (preset === "squeeze-watch") {
        setMarketSearch("");
        setMarketMinBeta(1.6);
        setMarketMinPrice(5);
        setMarketMinDollarVolumeM(150);
        setMarketMinShortInterestPct(10);
        setMarketSectorFilter("All");
        setMarketSortKey("shortInterestPct");
        setMarketOptionableOnly(true);
        setMarketShortableOnly(true);
        return;
      }
      if (preset === "liquid-leaders") {
        setMarketSearch("");
        setMarketMinBeta(1.3);
        setMarketMinPrice(20);
        setMarketMinDollarVolumeM(800);
        setMarketMinShortInterestPct(0);
        setMarketSectorFilter("All");
        setMarketSortKey("avgDollarVolumeM");
        setMarketOptionableOnly(true);
        setMarketShortableOnly(false);
        return;
      }
      setMarketSearch("");
      setMarketMinBeta(1.7);
      setMarketMinPrice(10);
      setMarketMinDollarVolumeM(200);
      setMarketMinShortInterestPct(0);
      setMarketSectorFilter("All");
      setMarketSortKey("beta");
      setMarketOptionableOnly(true);
      setMarketShortableOnly(false);
    });
  }

  return (
    <ToolWorkspaceFrame
      description="Screen the US stock universe by beta, crowding, and liquidity, then push the names that matter into `Ticker` or `Options` without detouring through the dashboard."
      eyebrow="Stocks"
      headerSlot={
        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-muted">
          <InlinePill label={`Gateway session · ${gatewayPill.label.toLowerCase()}`} tone={gatewayPill.tone} />
          <InlinePill label="Data source · US stock L1 feeds planned" tone="caution" />
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
              label="Min short %"
              max={25}
              min={0}
              onChange={setMarketMinShortInterestPct}
              step={1}
              value={marketMinShortInterestPct}
            />
          </div>

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
                data-testid="market-preset-squeeze-watch"
                onClick={() => applyMarketPreset("squeeze-watch")}
                type="button"
              >
                Squeeze watch
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
              <ToggleChip checked={marketOptionableOnly} label="Options-ready only" onToggle={() => setMarketOptionableOnly((value) => !value)} />
              <ToggleChip checked={marketShortableOnly} label="Shortable only" onToggle={() => setMarketShortableOnly((value) => !value)} />
            </div>

            <div className="panel-soft rounded-2xl p-4">
              <div className="mb-3 text-[11px] uppercase tracking-[0.22em] text-muted">Sort and sector</div>
              <select
                className="w-full rounded-xl border border-line/80 bg-panel px-3 py-3 text-sm text-text outline-none transition focus:border-accent/60"
                onChange={(event) => setMarketSectorFilter(event.target.value as MarketSector | "All")}
                value={marketSectorFilter}
              >
                <option value="All">All sectors</option>
                {MARKET_SECTORS.map((sector) => (
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
              <MarketPulseMetric label="Crowded pocket" value={fmtWholeNumber(crowdedCount)} detail="Names with double-digit short interest still surviving the filter." />
              <MarketPulseMetric label="Weekly breadth" value={`${fmtWholeNumber(advancingCount)} / ${fmtWholeNumber(decliningCount)}`} detail="Advancers versus decliners in the visible result set." />
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
                    <InlinePill label={`1w ${fmtNumber(row.weekChangePct, "%")}`} tone={row.weekChangePct >= 0 ? "safe" : "danger"} />
                    <InlinePill label={`short ${fmtNumber(row.shortInterestPct, "%")}`} tone={row.shortInterestPct >= 10 ? "caution" : "neutral"} />
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
                      <th className="px-4 py-3">1W</th>
                      <th className="px-4 py-3">1M</th>
                      <th className="px-4 py-3">Avg $ Vol</th>
                      <th className="px-4 py-3">Mkt Cap</th>
                      <th className="px-4 py-3">Short %</th>
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
                        <td className={`px-4 py-3 ${pnlTone(row.weekChangePct)}`}>{fmtNumber(row.weekChangePct, "%")}</td>
                        <td className={`px-4 py-3 ${pnlTone(row.monthChangePct)}`}>{fmtNumber(row.monthChangePct, "%")}</td>
                        <td className="px-4 py-3 text-text">${fmtMillions(row.avgDollarVolumeM)}</td>
                        <td className="px-4 py-3 text-text">${fmtBillions(row.marketCapB)}</td>
                        <td className="px-4 py-3 text-text">{fmtNumber(row.shortInterestPct, "%")}</td>
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
                    The upcoming `Network A`, `Network B`, and `Network C` subscriptions will back live US stock screening, while the current rows are fixture data that let us shape the workflow now.
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
