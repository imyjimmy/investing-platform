# General Stock Intelligence Layer Spec

Prepared 2026-05-20.

## Status

Phase 0 implementation spec for turning stock research into one source-aware intelligence layer instead of separate EDGAR, earnings, PDF, market-data, and transcript silos.

## Goal

The app should expose one broad stock intelligence surface:

1. accept a ticker and a natural-language question
2. gather evidence from every relevant enabled source
3. normalize that evidence into one typed bundle
4. synthesize an answer only from that bundle
5. return source-aware citations, limitations, and next actions

EDGAR/Qwen becomes one evidence provider inside this layer, not the whole intelligence product.

## Design Principles

1. No question-specific keyword hacks.
   Source planning must not encode company names, deal terms, or one-off failed prompts.

2. Prefer broad collection over brittle inference in phase 0.
   If the planner is not confident, gather a default evidence set rather than guessing from hidden lexical rules.

3. Use typed evidence contracts.
   Each source adapter returns normalized evidence with a stable `source`, `evidenceType`, `summary`, `payload`, and citation metadata.

4. Keep adapters independent.
   EDGAR, market snapshots, financial statements, investor PDFs, earnings estimates, transcripts, news, and price reactions should be independently testable.

5. Make unsupported scope visible.
   If consensus estimates or transcripts are missing, the response should say that plainly instead of manufacturing a broad answer from SEC filings.

## Phase 0 Shape

New endpoint:

```text
POST /api/intelligence/stock/ask
```

Request:

```json
{
  "ticker": "IREN",
  "question": "Did IREN miss their latest earnings numbers?",
  "sources": [],
  "allowStale": false
}
```

When `sources` is empty, phase 0 uses broad default collection:

- `market_snapshot`
- `financials`
- `edgar`
- `market_data_sources`

The phase 0 planner deliberately does not infer source selection from question keywords. Explicit source selection can be added by the caller, and later planner versions can use a structured model-based plan with tests.

## Evidence Contract

Every adapter returns `StockIntelligenceEvidence`:

```json
{
  "evidenceId": "E1",
  "source": "financials",
  "evidenceType": "financials",
  "title": "IREN financial statements",
  "summary": "3 statement tables, 1 ratio table, 0 estimate tables",
  "sourceLabel": "Market data financials",
  "asOf": "2026-05-20T12:00:00Z",
  "payload": {}
}
```

Qwen synthesis must consume this evidence contract, not raw service-specific payloads.

## Next Phases

Phase 1:

- add a Qwen synthesis pass over `StockIntelligenceEvidence`
- validate generated claims against evidence ids
- return a unified citation array

Phase 2:

- add provider adapters for earnings actuals and consensus estimates
- add transcript/news/price-reaction adapters
- support source-specific freshness checks

Phase 3:

- add a structured planner that emits source requirements, date ranges, ticker scope, and confidence
- test planner behavior against fixed natural-language question suites
- keep planner output metadata-oriented; do not route on company-specific answer content
