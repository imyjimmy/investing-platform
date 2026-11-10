# Investing Platform feature audit

Reviewed November 9, 2026, against repository commit `9dcdb06` and the current local research library.

The app has substantial working infrastructure, but several screens overstate what the underlying implementation can do. The first repairs should address incorrect option contracts and risk figures, weak AI evidence validation, and market information that appears usable despite being assumed, static, or unverified. Data refresh and unfinished features come next.

## Scope and verification

The review covered the dashboard, account connectors, stock market screen, ticker information, all six options surfaces, SEC downloads, Qwen questions, company PDFs, crypto, provider settings, and desktop startup. Source tracing was supplemented with the existing test suites, isolated browser inspection, and small reproductions of specific defects. No application code was changed and no broker orders were placed.

| Check | Result | What it establishes |
| --- | --- | --- |
| Backend tests | 137 passed, 1 failed | Broad deterministic coverage; one date-dependent EDGAR fixture has expired. |
| Browser tests | 13 passed, 1 failed | Research UI, P&L controls, ticker and options navigation work with simulated responses/accounts. The market test depends on an unseeded local snapshot. |
| Frontend production build | Passed | TypeScript checks and bundling succeed. |
| Desktop Rust check | Passed with `cargo check --offline --locked` | Current desktop source compiles; this is not a clean-machine installation test. |
| Screen inspection | No JavaScript page errors in the inspected screens | Dashboard, stock/options screens, research, PDFs, leverage and settings rendered in an isolated mock session. |
| Desktop layout | No document overflow at 1510px on inspected screens; market, chain and builder also checked at 1280px | The supported desktop layout has a usable foundation. Mobile was not treated as a shipped requirement. |
| Installed app | Version 0.1.0; executable modified November 4, 2026 | The installed bundle is recent, but contains no verified commit identifier linking it to the reviewed checkout. |

Live IBKR/coinbase authentication, broker submission, company-site PDF discovery, public crypto quotes and real Qwen generation were not exercised. The configured backend and AI ports were not listening at the earlier status check; a stopped service alone is not a software defect. AI models and oMLX are present locally. Browser tests used isolated settings and disabled execution.

## Feature inventory

“Implemented” below means an actual UI/service path exists. It does not imply an external account or feed was verified live.

| Feature | Current state | Work remaining |
| --- | --- | --- |
| Dashboard and account summaries | Implemented; metric contracts and period behavior have tests | Reconcile totals and cash flows against live statements; add actual chart content. |
| Fidelity and other CSV folders | Implemented: positions, history paths, contribution-aware metrics and missing-history notices | Validate real export variations and refresh workflow. Fidelity downloading is a separate helper, not an embedded authenticated connector. |
| IBKR account connection and Flex history | Implemented; account routing, contribution history and stale-state handling have tests | Live gateway/Flex reconciliation and order lifecycle testing. Resolve the trading documentation mismatch. |
| Coinbase balances and P&L | Implemented with history and stale-cache handling | Live reconciliation; derivatives are explicitly excluded from parts of period P&L. |
| Stock Market screener | Working reader/filter for a saved scanner CSV | Latest local snapshot is March 25, 2026, with 14 rows. Add a refresh workflow and explicit universe coverage. |
| Ticker overview and financial statements | Implemented; mock browser flow passes | Verify actual IBKR/Finnhub entitlements and freshness. The Finnhub adapter intentionally omits estimate tables. |
| Stock orders | Preview/submit/cancel paths exist | Harden preview validity and duplicate submissions; verify using paper accounts before relying on the flow. |
| Options Chain | Implemented; quotes, expiry switching, ticket staging and symbol context work in mock checks | Verify live quote permissions, stale quote behavior and broker execution. |
| Options Builder and tickets | Substantial implementation with serious correctness defects | Preserve each leg’s expiry, obtain that leg’s quotes, and correct payoff calculations. |
| Options Valuation | Calculates several simple valuation models | Stop silently inventing missing earnings; expose and label model assumptions. |
| Options Structures | Groups positions by a strategy label | Reconstruct individual trades and legs; the current count is the number of label groups. |
| Options Volatility | Current-expiry IV averages, skew and highest-IV rows | A full term structure or historical volatility surface is not implemented here. |
| Options Scanner | Ranks contracts in the loaded chain | It is not a scan across tickers/expiries; expand only if that broader behavior is desired. |
| SEC filing library and watchlist | Implemented: issuer resolution, sync, caching, metadata and watchlist warming | Refresh stale local coverage and make downloaded versus indexed coverage explicit. |
| SEC-only Qwen questions | Retrieval, sections, XBRL facts, generation and citations exist | Strengthen claim validation, finish exhibit support, refresh the corpus, verify actual model responses, and add conversation state if chat is intended. |
| Filing comparisons | Backend and API client method exist | No frontend call site was found for the comparison method. Expose it or remove the implied product scope. |
| General stock intelligence | Backend endpoint and deterministic evidence formatter exist | No frontend caller; no Qwen synthesis in this path; the current EDGAR contribution falls back to readiness metadata. |
| Company PDFs | Real discovery/download implementation and UI | Add representative discovery tests and live checks. These PDFs are not part of the SEC question-answering corpus. |
| Crypto Market | Public OKX quote service and UI exist | Verify live availability, failure recovery and quote freshness. No dedicated OKX tests were found. |
| Crypto Leverage | Static display | Replace example numbers and commentary with feeds, or label the entire surface as a demo. |
| Provider settings | Finnhub has a real adapter; several other providers have key storage only | Implement retrieval and health checks before calling those providers ready. |
| Desktop installation and startup | Native shell compiles and starts the Python backend | Package the backend, manage AI startup, retain logs and show actionable startup errors. |
| Legacy scanner command | Separate ingestion/scoring command exists | Connect it to app refresh; default configuration has an old fixed date; several vendor adapters explicitly raise `NotImplementedError`. |

