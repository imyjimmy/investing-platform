# EDGAR Section, XBRL, and Citation Upgrade Spec

Prepared 2026-05-02.

## Status

Implementation spec for upgrading the existing Stock Intel SEC/Qwen workflow with:

- section-aware extraction for `10-K`, `10-Q`, and `8-K` families
- structured XBRL filing fields and fact citations
- stronger filing-level citations across text and numeric evidence

This spec intentionally builds on the current EDGAR stack instead of introducing a new filing pipeline.

## Product Goal

The SEC tab and Qwen Intelligence tab should answer filing questions with evidence that is both easy to inspect and mechanically grounded:

- "What changed in Item 1A risk factors versus the prior 10-K?"
- "Summarize the latest 8-K guidance items."
- "What did management say about margin pressure in MD&A?"
- "Which XBRL facts support the revenue and operating income comparison?"

The answer path should cite the filing, accession, form, filing date, source URL, local source path, and section or XBRL concept used.

## Existing Infrastructure To Reuse

The repo already has the right shape for this upgrade:

- `src/investing_platform/services/edgar.py`
  - resolves issuers
  - selects the smart working set of annual, quarterly, and current-report filings
  - downloads primary documents into ticker-scoped stock folders
  - exports `matched-filings.json` and `matched-filings.csv`
- `src/investing_platform/services/edgar_intelligence.py`
  - reads synced primary documents
  - writes `filing-corpus.json`, `sections.jsonl`, `chunks.jsonl`, `embeddings.f16.npy`, and `retrieval.sqlite3`
  - retrieves/reranks evidence before Qwen sees it
  - returns guarded answers with citations
- `src/investing_platform/models.py`
  - already includes `EdgarQuestionCitation.section`
  - already has citation fields for accession, form, filing date, document name, text range, source path, and SEC URL
- `src/investing_platform/services/edgar_metadata_cache.py`
  - already refreshes the SEC `companyfacts.zip` baseline
- frontend Stock Intel
  - already separates `SEC Tool` from `Qwen Intelligence`
  - can receive richer backend citation payloads without changing the high-level user workflow

The important design constraint: keep sync, indexing, retrieval, and Qwen invocation in the existing backend-owned flow.

## Current Gap

Today, the intelligence index treats each primary filing as one flattened document:

- `sections.jsonl` receives a single `"Primary Document"` section
- every chunk in `retrieval.sqlite3` uses `"Primary Document"` as its section
- citations are filing-level and chunk-level, but not truly section-level
- `isXBRL` and `isInlineXBRL` are exported, but structured company facts are not parsed into issuer-level evidence

That means the workflow is trustworthy enough to avoid uncited claims, but the evidence is less precise than it should be.

## Design Principles

1. Keep acquisition unchanged.
   The EDGAR sync layer should continue downloading raw SEC artifacts exactly as served.

2. Upgrade corpus building first.
   Section extraction belongs between raw filing files and embeddings, not inside Qwen prompts.

3. Keep schemas additive.
   Existing API clients should continue working if new fields are absent.

4. Use graceful fallback.
   If parsing fails, keep the current `"Primary Document"` behavior and record a limitation.

5. Test with synthetic SEC-like fixtures.
   The test suite should not require live SEC requests or a real local Qwen model.

## Section Extraction

### Scope

Phase 1 should support:

- `10-K`, `10-K/A`
- `10-Q`, `10-Q/A`
- `8-K`, `8-K/A`
- foreign equivalents only where the existing working-set policy already includes them, as fallback-compatible future work

### Data Shape

Add section metadata to extracted sections and chunks:

```json
{
  "section": "Item 1A. Risk Factors",
  "sectionCode": "1A",
  "sectionTitle": "Risk Factors",
  "sectionType": "risk_factors",
  "startChar": 12345,
  "endChar": 67890
}
```

Keep the existing `section` field populated for backward compatibility. Add new fields only where useful.

### Parser Placement

Add a focused helper next to `edgar_intelligence.py`, for example:

- `src/investing_platform/services/edgar_filing_sections.py`

Suggested public function:

```python
def extract_filing_sections(
    *,
    form: str,
    text: str,
    filing_items: str | None = None,
) -> list[dict[str, Any]]:
    ...
```

`edgar_intelligence._build_corpus_documents(...)` should call this after `_extract_text(...)` and before `_chunk_text(...)`.

### 10-K and 10-Q Strategy

Use regex-based heading detection over normalized plain text:

- identify headings such as `Item 1.`, `Item 1A.`, `Item 1B.`, `Item 2.`, `Item 3.`, `Item 7.`, `Item 7A.`, `Item 8.`
- normalize common variants:
  - `ITEM 1A`
  - `Item 1A - Risk Factors`
  - `Item 7 Management's Discussion and Analysis`
  - `Item 7A Quantitative and Qualitative Disclosures About Market Risk`
- prefer later body headings over table-of-contents duplicates when duplicate item sequences appear close together
- preserve section order and character offsets in the flattened extracted text

Known section types:

- `business`
- `risk_factors`
- `unresolved_staff_comments`
- `properties`
- `legal_proceedings`
- `mda`
- `market_risk`
- `financial_statements`
- `controls_and_procedures`

### 8-K Strategy

Use both metadata and document text:

- use `filing["items"]` as a strong hint when present
- detect headings such as `Item 2.02. Results of Operations and Financial Condition`
- split on detected `Item N.NN` boundaries
- if no heading is found but `items` metadata exists, label the whole document using those items
- fall back to `"Primary Document"` when neither source is usable

Known 8-K section types:

- `results_of_operations`
- `reg_fd_disclosure`
- `other_events`
- `financial_statements_and_exhibits`
- `entry_into_material_agreement`
- `departure_of_directors_or_officers`

### Chunking Changes

Current chunking can remain word-window based.

The only required change is to chunk inside each parsed section:

```text
filing -> section list -> chunk each section -> write chunks with section metadata
```

This avoids a large refactor of embeddings, retrieval, reranking, or Qwen prompting.

## XBRL Filing Fields

### Scope

There are two useful levels:

1. Filing metadata fields:
   - already present: `isXBRL`, `isInlineXBRL`
   - keep exporting these in matched filing metadata

2. Structured XBRL facts:
   - concept name
   - label
   - taxonomy
   - unit
   - value
   - period start/end or instant
   - fiscal year/period
   - form
   - filing date
   - accession number
   - frame, if available

Phase 1 should implement a compact issuer-scoped fact extractor from the existing `companyfacts.zip` baseline or SEC companyfacts JSON payloads. It does not need to index the entire SEC XBRL universe.

### Storage

Add ticker-scoped derived artifacts under the existing intelligence directory:

```text
stocks/[ticker]/.edgar/intelligence/xbrl/
  facts.jsonl
  concepts.json
  facts.sqlite3
```

Do not mutate raw EDGAR artifacts.

Suggested `facts.sqlite3` table:

```sql
CREATE TABLE facts (
  fact_id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  cik TEXT NOT NULL,
  accession_number TEXT,
  form TEXT,
  filing_date TEXT,
  concept TEXT NOT NULL,
  label TEXT,
  taxonomy TEXT,
  unit TEXT,
  value_text TEXT NOT NULL,
  value_number REAL,
  period_start TEXT,
  period_end TEXT,
  instant TEXT,
  fiscal_year INTEGER,
  fiscal_period TEXT,
  frame TEXT,
  source_url TEXT
);
```

### Retrieval Integration

Do not force XBRL facts into the same text chunk table immediately.

Recommended phase 1:

- keep text chunks in `retrieval.sqlite3`
- keep structured facts in `xbrl/facts.sqlite3`
- at ask time, detect numeric/financial fact questions and retrieve relevant XBRL facts alongside text chunks
- include XBRL facts as separate evidence blocks in the Qwen prompt
- return fact citations in the same response `citations` array with additive fields

This keeps the current retrieval path intact while making numeric answers more precise.

## Filing-Level Citations

### Current State

Text citations already include:

- citation id
- ticker
- accession number
- form
- filing date
- document name
- section
- chunk id
- text range
- snippet
- source path
- SEC URL

### Upgrade

Keep existing citation fields and add optional fields:

```python
sectionCode: str | None = None
sectionTitle: str | None = None
sectionType: str | None = None
evidenceType: Literal["text", "xbrl_fact"] = "text"
xbrlConcept: str | None = None
xbrlUnit: str | None = None
xbrlPeriod: str | None = None
xbrlValue: str | None = None
```

The frontend can keep rendering existing citation cards while progressively adding richer labels:

- `10-K filed 2026-01-30 - Item 1A Risk Factors`
- `10-Q filed 2026-04-30 - us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax`

### Citation Rules

Every answer should preserve the current guardrails:

- generated claims must include citation markers
- fabricated citation ids are rejected
- unsupported numbers are rejected unless present in retrieved text or XBRL fact evidence
- proper nouns and directional terms remain validated against evidence

The validator should consider both:

- retrieved filing text
- retrieved structured XBRL facts

## Implementation Plan

