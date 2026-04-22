# Frontend Modularity Boundary

Prepared 2026-04-22.

This guardrail exists to keep `frontend/src/App.tsx` from becoming the application again.

## App.tsx Is The Composition Root

`App.tsx` may:

- mount global providers
- render the broad application shell
- hold app-wide navigation state, such as the active workspace
- wire global context providers
- handle boot-level readiness, such as fatal backend/app configuration states
- render feature entrypoints by workspace key

`App.tsx` may not:

- own feature-specific data fetching
- own feature-specific mutations
- own feature-specific form state
- render feature tables, charts, cards, trade tickets, connector details, or research tools
- contain feature-specific business rules, filters, sorting, or derived calculations
- define reusable UI primitives or icon libraries
- define formatter/helper piles used by feature modules

If deleting `App.tsx` requires understanding option order tickets, connector CSV folders, market screener beta filters, Coinbase balances, or ticker financial statements, then `App.tsx` owns too much.

## Data Fetching Boundary

Feature modules fetch their own data through hooks colocated with that feature.

Examples:

- `features/stocks/ticker/useTickerOverview`
- `features/stocks/ticker/useTickerFinancials`
- `features/options/useOptionChain`
- `features/dashboard/useDashboardAccountSources`
- `features/crypto/useCryptoMajors`
- `features/research/useResearchSources`

`App.tsx` may fetch only boot-level/global data when the app cannot decide what shell to show without it.

## Preferred Shape

```tsx
export default function App() {
  return (
    <AppProviders>
      <WorkspaceStateProvider>
        <AppShell>
          <WorkspaceStage />
        </AppShell>
      </WorkspaceStateProvider>
    </AppProviders>
  );
}
```

`WorkspaceStage` should import feature entrypoints, not feature internals:

```tsx
function WorkspaceStage() {
  const { activeWorkspace } = useWorkspaceState();

  switch (activeWorkspace) {
    case "dashboard":
      return <DashboardWorkspace />;
    case "stocks.market":
      return <StockMarketWorkspace />;
    case "stocks.ticker":
      return <TickerWorkspace />;
    case "stocks.options.chain":
      return <OptionsChainWorkspace />;
    case "crypto.market":
      return <CryptoMarketWorkspace />;
    case "settings":
      return <SettingsWorkspace />;
  }
}
```

## Module Boundaries

Recommended folders:

- `components/shell`: top bar, sidebar, workspace stage/frame, shell icons
- `components/ui`: reusable controls and small display primitives
- `lib`: formatting, shared pure helpers, typed API client
- `features/dashboard`: account dashboard, account connector summaries, dashboard data hooks
- `features/stocks/market`: stock screener state, data hooks, UI
- `features/stocks/ticker`: ticker overview, financials, data hooks, UI
- `features/options`: option chain, trade ticket, order mutations, option tools
- `features/crypto`: crypto market and leverage workspaces
- `features/research`: EDGAR and investor PDF orchestration
- `features/settings`: global settings workspace

## Refactor Rules

- Extract one coherent boundary at a time.
- Preserve behavior before changing design.
- Move state with the feature unless it is genuinely app-wide.
- Move data fetching with the feature unless it is boot-level.
- Keep `App.tsx` imports at feature-entrypoint granularity.
- After each extraction, run `npm run build`.