## Prioritized findings

There are 16 repair or completion items below: 7 high-priority issues (P1) and 9 follow-up issues (P2). This is a prioritized feature review, not a claim that these are every possible defect in the repository.

### F01 P1 Calendar and diagonal trades lose their intended expiries

The builder supplies different expiries for the legs, but `stageStructure` assigns the currently selected expiry to every leg. A reproduction requesting January 15, 2027 and December 18, 2026 produced two December 18, 2026 legs. A calendar can therefore become opposing trades in the same contract; a diagonal can become a vertical. The visible strategy description still describes the original intended trade.

The builder also passes `referencePrice: null` for a later-expiry leg, but `makeLeg` uses null-coalescing to replace that with the current-expiry quote. The expiry-change effect would clear a correctly constructed mixed-expiry plan, so fixing only the mapping is insufficient.

**Required outcome:** preserve each leg’s contract identity through staging and submission, fetch its own quote, and allow a legitimate mixed-expiry ticket to remain staged. Test calendar and diagonal contracts before any submission.

Sources: [ticket staging](/Users/imyjimmy/dev/investing-platform/frontend/src/features/options/OptionsWorkspace.tsx:549), [plan reset](/Users/imyjimmy/dev/investing-platform/frontend/src/features/options/OptionsWorkspace.tsx:185), [leg quotes](/Users/imyjimmy/dev/investing-platform/frontend/src/components/options/OptionToolWorkspaces.tsx:541), [calendar templates](/Users/imyjimmy/dev/investing-platform/frontend/src/components/options/OptionToolWorkspaces.tsx:1098).

### F02 P1 Ratio spreads display incorrect maximum profit and loss

The frontend treats any two-leg/two-strike structure as a bounded vertical. The backend checks common expiry, option type and opposing actions, but does not require equal leg ratios. Both paths accepted a one-long/two-short call structure with strikes 100/110 and a $1 credit, reporting maximum profit of $100 and maximum loss of $900. At an underlying expiry price of $200, the payoff is already negative $7,900; losses continue increasing beyond that price.

**Required outcome:** calculate bounds from actual signed leg quantities and contract types; represent unbounded outcomes explicitly. At minimum, only use the vertical formula for a validated equal-ratio vertical and show unsupported cases without invented bounds. The frontend and backend must share equivalent tested rules.