### Phase 1: Section-Aware Text Corpus

1. Add `edgar_filing_sections.py`.
2. Parse sections from `_extract_text(...)` output.
3. Update `_build_corpus_documents(...)` to write real sections.
4. Keep `"Primary Document"` fallback.
5. Add section metadata columns to `retrieval.sqlite3` only if needed; otherwise keep additive metadata in JSONL first.
6. Verify Qwen prompts include section labels without changing the ask route.

### Phase 2: Citation Metadata Upgrade

1. Add optional citation model fields.
2. Pass section code/title/type through retrieved chunks.
3. Update citation cards to show richer section labels.
4. Keep existing fields stable for route compatibility.

### Phase 3: Issuer-Scoped XBRL Facts

1. Add a compact XBRL fact extractor.
2. Populate `xbrl/facts.jsonl` and `xbrl/facts.sqlite3`.
3. Add fact retrieval for numeric questions.
4. Include fact evidence in Qwen prompts.
5. Extend answer validation to treat fact values as supported numbers.

## Test Strategy

The tests should be broad enough to protect SEC coverage without relying on live SEC or real oMLX.

### Unit Tests: Section Parser

Add `tests/test_edgar_filing_sections.py`.

Coverage:

- extracts `Item 1A. Risk Factors` from 10-K text
- extracts `Item 7. Management's Discussion and Analysis` from 10-K text
- extracts `Item 2. Management's Discussion and Analysis` from 10-Q text
- extracts `Item 2.02` and `Item 9.01` from 8-K text
- ignores obvious table-of-contents duplicates
- preserves monotonic start/end offsets
- falls back to `Primary Document` when no headings are found
- handles uppercase headings, missing periods, nonbreaking spaces, and extra whitespace

### Service Tests: Corpus Artifacts

Extend `tests/test_edgar_intelligence.py`.

Coverage:

- `index_workspace(...)` writes multiple rows to `sections.jsonl`
- `chunks.jsonl` contains section metadata for each chunk
- `retrieval.sqlite3` stores section labels and returns them during retrieval
- citations from `_citations_for_chunks(...)` include section labels
- parser fallback still produces one indexed document when section extraction fails

### Service Tests: XBRL Facts

Add tests with small local fixtures rather than downloading the full SEC archive.

Coverage:

- parses a synthetic companyfacts-style JSON object into normalized fact rows
- links fact rows to accession numbers and filing dates where available
- stores facts in `facts.sqlite3`
- retrieves relevant facts for questions containing terms like revenue, operating income, cash, debt, shares, margin
- answer validator accepts cited numbers that are present in XBRL fact evidence
- answer validator rejects numbers absent from both text chunks and fact evidence

### Route Tests

Extend `tests/test_edgar_routes.py`.

Coverage:

- ask response still serializes old citation fields
- ask response serializes optional section fields when present
- ask response serializes optional XBRL fact fields when present
- older fake service responses without new fields remain valid

### Frontend Runtime QA

Extend `frontend/tests/edgar-runtime-qa.spec.mjs`.

Coverage:

- SEC tab still syncs without exposing advanced downloader controls
- Qwen Intelligence tab still asks against a synced workspace
- citation card renders `Item 1A Risk Factors` when section metadata is present
- citation card renders accession/form/date/source link as before
- numeric/XBRL citations render without breaking existing text citations

### Regression Tests

Keep the existing EDGAR slice green:

```bash
.venv/bin/python -m pytest \
  tests/test_edgar_intelligence.py \
  tests/test_edgar_service.py \
  tests/test_edgar_metadata_cache.py \
  tests/test_edgar_routes.py
```

Add the new parser/XBRL tests to that same local verification command once implemented.

## Non-Goals

This upgrade should not:

- replace the EDGAR downloader
- move Qwen calls into the frontend
- require users to choose SEC sections manually
- mirror the entire SEC companyfacts corpus into ticker workspaces
- make XBRL fact retrieval mandatory for every qualitative question
- require a full-text search engine or vector database migration in phase 1

## Acceptance Criteria

The upgrade is complete when:

- indexed 10-K and 10-Q chunks carry real item-level section labels
- indexed 8-K chunks carry current-report item labels when available
- citations display filing-level metadata plus section-level metadata
- XBRL fact artifacts exist for a synced issuer with concept, value, period, unit, form, filing date, and accession metadata
- numeric answers can cite XBRL facts and pass validation without relying on model memory
- existing EDGAR sync, Qwen ask, and compare routes remain backward compatible
- the SEC unit, service, route, and frontend runtime tests cover the new behavior
