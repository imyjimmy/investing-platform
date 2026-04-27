# EDGAR Tool Simplification and Cache Architecture Spec

Prepared 2026-04-26.

## Status

Proposed product and architecture spec for simplifying `Stock Intel > EDGAR Filings` and introducing a layered EDGAR cache that supports local filing intelligence without mirroring the full SEC corpus.

## Companion Document

This spec is intentionally paired with:

- `docs/edgar-qwen36-local-intelligence-architecture-spec.md`

Boundary between the two documents:

- this spec owns the user-facing EDGAR workflow, sync contract, cache policy, and filing acquisition strategy
- the Qwen/oMLX spec owns corpus extraction, indexing, retrieval, prompt construction, and local answer generation

They must be implemented together, but they solve different problems.

## Summary

The EDGAR tool should stop asking the user to think like a downloader.

The user-facing workflow should become:

1. specify the company
2. sync SEC filings
3. ask questions about those filings

The backend should decide:

- how the issuer is resolved
- which filing types matter by default
- what is cached globally
- what is cached per ticker
- when metadata is stale
- when raw filing bodies should be downloaded
- when the local filing index needs to be updated before asking the model

The target architecture is:

- global issuer registry cache
- global filing metadata cache across the universe
- per-ticker filing-body cache
- incremental refresh that only pulls new accession numbers since last seen
- optional background warming for watchlist or recently viewed issuers

This gives the app the performance advantages of a finite-universe cache without turning the product into a full local SEC mirror.

## Why This Spec Exists

The current EDGAR workspace exposes acquisition internals directly to the user:

- identifier mode selection
- freeform form-type entry
- file-save mode selection
- exhibit behavior
- resume mechanics
- language about company-site PDFs inside the EDGAR tool

That is too implementation-shaped for the core product experience.

The user should not need to decide:

- whether they want the primary filing file or all filing files
- whether exhibits are worth saving
- whether they should type `8-K, 10-K, 10-Q`
- whether EDGAR and company-site PDFs are part of one mental model

Those are backend orchestration concerns.

## Product Principles

### 1. Company First

The primary unit of interaction is the issuer, not the file bundle.

### 2. Smart Defaults

The app should choose a sensible filing coverage policy automatically.

### 3. Metadata Broad, Bodies Narrow

Universe-wide metadata is cheap enough to cache locally.
Universe-wide raw filing bodies are not the right default for a desktop app.

### 4. Local-First Intelligence

The EDGAR tool should feed the local corpus/index/model pipeline cleanly.
It should not expose model concerns or inference settings in the sync UI.

### 5. Incremental by Default

Every rerun should be a delta update whenever possible.

## Goals

- reduce the EDGAR sync UI to one primary user input: issuer identity
- remove downloader jargon from the default flow
- separate EDGAR from the company-PDF workflow in the UI and copy
- make SEC metadata globally cached and reusable across the app
- make raw filing downloads ticker-scoped and incremental
- ensure the EDGAR sync experience works as the acquisition layer for the Qwen/oMLX intelligence stack

## Non-Goals

This spec does not attempt to:

- mirror all raw EDGAR filing bodies for all issuers onto the local machine
- expose local model controls in the EDGAR sync form
- replace the raw filing downloader with an embeddings-first system
- define the chunking or prompt strategy in detail
- make every historical filing immediately available offline before the user ever asks for it

## Product Outcome

From the user’s point of view, `Stock Intel > EDGAR Filings` should feel like:

- "pick a company"
- "keep its SEC filing library current"
- "ask grounded questions about the company’s filings"

The user should not be managing:

- form lists
- file-save modes
- SEC internals versus primary docs
- exhibit toggles
- PDF acquisition language

## Simplified User Experience

## Primary Surface

The default EDGAR panel should contain:

- one issuer field that accepts ticker, company name, or CIK
- one primary action: `Sync SEC filings`
- one compact sync status area
- one compact readiness area for local filing Q and A
- one filing question box once the ticker has enough local corpus to answer questions

Suggested user-facing labels:

- field label: `Company`
- placeholder: `Ticker, company name, or CIK`
- primary button: `Sync SEC filings`
- post-sync button: `Refresh filings`
- question input label: `Ask about SEC filings`

## Removed From the Default UI

The default EDGAR experience should not show:

- identifier mode switch
- `Form types`
- `Files to save`
- `Include exhibits`
- `Checksum resume`
- any mention of company-site PDFs

