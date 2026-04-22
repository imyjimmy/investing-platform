# IBKR Fundamentals Retrieval Plan

Prepared 2026-04-22.

## Official IBKR Surfaces

- TWS `EClient.reqFundamentalData` is the direct API for company fundamentals. The legacy TWS reference lists these report types:
  - `ReportSnapshot`: company overview
  - `ReportsFinSummary`: financial summary
  - `ReportRatios`: financial ratios
  - `ReportsFinStatements`: financial statements
  - `RESC`: analyst estimates
- IBKR marks `reqFundamentalData` as legacy/deprecated, so the app should treat availability as entitlement/session-dependent and report source gaps clearly.
- TWS market data generic ticks already used by the app are still useful:
  - `165`: 13/26/52-week low/high and average volume
  - `258`: fundamental ratios
  - `456`: IB dividends, including trailing dividends, forward dividends, next date, and next amount
- Wall Street Horizon calendar/event data is available through `reqWshMetaData` and `reqWshEventData`, but requires a WSH research subscription. It covers earnings dates, dividend dates, options expiration dates, splits, spinoffs, conferences, and other events.
- IBKR Campus notes that API market data generally requires proper market-data subscriptions and an IBKR Pro account.

Primary references:

- https://interactivebrokers.github.io/tws-api/classIBApi_1_1EClient.html
- https://interactivebrokers.github.io/tws-api/fundamentals.html
- https://www.interactivebrokers.com/campus/ibkr-api-page/twsapi-doc/
- https://www.interactivebrokers.com/campus/ibkr-api-page/market-data-subscriptions/

## Current App State

- The existing ticker overview endpoint is `/api/market/ticker/{symbol}`.
- Backend model: `TickerOverviewResponse` in `src/investing_platform/models.py`.
- IBKR retrieval path: `IBGatewayBrokerService._fetch_ticker_overview` in `src/investing_platform/services/ib_gateway.py`.
- Existing overview enrichment already requests `STOCK_OVERVIEW_GENERIC_TICKS = "165,258,456"`.
- Existing fundamental XML helper requests only `ReportSnapshot` and `CalendarReport` today.
- Existing UI renders the overview rows in `frontend/src/App.tsx`.

## Target Retrieval Shape

Add a separate fundamentals endpoint rather than bloating the existing overview response:

- `GET /api/market/ticker/{symbol}/financials`
- Request and cache the following reports for a qualified stock contract:
  - `ReportsFinStatements`
  - `ReportRatios`
  - `ReportsFinSummary`
  - `RESC`
- Preserve the raw XML report payloads during development under `data/raw/fundamentals/{symbol}/{report_type}.xml` when a debug flag is enabled.
- Parse into a normalized response that can drive UI tabs:
  - Income Statement
  - Balance Sheet
  - Cash Flow
  - Ratios
  - Estimates, if `RESC` returns useful analyst data

Suggested model sketch:

```text
TickerFinancialsResponse
  symbol
  reports[]
  statements[]
  ratios[]
  estimates[]
  sourceNotices[]
  generatedAt
  isStale

FinancialStatementTable
  statementType: income_statement | balance_sheet | cash_flow
  periodType: annual | quarterly | ttm
  currency
  unit
  columns[]
  rows[]

FinancialMetricRow
  label
  values[]
```

## Implementation Checklist

1. Add backend models for statement tables, metric rows, and report diagnostics.
2. Extend `BrokerService` with `get_ticker_financials(symbol)`.
3. Implement IBKR fetch by qualifying the `Stock` contract and calling `_request_fundamental_report` sequentially for the report types above.
4. Add a parser layer for `ReportsFinStatements` and `ReportRatios` XML. Keep parser tolerant of missing tags and variant report layouts.
5. Add a FastAPI route at `/api/market/ticker/{symbol}/financials`.
6. Add TypeScript types and an API client method.
7. Add `Financials` tabs under `Stocks > Ticker`: Income Statement, Balance Sheet, Cash Flow, Ratios.
8. Show source notices when IBKR does not return a report, and avoid silently mixing unsupported fields.
9. Verify against NVDA first, then at least one non-tech large cap and one ETF to document gaps.

## Risks And Guardrails

- `reqFundamentalData` is legacy/deprecated and may fail or return partial payloads.
- Report XML schemas may vary by security, country, and entitlement.
- WSH events are subscription-gated; do not make earnings-date correctness depend solely on WSH unless the account has access.
- IBKR data licensing matters. This app should remain local/personal and should not redistribute IBKR market or fundamental data.