Sources: [frontend calculations](/Users/imyjimmy/dev/investing-platform/frontend/src/features/options/OptionsTradeTicket.tsx:303), [backend calculations](/Users/imyjimmy/dev/investing-platform/src/investing_platform/services/ib_gateway_order_helpers.py:85).

### F03 P1 SEC citations do not establish that the answer is supported

The validator checks citation IDs and selected numbers, names and directional words against all prompt evidence. It does not verify each claim against its cited passage. With evidence consisting only of `revenue was 100.`, both of these answers passed:

- `revenue was 100 [C1]. the company has no debt.`
- `the company has no debt [C1].`

**Required outcome:** require support for each factual claim from its cited evidence; reject uncited claims and citation mismatches. Add adversarial evidence tests and a real-model evaluation set covering unsupported claims, wrong periods, units, calculations and insufficient evidence. Citation presence alone must not imply verification.

Source: [answer validation](/Users/imyjimmy/dev/investing-platform/src/investing_platform/services/edgar_intelligence.py:1041).

### F04 P1 Valuation conclusions can use invented fundamentals

Missing EPS becomes 4% of the share price, or 5 when no price exists. Other fallbacks include 6% growth, a 16x terminal multiple, a fixed 10% discount rate and 4.5% bond yield. These inputs can produce fair-value and “attractive/expensive” conclusions. Some assumptions appear in model descriptions, but the synthetic EPS is not identified as missing reported data.

**Required outcome:** distinguish reported inputs, user assumptions and missing values. Suppress data-backed verdicts when necessary fundamentals are missing, or place the calculation in an explicitly labeled scenario mode with editable assumptions.

Source: [valuation inputs](/Users/imyjimmy/dev/investing-platform/frontend/src/components/options/OptionToolWorkspaces.tsx:1598).

### F05 P1 Provider readiness is reported without retrieval or validation

The registry for Polygon, Alpha Vantage, MarketBeat, Seeking Alpha, FactSet and Refinitiv/LSEG persists keys and flags. Its ready state follows from an enabled nonempty key. Saving an intentionally invalid placeholder key in an isolated temporary registry returned `status=ready` and `available=true`. No corresponding production retrieval adapters were found for this registry; similarly named legacy vendor classes are explicit stubs.

**Required outcome:** separate “credentials saved,” “connection verified,” and “data available.” Implement the needed adapters and entitlement checks; keep unsupported sources visibly planned.

Sources: [provider status](/Users/imyjimmy/dev/investing-platform/src/investing_platform/services/market_data_sources.py:150), [legacy stubs](/Users/imyjimmy/dev/investing-platform/src/options_scanner/providers/vendor_stubs.py:1).

### F06 P1 Crypto Leverage presents fixed figures as market context

Open interest of $28.4B, funding of 0.018%, basis of 4.2%, “Long-heavy” crowding and the BTC/ETH commentary are constants. The open-interest hint mentions a placeholder, but the other figures and stable/watch labels can look like measured conditions.

**Required outcome:** connect timestamped derivatives feeds and define the calculations, or label the complete surface as a demonstration and remove current-market interpretations.

Source: [Crypto Leverage](/Users/imyjimmy/dev/investing-platform/frontend/src/features/crypto/CryptoLeverageWorkspace.tsx:6).

### F07 P2 Trading behavior and lifecycle need a clear contract

The README says live-account routing is blocked. The current execution guard only checks whether execution is enabled; it does not enforce a paper account. That documentation is materially stale. The UI requires a matching preview, but the submit API accepts an order request directly, without a preview token, preview expiry or an idempotency key. A successful submission also leaves the existing matching preview usable.

**Required outcome:** document the actual supported account modes; implement the intended server-side preview and retry policy; test rejected, pending, partially filled, repeated and cancelled submissions using a fake broker and then an explicitly controlled paper account. This finding does not imply that supporting live accounts is itself unintended.

Sources: [stale documentation](/Users/imyjimmy/dev/investing-platform/README.md:254), [execution guard](/Users/imyjimmy/dev/investing-platform/src/investing_platform/services/ib_gateway_execution.py:498), [submission](/Users/imyjimmy/dev/investing-platform/src/investing_platform/services/ib_gateway_execution.py:99), [preview state](/Users/imyjimmy/dev/investing-platform/frontend/src/components/trading/useTradeTicket.ts:32).