## Advanced Controls

If advanced controls are kept at all, they should live behind an `Advanced` disclosure and be clearly described as exceptions to the normal workflow.

Allowed advanced controls in phase 2:

- force refresh
- custom date window
- custom form-type override
- include-exhibits override
- export/debug paths

Phase 1 recommendation:

- do not surface advanced controls in the EDGAR workspace
- keep them available only through backend compatibility routes or CLI-oriented tooling

## Default Filing Coverage Policy

If the user only specifies the company, the backend still needs a filing policy.

Recommended phase 1 policy:

- domestic issuers:
  - `10-K`
  - `10-K/A`
  - `10-Q`
  - `10-Q/A`
  - `8-K`
  - `8-K/A`
- foreign/private issuers when applicable:
  - `20-F`
  - `20-F/A`
  - `40-F`
  - `40-F/A`
  - `6-K`
  - `6-K/A`

Amendment rule:

- amended variants of the covered filing families are included by default
- amendments are high-signal events and should be treated as priority filings for sync, indexing, and answer freshness
- when an amended filing supersedes or materially corrects an earlier filing, the answer path should prefer the amended filing while still preserving the original artifact locally when available

Optional phase 2 additions:

- `DEF 14A` for governance and compensation questions
- selected registration statements when they materially affect research workflows

Important rule:

- the user should not type these forms manually in the common case

## Smart Body Coverage Policy

The backend should separate metadata coverage from raw-body coverage.

### Metadata Coverage

For a resolved issuer:

- ingest the full available filing metadata history from the global metadata cache

### Raw Filing-Body Coverage

For a resolved issuer:

- download a smart working set of raw filing bodies for analysis

Recommended smart working set:

- the most recent `3` annual filings of the primary annual form
- the most recent `12` quarter-equivalent filings where applicable
- the most recent `24` months of current-report filings such as `8-K` or `6-K`
- any amendments to filings already covered by the smart working set
- any newer accession numbers discovered since the last ticker sync
- any older filings explicitly needed for a requested comparison or answer path

Amendment priority rule:

- if a newly discovered accession is an amendment to a covered filing family, the backend should prioritize body download and reindex even when the original filing is already cached
- amendment-driven refreshes should be treated as freshness-relevant because they may materially change a previously grounded answer

Why:

- this keeps the local corpus useful for research
- it prevents the default sync from ballooning on ticker histories with very large current-report volume
- it still allows deeper history to be hydrated on demand later
- it treats amended filings as correctness-sensitive, high-signal events rather than optional duplicates

## UX Copy Rules

The EDGAR tool must describe the outcome, not the downloader mechanics.

Preferred copy direction:

- "Sync SEC filings for this company and keep the local filing library current."
- "Recent filing bodies are cached locally for analysis."
- "Older filings can be pulled in automatically when needed."

Prohibited copy direction:

- references to `PDFs` inside the EDGAR tool
- references to `all filing files + SEC internals`
- references to checksum manifests in the default UI
- references that force the user to choose file bundle granularity

## User Flows

## Flow 1: First-Time Sync

1. user enters issuer query
2. backend resolves issuer from the global issuer registry cache
3. backend ensures the global metadata baseline is fresh enough and performs a live per-issuer submissions check when freshness matters
4. backend merges any newly discovered same-day accessions into the local metadata cache and ticker workspace state
5. backend downloads the smart working set of raw filing bodies
6. backend returns sync status and local readiness
7. backend queues or performs corpus/index build for filing Q and A

## Flow 2: Refresh Existing Ticker

1. user opens an existing ticker workspace
2. UI shows last metadata refresh, last body refresh, and last index refresh
3. user clicks `Refresh filings` or the app auto-refreshes in the background
4. backend consults the global metadata baseline and the live per-issuer submissions overlay for new accession numbers since last seen
5. any newly discovered same-day accessions are merged immediately into the local metadata cache
6. backend downloads only missing filing bodies required by policy
7. backend reindexes only the new or changed filings

## Flow 3: Ask a Filing Question

1. user asks a question in the EDGAR workspace
2. backend checks whether the ticker metadata and local corpus are fresh enough, consulting the live per-issuer submissions overlay when freshness matters
3. backend performs a lightweight live per-issuer submissions check if freshness matters
4. any newly discovered same-day accessions are merged immediately into the local metadata cache
5. backend performs a lightweight incremental sync if new accession numbers are available
6. backend downloads any newly required raw filing bodies
7. backend updates the ticker’s filing corpus/index incrementally
8. backend retrieves filing chunks and calls the local Qwen model through oMLX
9. backend returns a grounded answer with citations

