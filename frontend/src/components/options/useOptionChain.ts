import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { marketApi } from "../../lib/api";
import { queryKeys } from "../../lib/queryKeys";
import type { ChainRow, OptionChainResponse } from "../../lib/types";
import type { ChainBandDirection, ChainRowDisplayState } from "./OptionsChainTable";

type ChainRange = {
  min: number;
  max: number;
};

type RowFreshness = {
  updatedAt: number;
  refreshing: boolean;
};

const INITIAL_CHAIN_WINDOW_PCT = 0.05;
const CHAIN_WINDOW_STEP_PCT = 0.05;
const MAX_CHAIN_WINDOW_PCT = 0.5;
const MAX_CHAIN_STRIKE_LIMIT = 96;
const CHAIN_SCROLL_FETCH_DEBOUNCE_MS = 350;
const CHAIN_ROW_STALE_AFTER_MS = 60_000;
const CHAIN_ROW_REFRESH_INTERVAL_MS = 15_000;
const CHAIN_ROW_FRESHNESS_TICK_MS = 5_000;
const INITIAL_CHAIN_RANGE = { min: -INITIAL_CHAIN_WINDOW_PCT, max: INITIAL_CHAIN_WINDOW_PCT };

function chainRowStateKey(row: ChainRow) {
  return String(row.strike);
}

function mergeOptionChainResponses(current: OptionChainResponse, next: OptionChainResponse): OptionChainResponse {
  const rowsByStrike = new Map<number, ChainRow>();
  for (const row of current.rows) {
    rowsByStrike.set(row.strike, row);
  }
  for (const row of next.rows) {
    rowsByStrike.set(row.strike, row);
  }
  return {
    ...current,
    rows: Array.from(rowsByStrike.values()).sort((left, right) => left.strike - right.strike),
    highlights: next.highlights.length ? next.highlights : current.highlights,
    quoteSource: next.quoteSource,
    quoteAsOf: next.quoteAsOf,
    quoteNotice: next.quoteNotice,
    generatedAt: next.generatedAt,
    isStale: current.isStale || next.isStale,
  };
}

function markRowsFresh(rows: ChainRow[], updatedAt = Date.now()) {
  return (current: Record<string, RowFreshness>) => {
    const next = { ...current };
    for (const row of rows) {
      next[chainRowStateKey(row)] = { updatedAt, refreshing: false };
    }
    return next;
  };
}

function rowInRange(row: ChainRow, range: ChainRange) {
  const moneyness = row.distanceFromSpotPct / 100;
  const epsilon = 0.000001;
  return moneyness >= range.min - epsilon && moneyness <= range.max + epsilon;
}

function markRowsRefreshing(rows: ChainRow[], range: ChainRange) {
  return (current: Record<string, RowFreshness>) => {
    const next = { ...current };
    const now = Date.now();
    for (const row of rows) {
      if (!rowInRange(row, range)) {
        continue;
      }
      const key = chainRowStateKey(row);
      next[key] = { updatedAt: next[key]?.updatedAt ?? now, refreshing: true };
    }
    return next;
  };
}

function clearRowsRefreshing(rows: ChainRow[], range: ChainRange) {
  return (current: Record<string, RowFreshness>) => {
    const next = { ...current };
    for (const row of rows) {
      if (!rowInRange(row, range)) {
        continue;
      }
      const key = chainRowStateKey(row);
      const currentRow = next[key];
      if (currentRow) {
        next[key] = { ...currentRow, refreshing: false };
      }
    }
    return next;
  };
}

function loadedRefreshBands(range: ChainRange) {
  const bands: ChainRange[] = [{ ...INITIAL_CHAIN_RANGE }];
  for (let max = INITIAL_CHAIN_RANGE.min; max > range.min; max -= CHAIN_WINDOW_STEP_PCT) {
    bands.push({ min: Math.max(range.min, max - CHAIN_WINDOW_STEP_PCT), max });
  }
  for (let min = INITIAL_CHAIN_RANGE.max; min < range.max; min += CHAIN_WINDOW_STEP_PCT) {
    bands.push({ min, max: Math.min(range.max, min + CHAIN_WINDOW_STEP_PCT) });
  }
  return bands.sort((left, right) => Math.abs((left.min + left.max) / 2) - Math.abs((right.min + right.max) / 2));
}

