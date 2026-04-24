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

## API Client Boundary

The frontend API client should have a tiny transport layer and domain-specific clients.

Allowed shape:

- `lib/api/transport`: base URL resolution, request/response handling, error formatting
- `lib/api/account`: account snapshots, positions, orders, route state
- `lib/api/market`: ticker, financials, option chains, crypto market data, universe snapshots
- `lib/api/sources`: EDGAR, investor PDFs, Coinbase, Finnhub, OKX, filesystem connectors
- `lib/api/execution`: order preview, submit, cancel
- `lib/queryKeys`: canonical React Query keys and invalidation targets

Avoid one large `api.ts` object that imports every request and response type in the system. A compatibility barrel may re-export domain clients temporarily, but feature code should import the domain client it actually uses.

React Query keys are part of the data contract. They should not be handwritten ad hoc inside components. If a mutation invalidates account positions, open orders, or source status, it should do that through shared key helpers so the invalidation target stays consistent across tools.

## Backend API Boundary

The backend API should mirror product domains instead of collecting every route in one file.

Preferred router layout:

- `api/routes/health.py`: health and boot readiness
- `api/routes/account.py`: account summary, positions, risk, open orders
- `api/routes/market.py`: ticker, financials, option chains, universe, crypto market data
- `api/routes/analytics.py`: collateral, exposure, scenarios, options intelligence
- `api/routes/execution.py`: order preview, submit, cancel
- `api/routes/sources.py`: connector/source status and configuration
- `api/routes/research.py`: EDGAR and investor PDF sync/read state

Route handlers may:

- adapt HTTP query/body parameters into service calls
- map expected service/domain errors to HTTP status codes
- return Pydantic response models or simple typed DTOs

Route handlers may not:

- call another route handler as an internal helper
- contain business workflows that belong in services
- inspect and transform large response dictionaries from sibling routes
- hand-roll response payloads when a Pydantic model already exists

Every public route should prefer `response_model=...` unless the response is intentionally unstructured. That keeps FastAPI's OpenAPI output usable as a contract for the TypeScript client.

Service modules own domain work. API modules own HTTP translation. Frontend modules own presentation and interaction state. When logic is hard to place, default it to the service layer if it would also be needed by a CLI, background job, test fixture, or another route.

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