This question flow is expanded further in the companion intelligence spec and must stay aligned with it.

## Architecture Overview

```mermaid
flowchart LR
    A["Issuer Query"] --> B["Issuer Resolver"]
    B --> C["Global Issuer Registry Cache"]
    B --> D["Global Filing Metadata Cache"]
    D --> E["Ticker Metadata State"]
    E --> F["Per-Ticker Filing Body Cache"]
    F --> G["Ticker Corpus and Index"]
    H["User Question"] --> I["EDGAR Research API"]
    G --> I
    I --> J["Qwen via oMLX"]
    J --> K["Grounded Answer with Citations"]
```

## Cache Architecture

## 1. Global Issuer Registry Cache

Purpose:

- resolve ticker, company name, and CIK quickly and locally
- avoid repeated live issuer lookup work

Scope rule:

- this cache is app-global
- it lives in one canonical configured cache root chosen by application settings
- per-request `outputDir` does not create or select a different issuer-registry cache

Recommended source:

- SEC issuer registry data such as `company_tickers.json`

Recommended storage:

```text
[configured app-global cache root]/
  .sec/
    issuer-registry/
      company_tickers.json
      issuer-registry.sqlite3
      freshness.json
```

Recommended behavior:

- refresh at most once every `24` hours by default
- persist both the original source artifact and a normalized local lookup index
- support exact ticker, exact CIK, normalized company-name, and partial company-name resolution

## 2. Global Filing Metadata Cache Across the Universe

Purpose:

- keep the app aware of the filing universe without downloading all raw filing bodies
- make most ticker refreshes cheap because baseline accession discovery is already local before any live freshness overlay check

Scope rule:

- this cache is app-global
- it lives in the same canonical configured cache root as the issuer registry cache
- per-request `outputDir` does not create, fork, or namespace the filing metadata cache
- freshness, warming, import jobs, and reuse are owned by this one app-global metadata cache

Recommended source:

- the SEC nightly submissions bulk archive as the baseline metadata corpus
- the SEC per-issuer submissions API as the live freshness overlay for active tickers

Optional secondary source:

- the SEC company facts bulk archive for structured XBRL fact enrichment

Recommended storage:

```text
[configured app-global cache root]/
  .sec/
    filing-metadata/
      submissions.zip
      submissions.sqlite3
      companyfacts.zip
      companyfacts.sqlite3
      freshness.json
      import-jobs/
```

Recommended behavior:

- refresh on a nightly cadence
- check `Last-Modified` before pulling a new bulk artifact when possible
- store the compressed bulk archive plus a normalized local query store
- keep file-count low by importing into SQLite rather than exploding every JSON file into the filesystem
- treat the nightly bulk import as the baseline metadata layer, not the sole freshness mechanism

Freshness overlay rule:

- nightly bulk metadata is the baseline
- live per-issuer submissions fetch is the freshness path for active tickers
- any new same-day accessions found live are merged into the local metadata cache immediately
- refresh and ask flows consult that live overlay when freshness matters
- if the live check fails, the system reports `stale` or `degraded` instead of pretending the cache is fresh

Important rule:

- this cache is universe-wide metadata only
- it is not permission to hydrate all raw filings for all issuers
- it is shared across all ticker workspaces in the app, even when a ticker sync writes filings under a non-default `outputDir`

## 3. Per-Ticker Filing-Body Cache

Purpose:

- preserve raw SEC artifacts for one issuer under the existing stock workspace layout
- provide stable source files for parsing, indexing, citation, and offline local Q and A

Recommended location:

```text
[ticker workspace root selected by `outputDir` or default research root]/
  stocks/
    [ticker]/
      [raw filing files]
      .edgar/
        metadata/
        exports/
        manifests/
        intelligence/
```

Rules:

- retain the current ticker-scoped filing storage shape
- keep raw filing bodies only for tickers the user has synced, warmed, or explicitly requested
- never treat the per-ticker cache as a disposable temporary store; it is the local source of truth for filing intelligence

## 4. Incremental Refresh Strategy

The app should think in terms of accession-set reconciliation, not just latest-accession watermarks.

Per ticker, track:

- `lastMetadataRefreshAt`
- `lastLiveOverlayCheckAt`
- `lastBodyRefreshAt`
- `lastIndexRefreshAt`