### F08 P2 The stock screener has no app refresh pipeline

The screen reads the latest dated CSV under `data/scored`. The latest local file is March 25, 2026 and contains only 14 candidates. The UI does display the snapshot date and a stale tone, which should be retained. Refreshing the page only rereads this file; it does not rerun ingestion. The separate scanner command’s example configuration also fixes an old March 2026 date.

**Required outcome:** add a deliberate refresh job with progress, failure recovery, current as-of date and universe coverage. Keep the previous result visibly stale if refresh fails.

Sources: [snapshot reader](/Users/imyjimmy/dev/investing-platform/src/investing_platform/services/universe_screener.py:17), [scanner command](/Users/imyjimmy/dev/investing-platform/src/options_scanner/main.py:28), [default date](/Users/imyjimmy/dev/investing-platform/configs/example_config.yaml:87).

### F09 P2 The AI corpus is older and narrower than the download library

The local library contains 101 nonempty filing folders across six tickers, including 28 8-K folders. NVDA’s saved index was last built May 8, 2026 and contains only 5 of 35 eligible downloaded filings; IREN’s May 8 index contains 50 of 50. Ask-time maintenance intentionally has small document/time budgets, so downloading and indexing should not be presented as equivalent completion.

The corpus builder reads primary documents. Explicit exhibit indexing returns `exhibits_not_supported`; separately downloaded company PDFs are not added to this corpus. Downloaded exhibits can therefore exist without being available to the answerer.

**Required outcome:** refresh selected issuers, complete indexing with visible coverage, and implement supported exhibit extraction. Show the exact searchable filings and dates before answering. Test earnings-release and guidance questions whose evidence is in exhibits.

Sources: [index budget](/Users/imyjimmy/dev/investing-platform/src/investing_platform/services/edgar_sync.py:40), [exhibit rejection](/Users/imyjimmy/dev/investing-platform/src/investing_platform/services/edgar_intelligence.py:233), [primary-document corpus](/Users/imyjimmy/dev/investing-platform/src/investing_platform/services/edgar_intelligence.py:1501).

### F10 P2 Several intelligence capabilities stop short of a usable feature

The SEC question request contains one question and filters, without previous conversation turns. The interface displays the current response rather than a persistent conversation. Filing comparison has a backend and client wrapper but no UI call site.

The separate general stock intelligence endpoint has no frontend caller. It formats typed evidence deterministically; it does not call Qwen. Its optional EDGAR evidence adapter is absent on the current downloader, so that collector falls back to readiness metadata. News, transcripts, investor PDFs and consensus providers are not implemented as a complete evidence pipeline for it.

**Required outcome:** finish the intended SEC research workflow first. Add conversation state and comparison controls if desired. Treat broader multi-source research as a separate unfinished capability with explicit source selection, rather than silently broadening SEC-only answers.

Sources: [question schema](/Users/imyjimmy/dev/investing-platform/src/investing_platform/models.py:1641), [stock intelligence service](/Users/imyjimmy/dev/investing-platform/src/investing_platform/services/stock_intelligence.py:36), [EDGAR collector](/Users/imyjimmy/dev/investing-platform/src/investing_platform/services/stock_intelligence.py:151), [formatter](/Users/imyjimmy/dev/investing-platform/src/investing_platform/services/stock_intelligence.py:233), [frontend API wrapper](/Users/imyjimmy/dev/investing-platform/frontend/src/lib/api/intelligence.ts:4).

### F11 P2 Desktop startup depends on the development environment

The native app resolves its project root from the build-time Cargo directory, launches that checkout’s Python environment, discards backend output, and waits for an open TCP port. It does not verify application health or surface a timeout as a startup failure. The native setup starts the backend only; oMLX autostart is in the development shell launcher. The installed bundle contains an executable and icon, without a bundled Python backend.

**Required outcome:** make native startup manage its actual dependencies, retain diagnostic logs, expose retryable startup/model errors, and package or explicitly install a versioned backend. Verify a cold launch from the installed app without developer terminals.