function selectStaleBand(rows: ChainRow[], rowFreshness: Record<string, RowFreshness>, loadedRange: ChainRange) {
  const now = Date.now();
  for (const band of loadedRefreshBands(loadedRange)) {
    const bandRows = rows.filter((row) => rowInRange(row, band));
    if (!bandRows.length) {
      continue;
    }
    const hasStaleRow = bandRows.some((row) => {
      const freshness = rowFreshness[chainRowStateKey(row)];
      return !freshness || (!freshness.refreshing && now - freshness.updatedAt >= CHAIN_ROW_STALE_AFTER_MS);
    });
    if (hasStaleRow) {
      return band;
    }
  }
  return null;
}

export function useOptionChain(initialSymbol = "NVDA") {
  const [chainSymbol, setChainSymbol] = useState(initialSymbol);
  const [chainSymbolInput, setChainSymbolInput] = useState(initialSymbol);
  const [selectedExpiry, setSelectedExpiry] = useState<string | undefined>(undefined);
  const [chainLoadedRangePct, setChainLoadedRangePct] = useState<ChainRange>(INITIAL_CHAIN_RANGE);
  const [visibleChain, setVisibleChain] = useState<OptionChainResponse | null>(null);
  const [chainBandFetchDirection, setChainBandFetchDirection] = useState<ChainBandDirection | null>(null);
  const [rowFreshness, setRowFreshness] = useState<Record<string, RowFreshness>>({});
  const [freshnessTick, setFreshnessTick] = useState(0);
  const activeDisplayedChainRef = useRef<OptionChainResponse | null>(null);
  const chainWindowDebounceRef = useRef<number | null>(null);
  const chainBandFetchPendingRef = useRef(false);
  const chainRefreshPendingRef = useRef(false);

  const chainQuery = useQuery({
    queryKey: queryKeys.market.optionChain(chainSymbol, selectedExpiry),
    queryFn: () =>
      marketApi.chain(
        chainSymbol,
        selectedExpiry,
        MAX_CHAIN_STRIKE_LIMIT,
        undefined,
        undefined,
        INITIAL_CHAIN_RANGE.min,
        INITIAL_CHAIN_RANGE.max,
      ),
    refetchInterval: false,
    staleTime: 120_000,
  });

  const tickerOverviewQuery = useQuery({
    queryKey: queryKeys.market.tickerOverview(chainSymbol),
    queryFn: () => marketApi.tickerOverview(chainSymbol),
    enabled: Boolean(chainSymbol.trim()),
    refetchInterval: false,
    staleTime: 120_000,
  });

  useEffect(() => {
    const nextExpiry = chainQuery.data?.selectedExpiry;
    if (nextExpiry && nextExpiry !== selectedExpiry) {
      setSelectedExpiry(nextExpiry);
    }
  }, [chainQuery.data?.selectedExpiry, selectedExpiry]);

  useEffect(() => {
    setChainSymbolInput(chainSymbol);
  }, [chainSymbol]);

  useEffect(() => {
    if (!chainQuery.data) {
      return;
    }
    setVisibleChain(chainQuery.data);
    setChainLoadedRangePct(INITIAL_CHAIN_RANGE);
    setRowFreshness(markRowsFresh(chainQuery.data.rows));
  }, [chainQuery.data]);

  useEffect(() => {
    return () => {
      if (chainWindowDebounceRef.current != null) {
        window.clearTimeout(chainWindowDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (chainWindowDebounceRef.current != null) {
      window.clearTimeout(chainWindowDebounceRef.current);
      chainWindowDebounceRef.current = null;
    }
    chainBandFetchPendingRef.current = false;
    chainRefreshPendingRef.current = false;
    setChainBandFetchDirection(null);
    setRowFreshness({});
  }, [chainSymbol, selectedExpiry]);

  useEffect(() => {
    const interval = window.setInterval(() => setFreshnessTick((current) => current + 1), CHAIN_ROW_FRESHNESS_TICK_MS);
    return () => window.clearInterval(interval);
  }, []);

  const activeDisplayedChain = visibleChain;
  activeDisplayedChainRef.current = activeDisplayedChain;
  const activeChainMatchesRequest = activeDisplayedChain?.symbol === chainSymbol;
  const isLoadingDifferentSymbol = chainQuery.isFetching && Boolean(activeDisplayedChain) && !activeChainMatchesRequest;
  const chainHasBidAsk = ((activeChainMatchesRequest ? chainQuery.data?.rows : activeDisplayedChain?.rows) ?? []).some(
    (row) => row.callBid != null || row.callAsk != null || row.putBid != null || row.putAsk != null,
  );
  const chainHasOptionMarks = ((activeChainMatchesRequest ? chainQuery.data?.rows : activeDisplayedChain?.rows) ?? []).some(
    (row) => row.callMid != null || row.putMid != null,
  );
  const chainError = chainQuery.error instanceof Error ? chainQuery.error.message : null;
  const chainErrorHeaderLabel =
    chainError && activeDisplayedChain && !activeChainMatchesRequest
      ? `Could not load ${chainSymbol}. Still showing the last loaded chain. ${chainError}`
      : chainError;
  const displayedChainRows = activeDisplayedChain?.rows ?? [];
  const displayedExpiries = activeChainMatchesRequest ? activeDisplayedChain?.expiries ?? [] : [];
  const activeExpiry = selectedExpiry ?? activeDisplayedChain?.selectedExpiry ?? undefined;

  const rowDisplayStates = useMemo<Record<string, ChainRowDisplayState>>(() => {
    const now = Date.now();
    const states: Record<string, ChainRowDisplayState> = {};
    for (const row of displayedChainRows) {
      const key = chainRowStateKey(row);
      const freshness = rowFreshness[key];
      states[key] = {
        status: freshness?.refreshing ? "refreshing" : freshness && now - freshness.updatedAt < CHAIN_ROW_STALE_AFTER_MS ? "fresh" : "stale",
        updatedAt: freshness?.updatedAt ?? null,
      };
    }
    return states;
  }, [displayedChainRows, freshnessTick, rowFreshness]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const chain = activeDisplayedChainRef.current;
      if (
        !chain ||
        chainQuery.isFetching ||
        chainBandFetchPendingRef.current ||
        chainRefreshPendingRef.current ||
        document.hidden
      ) {
        return;
      }
      const staleBand = selectStaleBand(chain.rows, rowFreshness, chainLoadedRangePct);
      if (!staleBand) {
        return;
      }
      const requestSymbol = chain.symbol;
      const requestExpiry = chain.selectedExpiry;
      chainRefreshPendingRef.current = true;
      setRowFreshness(markRowsRefreshing(chain.rows, staleBand));
      void marketApi
        .chain(requestSymbol, requestExpiry, MAX_CHAIN_STRIKE_LIMIT, undefined, undefined, staleBand.min, staleBand.max)
        .then((nextChain) => {
          const latestChain = activeDisplayedChainRef.current;
          if (!latestChain || latestChain.symbol !== requestSymbol || latestChain.selectedExpiry !== requestExpiry) {
            return;
          }
          setVisibleChain((current) => (current ? mergeOptionChainResponses(current, nextChain) : nextChain));
          setRowFreshness(markRowsFresh(nextChain.rows));
        })
        .catch(() => {
          const latestChain = activeDisplayedChainRef.current;
          if (latestChain?.symbol === requestSymbol && latestChain.selectedExpiry === requestExpiry) {
            setRowFreshness(clearRowsRefreshing(latestChain.rows, staleBand));
          }
        })
        .finally(() => {
          chainRefreshPendingRef.current = false;
        });
    }, CHAIN_ROW_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [chainLoadedRangePct, chainQuery.isFetching, rowFreshness]);

  function handleChainSymbolSelection(nextSymbol: string) {
    const normalizedSymbol = nextSymbol.trim().toUpperCase();
    if (!normalizedSymbol || normalizedSymbol === chainSymbol) {
      return;
    }
    startTransition(() => {
      setChainSymbol(normalizedSymbol);
      setSelectedExpiry(undefined);
      setChainLoadedRangePct(INITIAL_CHAIN_RANGE);
    });
  }

  function submitChainSymbolInput() {
    handleChainSymbolSelection(chainSymbolInput);
  }

  function handleExpirySelection(nextExpiry: string) {
    if (!nextExpiry || nextExpiry === selectedExpiry) {
      return;
    }
    startTransition(() => {
      setSelectedExpiry(nextExpiry);
      setChainLoadedRangePct(INITIAL_CHAIN_RANGE);
    });
  }

  function requestWiderChainWindow(direction: ChainBandDirection) {
    const chainForBand = activeDisplayedChain;
    if (chainQuery.isFetching || chainBandFetchPendingRef.current || chainRefreshPendingRef.current || !chainForBand?.rows.length) {
      return;
    }
    const requestSymbol = chainForBand.symbol;
    const requestExpiry = chainForBand.selectedExpiry;
    const currentBoundary = direction === "lower" ? Math.abs(chainLoadedRangePct.min) : chainLoadedRangePct.max;
    if (currentBoundary >= MAX_CHAIN_WINDOW_PCT) {
      return;
    }
    if (chainWindowDebounceRef.current != null) {
      window.clearTimeout(chainWindowDebounceRef.current);
    }
    setChainBandFetchDirection(direction);
    const nextRange =
      direction === "lower"
        ? {
            min: Math.max(-MAX_CHAIN_WINDOW_PCT, chainLoadedRangePct.min - CHAIN_WINDOW_STEP_PCT),
            max: chainLoadedRangePct.min,
          }
        : {
            min: chainLoadedRangePct.max,
            max: Math.min(MAX_CHAIN_WINDOW_PCT, chainLoadedRangePct.max + CHAIN_WINDOW_STEP_PCT),
          };
    chainWindowDebounceRef.current = window.setTimeout(() => {
      chainWindowDebounceRef.current = null;
      chainBandFetchPendingRef.current = true;
      void marketApi
        .chain(requestSymbol, requestExpiry, MAX_CHAIN_STRIKE_LIMIT, undefined, undefined, nextRange.min, nextRange.max)
        .then((nextChain) => {
          const latestChain = activeDisplayedChainRef.current;
          if (!latestChain || latestChain.symbol !== requestSymbol || latestChain.selectedExpiry !== requestExpiry) {
            return;
          }
          setVisibleChain((current) => (current ? mergeOptionChainResponses(current, nextChain) : nextChain));
          setRowFreshness(markRowsFresh(nextChain.rows));
          setChainLoadedRangePct((current) => ({
            min: Math.min(current.min, nextRange.min),
            max: Math.max(current.max, nextRange.max),
          }));
        })
        .catch(() => undefined)
        .finally(() => {
          chainBandFetchPendingRef.current = false;
          setChainBandFetchDirection(null);
        });
    }, CHAIN_SCROLL_FETCH_DEBOUNCE_MS);
  }

  return {
    activeDisplayedChain,
    activeExpiry,
    chainBandFetchDirection,
    chainErrorHeaderLabel,
    chainHasBidAsk,
    chainHasOptionMarks,
    chainLoadedRangePct,
    chainQuery,
    chainSymbol,
    chainSymbolInput,
    displayedChainRows,
    displayedExpiries,
    handleChainSymbolSelection,
    handleExpirySelection,
    isLoadingDifferentSymbol,
    maxChainWindowPct: MAX_CHAIN_WINDOW_PCT,
    requestWiderChainWindow,
    rowDisplayStates,
    selectedExpiry,
    setChainSymbolInput,
    submitChainSymbolInput,
    tickerOverviewQuery,
  };
}