Per ticker, maintain an accession table keyed by accession number.

Minimum fields per accession:

- `accessionNumber`
- `form`
- `filingDate`
- `isAmendment`
- `discoveredVia` (`bulk` or `live`)
- `bodyStatus` (`pending`, `cached`, `failed`, `skipped`, `invalidated`)
- `indexStatus` (`pending`, `indexed`, `failed`, `invalidated`)
- `contentHash` or artifact fingerprint
- `selectedByPolicyVersion`

Per ticker, also track processing versions:

- `bodyCoveragePolicyVersion`
- `indexSchemaVersion`
- `chunkingVersion`
- `embeddingModelVersion`

Operational rule:

- `latestKnownAccession`, `latestBodyCachedAccession`, and `latestIndexedAccession` may still be retained as convenience stats
- they must not be treated as the source of truth for sync correctness
- the source of truth is accession membership plus per-accession body and index state under the current processing versions

Refresh algorithm:

1. resolve issuer
2. consult the global metadata cache for that issuer and the live per-issuer submissions overlay when freshness matters
3. reconcile issuer accession membership into the ticker’s accession table
4. identify the accession set required under the current `bodyCoveragePolicyVersion`, including amendments and any older backfills required by the answer path
5. mark newly required, missing, or invalidated accessions as `pending` for body download
6. download only the raw filing bodies whose body state is missing, failed, or invalidated
7. recompute `contentHash` or artifact fingerprints for newly downloaded or changed filings
8. mark filings as `pending` for reindex whenever content changed or any of `indexSchemaVersion`, `chunkingVersion`, or `embeddingModelVersion` changed
9. index only filings whose index state is pending, failed, or invalidated
10. update convenience watermarks and timestamps after successful reconciliation

## 5. Background Warming

Background warming is optional but useful.

Recommended warming targets:

- watchlist issuers
- recently viewed issuers
- recently asked-about issuers

Recommended warming order:

1. metadata refresh only
2. body-cache warming for the smart working set
3. background index build

Important constraint:

- warming should be opportunistic and bounded
- it should never silently escalate into downloading all filing bodies for all issuers

## Proposed Backend Responsibilities

## Public-Facing EDGAR Service

Keep the EDGAR service boundary in the backend, but split responsibilities more cleanly.

Recommended service split:

- `services/edgar_resolver.py`
  - issuer resolution through the global issuer registry cache
- `services/edgar_metadata_cache.py`
  - universe-wide metadata acquisition and normalization
- `services/edgar_sync.py`
  - ticker-scoped sync orchestration
- `services/edgar.py`
  - raw filing-body acquisition and artifact preservation
- `services/edgar_intelligence.py`
  - corpus/index orchestration for local filing Q and A

## API Contract

The default UI should move away from the current downloader-shaped contract.

Recommended public routes:

- `GET /api/sources/edgar/status`
- `POST /api/sources/edgar/sync`
- `POST /api/sources/edgar/workspace`
- `GET /api/sources/edgar/intelligence/status`
- `POST /api/sources/edgar/intelligence/index`
- `POST /api/sources/edgar/intelligence/ask`
- `POST /api/sources/edgar/intelligence/compare`

Selector contract:

- `POST /api/sources/edgar/sync` accepts an unresolved issuer input such as `issuerQuery`
- all post-sync ticker-scoped routes accept a resolved `ticker` plus optional `outputDir`
- if `outputDir` is omitted, the backend uses the configured research root for ticker-scoped artifacts
- `outputDir` only selects where ticker-scoped artifacts live under `stocks/[ticker]`
- app-global caches under `.sec/` always live in the canonical configured cache root and do not vary with `outputDir`
- if a non-default `outputDir` was used for sync, the same `outputDir` must be supplied on follow-up workspace and intelligence routes so the backend can resolve the same ticker workspace
- `POST /api/sources/edgar/workspace` is the source of truth for current ticker-scoped metadata, body-cache, and intelligence readiness state

Recommended `sync` request shape:

```json
{
  "issuerQuery": "NVIDIA",
  "outputDir": "/optional/research/root",
  "forceRefresh": false
}
```

Recommended `sync` response shape:

```json
{
  "issuerQuery": "NVIDIA",
  "resolvedTicker": "NVDA",
  "resolvedCompanyName": "NVIDIA CORP",
  "resolvedCik": "0001045810",
  "workspace": {
    "ticker": "NVDA",
    "outputDir": "/optional/research/root"
  },
  "metadataState": {
    "status": "fresh",
    "lastRefreshedAt": "2026-04-26T20:00:00Z",
    "newAccessions": 2
  },
  "bodyCacheState": {
    "status": "updated",
    "downloadedFilings": 2,
    "skippedFilings": 18
  },
  "intelligenceState": {
    "status": "queued",
    "lastIndexedAt": "2026-04-26T19:42:00Z",
    "jobId": "edgar-index-nvda-20260426-01",
    "polledVia": "/api/sources/edgar/intelligence/status?ticker=NVDA&outputDir=%2Foptional%2Fresearch%2Froot&jobId=edgar-index-nvda-20260426-01"
  }
}
```

Recommended `workspace` request shape:

```json
{
  "ticker": "NVDA",
  "outputDir": "/optional/research/root"
}
```

Recommended `workspace` response responsibilities:

- return the current ticker-scoped metadata freshness state
- return the current body-cache state
- return the current intelligence readiness state
- return last-sync summary and resolved storage paths for the selected ticker workspace

Async indexing rule:

- `sync` may perform small index updates inline or queue background indexing work
- if `intelligenceState.status` is `queued` or `indexing`, the response must include `jobId`
- the recommended poll selector is `ticker + outputDir + jobId`
- job progress and readiness are polled through `GET /api/sources/edgar/intelligence/status`
- `sync` must not report background indexing without a pollable route contract

Backward-compatibility recommendation:

- keep the current downloader-shaped request model temporarily for CLI or advanced compatibility
- stop using it as the primary frontend contract

## Frontend Responsibilities

Primary owner:

- `frontend/src/components/EdgarWorkspace.tsx`

Supporting owners:

- `frontend/src/features/stock-intel/requests.ts`
- `frontend/src/lib/api/sources.ts`

Frontend responsibilities after simplification:

- capture a single issuer query
- submit sync and refresh actions
- display cache/index freshness
- allow question asking once filings are ready
- render answer citations returned by the backend

Frontend non-responsibilities:

- choosing form defaults
- deciding body-cache policy
- selecting individual artifact classes
- managing the oMLX runner directly

## Model and oMLX Compatibility

This EDGAR simplification spec must work cleanly with the selected local AI stack:

- local runner: `oMLX`
- generation model: `mlx-community/Qwen3.6-35B-A3B-4bit`
- fallback generation model: `mlx-community/Qwen3.5-27B-4bit`

Compatibility rules:

- the EDGAR sync layer prepares raw filing inputs for the intelligence layer
- the intelligence layer decides when corpus/index updates are required
- the frontend never talks to oMLX directly
- the user never selects model parameters from the EDGAR sync form

Product implication:

- `Sync SEC filings` is not the same thing as `Ask the model`
- sync prepares the local research substrate
- ask uses that substrate to retrieve chunks and call oMLX

## Coordination with the Intelligence Spec

Implementation contract between specs:

- this document owns when a ticker is considered synced and fresh enough to answer from
- the intelligence spec owns how the local corpus is parsed, indexed, retrieved, reranked, and answered
- if a question arrives when the corpus is stale, the backend may run a bounded incremental sync before retrieval
- the answer path must always end in grounded citations to local filing artifacts

## Rollout Plan

## Phase 1

- simplify the EDGAR UI to one issuer field and one sync action
- remove PDF language from the EDGAR tool
- remove downloader-granularity controls from the default UI
- add global issuer registry cache
- add global filing metadata cache
- keep ticker-scoped raw filing-body cache
- enable incremental accession-based refresh

## Phase 2

- add optional background warming for watchlist and recent issuers
- add explicit readiness/status UX for filing Q and A
- add on-demand deep-history body hydration when a question requires older filings

## Phase 3

- refine smart working-set policy from real usage data
- optionally add advanced overrides for power users without polluting the default workflow

## Acceptance Criteria

- a new user can sync a company’s SEC filings without selecting form types or file-save modes
- the EDGAR UI contains no references to company-site PDFs
- the backend can resolve issuer identity through a global local cache
- the backend can detect new accession numbers cheaply from cached baseline metadata and use live per-ticker submissions checks when freshness matters
- raw filing-body downloads remain ticker-scoped rather than universe-wide
- a filing question can trigger a bounded incremental refresh and then flow into the local Qwen/oMLX answer path
- this spec and the companion intelligence spec describe one coherent end-to-end system