Sources: [native startup](/Users/imyjimmy/dev/investing-platform/frontend/src-tauri/src/lib.rs:35), [backend launch](/Users/imyjimmy/dev/investing-platform/frontend/src-tauri/src/lib.rs:95), [checkout dependency](/Users/imyjimmy/dev/investing-platform/frontend/src-tauri/src/lib.rs:133), [development AI startup](/Users/imyjimmy/dev/investing-platform/scripts/dev_dashboard.sh:60).

### F12 P2 The P&L chart switch does not show a chart

The control changes only its own appearance. Its comment and browser test explicitly define it as visual-only. Month/quarter selection does change metrics correctly in tests; the chart capability is the unfinished part.

**Required outcome:** provide a dated portfolio/P&L series and connect the switch to a real chart, or remove/disable the switch until that content exists.

Source: [chart switch](/Users/imyjimmy/dev/investing-platform/frontend/src/components/account-sources/PnlPeriodControl.tsx:116).

### F13 P2 Options surfaces have narrower scope than their names suggest

Structures groups all positions by `strategyTag`, rather than identifying each spread or multi-leg trade. Volatility summarizes the loaded expiry; Scanner sorts contracts in the loaded chain. These are real computations, but they do not provide a full volatility surface, an across-market scan or trade-level structure reconstruction. Covered Put is explicitly unavailable, and stock-plus-option templates need clear treatment of an existing versus newly submitted stock leg.

**Required outcome:** clarify these scopes now, then implement the broader behaviors that are actually needed. For Structures, group by account, underlying, expiries and identified legs before presenting aggregate risk or a trade count.

Sources: [Structures](/Users/imyjimmy/dev/investing-platform/frontend/src/components/options/OptionToolWorkspaces.tsx:1375), [Volatility](/Users/imyjimmy/dev/investing-platform/frontend/src/components/options/OptionToolWorkspaces.tsx:1436), [Scanner](/Users/imyjimmy/dev/investing-platform/frontend/src/components/options/OptionToolWorkspaces.tsx:1498), [Covered Put](/Users/imyjimmy/dev/investing-platform/frontend/src/components/options/OptionToolWorkspaces.tsx:753).

### F14 P2 Provider credential storage is inconsistent

Finnhub and the general provider registry write raw keys to JSON without setting owner-only permissions. The existing Finnhub settings file was observed with mode `0644`, which permits other local users to read the file if parent-directory access allows it. IBKR configuration already applies `0600`. No key values were included in this review.

**Required outcome:** use a consistent credential store, preferably the OS keychain; at minimum apply owner-only permissions and atomic writes to all credential files, including existing ones.

Sources: [Finnhub persistence](/Users/imyjimmy/dev/investing-platform/src/investing_platform/services/finnhub.py:328), [provider persistence](/Users/imyjimmy/dev/investing-platform/src/investing_platform/services/market_data_sources.py:259), [IBKR persistence](/Users/imyjimmy/dev/investing-platform/src/investing_platform/services/ibkr_connectors.py:470).

### F15 P2 Tests and release checks miss the highest-impact paths

The backend failure uses a November 1, 2023 filing and expects it inside a rolling 1,095-day window; that date has now aged out. The browser market test assumes SMCI exists in the latest local CSV, but it does not. Both failures need deterministic test data rather than arbitrary production-code changes.

The existing suites do not adequately exercise multi-leg contract preservation, payoff mathematics, actual model claims, company PDF discovery, live feed entitlement failures or the installed-app startup path. No repository CI workflow was found. Python requirements are largely lower bounds and oMLX installation follows an unpinned Git repository, so fresh installations can differ.

**Required outcome:** freeze dates and seed snapshots in tests; add focused regression coverage for F01–F05 and order lifecycle behavior; create reproducible dependency and release checks. Keep simulated UI tests and real integration validation visibly distinct.

Sources: [dated fixture](/Users/imyjimmy/dev/investing-platform/tests/test_edgar_service.py:260), [market browser test](/Users/imyjimmy/dev/investing-platform/frontend/tests/runtime-qa.spec.mjs:9), [Python dependencies](/Users/imyjimmy/dev/investing-platform/requirements.txt:1), [oMLX installer](/Users/imyjimmy/dev/investing-platform/scripts/install_omlx.sh:10).

### F16 P1 Some core controls lack accessible names and tab behavior

Browser inspection found four market-filter sliders and two market-filter select controls without associated labels or accessible names. The research tab list exposes tab roles, but pressing ArrowRight on SEC Tool leaves focus there; roving focus and tab-panel relationships are absent. These impede screen-reader and expected keyboard navigation.

**Required outcome:** associate labels with all six market controls, implement tab keyboard interaction and panel relationships, and verify keyboard/screen-reader behavior. Accessible names relate to [WCAG 4.1.2](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html); tab behavior should follow the [W3C tab interaction pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) rather than relying on role attributes alone.

Sources: [range controls](/Users/imyjimmy/dev/investing-platform/frontend/src/features/stocks/market/StockMarketWorkspace.tsx:526), [select controls](/Users/imyjimmy/dev/investing-platform/frontend/src/features/stocks/market/StockMarketWorkspace.tsx:284), [tabs](/Users/imyjimmy/dev/investing-platform/frontend/src/components/ui/ChromeTabs.tsx:15).

## What is worth keeping

- The Python service, React screens and Tauri shell all have a usable implementation foundation; both frontend and native compilation succeed.
- Account metrics use a common schema. Missing period history can remain unavailable instead of becoming a misleading zero, and the browser tests exercise that behavior.
- SEC resolution, download caching, watchlist persistence, section parsing, XBRL citations and model failure handling have meaningful deterministic tests.
- Expiry/symbol navigation and ticker financial views work in mock browser checks.
- The frontend already uses lazy-loaded workspaces. The main application JavaScript bundle was approximately 209 kB before gzip, with heavier screens split out.
- Source notices, stale indicators and explicit limitations exist in several services and should be extended consistently.

## Desktop UI technical assessment

This is a limited technical assessment, not a full accessibility conformance or performance certification.

| Dimension | Score out of 4 | Evidence |
| --- | --- | --- |
| Accessibility | 2 | Six unnamed controls and incomplete research-tab keyboard behavior; other inspected inputs had labels. |
| Performance | 3 | Lazy workspace bundles and no observed page exceptions; no full runtime profile was performed. |
| Responsive desktop layout | 3 | No document overflow in the checked desktop sizes; no mobile claim is made. |
| Theming | 3 | A coherent token-based dark interface with some repeated literal colors; no alternate-theme requirement was assumed. |
| Implementation integrity | 1 | Several important surfaces report example/assumed/unverified information or incomplete behavior as usable functionality. |
| Total | 12 of 20 | Significant work is concentrated in functionality and truthful states. |

The mechanical UI scan flagged one sidebar width animation at `frontend/src/index.css:555`. It is confined to the narrow-screen breakpoint and was not observed to cause a desktop performance problem, so it is not a release blocker in this audit. Small target counts alone were not treated as confirmed accessibility violations without evaluating spacing exceptions. No visual redesign is required to repair the core findings.

## Recommended repair sequence

1. **Correct the options contract and risk paths:** F01 and F02, then the preview/submission lifecycle in F07. Acceptance requires exact contract preservation and mathematically correct or explicitly unsupported bounds.
2. **Make research and market information trustworthy:** F03–F06. Acceptance requires rejecting the reproduced unsupported AI claims, showing assumed data as assumptions, and separating saved credentials from verified data availability.
3. **Restore fresh coverage:** F08 and F09. Add controlled refresh/index jobs with coverage and progress; verify actual SEC/model behavior.
4. **Finish the desktop and research workflow:** F10–F13. Prioritize cold app startup, SEC research, and the unfinished controls users actually need.
5. **Stabilize delivery and accessibility:** F14–F16. Standardize credential handling, deterministic regression tests and release checks; correct control labels and tab navigation. Finish with a bounded UI polish pass after behavior is correct.

The audit does not establish that every older dependency or model needs replacement. Upgrade choices should follow compatibility checks and representative real feature evaluations.
