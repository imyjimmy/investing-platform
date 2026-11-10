# SEC research storage redesign

Scope: the 17 distinct holdings in `Portfolio_Positions_Nov-09-2026.csv`, expanded at the user's request to ticker folders already in `Finances/research/stocks` and seven additional major companies. Cash/core positions are excluded; options count toward their underlying stock. No account identifiers, quantities or balances are copied into the research catalog.

The 41-ticker universe: AAOI, AAPL, AEHR, AMD, AMZN, ANNA, ASST, AVGO, AXTI, BE, BNO, CIFR, COHR, FLNG, FRO, GLD, GLNG, GOOG, GROY, IAU, IBIT, INTC, IREN, KRKNF, LITE, MARA, META, MSFT, MSTR, MU, NET, NTR, NUAI, NUE, NVDA, OBE, ORCL, PYPL, TSLA, VOO and VOXR. The added companies are MSFT, AMZN, GOOG, META, TSLA, AVGO and ORCL; AAPL was already a research folder.

KRKNF has SEC CIK `0001499289` and historical Form D submissions, but no annual/quarterly/current reports in this five-year window. Its available SEC metadata is retained with a metadata-only coverage label. Its financial statements are published through SEDAR+, so the existing research PDF is not passed off as SEC evidence. The non-ticker `londonlink` folder is preserved outside the SEC corpus. [Kraken's SEC identity](https://www.sec.gov/Archives/edgar/data/1499289/000106299318001288/primary_doc.xml), [Kraken financial reports](https://www.krakenrobotics.com/investors/financial-reports/).

## Finding and choice

The previous `.sec` cache occupied 13,770,542,898 bytes. Its market-wide submissions database alone occupied 10,841,677,824 bytes; two bulk ZIP archives occupied another 2,919,060,813 bytes. A normal issuer sync called the bulk-baseline downloader. Company financial-fact extraction required the entire companyfacts archive. This was an inefficient default for a personal holdings library.

The chosen design keeps original SEC documents, fetches metadata and financial facts by issuer, and uses local SQLite tables plus rebuildable search indexes. This is an engineering choice for this workload, not a storage format mandated by the SEC. A market-wide research warehouse could justify bulk ingestion and columnar analytics storage; this holdings list does not require that infrastructure.

## Which SEC data to use

| SEC source | Use in this library |
|---|---|
| Submissions API, including its historical-file references | Complete available filing metadata for each issuer; CIK and accession are stable identities. |
| Companyfacts API | All available standardized company financial facts, cached separately by CIK. Original period dates, units, filing accessions and amended filings remain distinct. |
| Original filing documents and textual EX-99 exhibits | Narrative disclosures, detailed tables and reliable citation targets. |
| Financial Statement Data Sets | Useful for broad comparisons of face financial statements; not required as another duplicated holdings cache. |
| Financial Statement and Notes Data Sets | A possible future source for normalized custom/dimensional disclosures. Original filings remain the current source for those details. |
| Fund-series filing feed and original N-PORT XML | VOO-specific report selection and structured portfolio holdings, rather than treating every Vanguard filing as a VOO filing. |

The SEC publishes issuer API feeds throughout the day and also offers nightly all-filer archives. Companyfacts covers standardized, entity-wide facts; it does not replace the complete filing or every custom/segment disclosure. [SEC API documentation](https://www.sec.gov/search-filings/edgar-application-programming-interfaces).

The quarterly Financial Statement Data Sets contain face-statement numbers; the broader Statement and Notes datasets include detailed numbers and text, with monthly updates. Those serve different purposes from a current issuer document library. [Financial Statement Data Sets](https://www.sec.gov/data-research/sec-markets-data/financial-statement-data-sets), [Statement and Notes Data Sets](https://www.sec.gov/data-research/sec-markets-data/financial-statement-notes-data-sets).

N-PORT is fund portfolio data, and its bulk datasets are published quarterly. This rebuild uses original selected fund reports without downloading the entire fund universe. [SEC N-PORT Data Sets](https://www.sec.gov/data-research/sec-markets-data/form-n-port-data-sets), [SEC Data Library](https://www.sec.gov/data-research/sec-markets-data).

## Storage and refresh behavior

- Original filing HTML/XML and textual EX-99 exhibits remain under `research/stocks/TICKER/DATE_FORM_ACCESSION/`. Downloads retain SEC source URLs and checksums.
- Filing metadata stays in the existing indexed SQLite catalog, compacted to locally used issuers. Compaction verifies retained rows and database integrity before replacement. Existing issuer snapshots and all non-bulk updates are preserved, including issuers outside this holdings list.
- Catalog identity is the pair `(CIK, accession)`: ownership and joint filings may appear under multiple issuers. The old accession-only key lost nine historical issuer associations for META and MU. Schema migration preserves existing rows, and the missing associations were restored from the saved SEC sources. Verification now compares the catalog against every recent and historical source accession for each issuer.
- Each company's exact SEC facts response is compressed into `.sec/filing-metadata/companyfacts/CIK##########.json.gz`, with source URL, checksum and refresh state. Failed refreshes preserve the prior source and report stale status. Unchanged issuers can reuse a facts feed for up to 24 hours; a forced refresh bypasses that cache.
- Each issuer's normalized financial facts remain in SQLite. JSON decimals are parsed without an intermediate binary-float conversion; exact decimal strings are retained alongside numeric query values. Debugging exports are compressed instead of duplicating large uncompressed JSONL files. A separate `facts` phase updates this store without rebuilding narrative embeddings.
- Search storage includes a SQLite FTS5 text index and float16 semantic vectors. The existing question-answering path uses semantic retrieval and reranking; this rebuild does not add a hybrid-search interface. Exact unchanged text vectors are reused when the model and chunking version match. Existing downloaded filings are included even when the current working set is smaller.
- Text chunks follow the installed embedding endpoint's 512-token limit, with a 480-token content budget. The previous word-based chunks could be silently truncated. Equal-length embedding batches avoid a padding-related failure observed with the installed quantized model.
- New index generations are built separately. A failed rebuild preserves the previous usable generation; successful builds replace it. Original documents are never replaced by summaries or embeddings.
- A bounded ask-time refresh cannot replace a complete library index with only its first few filings. If that budget is insufficient, the prior index is preserved and a full index refresh is explicitly deferred.
- VOO is identified by registrant CIK `0000036405`, series `S000002839`, and class `C000092055`. Its N-PORT store validates series identity and retains report dates and decimal values. Portfolio assets describe the fund series, not just the ETF share class. Registrant-wide companyfacts are deliberately not labeled as VOO financial facts.

## Coverage boundaries

The document window starts November 9, 2021. It includes corporate annual, quarterly and current reports and their amendments, plus the selected fund report/prospectus forms. Transitional reports and current-report variants such as 8-K12B are included; the coverage audit identified and added two such reports for FRO and NUAI. Filing metadata and companyfacts retain the full history available from their feeds. Previously downloaded documents remain intact, including holdings outside the selected list.

Exhibit indexing currently covers textual EX-99 exhibits attached to 8-K/6-K/40-F reports. Image/PDF exhibits, every contractual exhibit, normalized custom XBRL dimensions, and a fund-specific AI analytics interface are not part of this storage rebuild. Shared fund reports may discuss several series; the series-filtered selection identifies relevant filings without claiming every paragraph is exclusive to VOO. This work improves source coverage and storage; it does not certify the AI's claim-by-claim grounding.

## Verified rebuild outcome

Completed November 10, 2026. All 41 issuer histories passed the source-accession comparison; all 40 document indexes passed integrity, coverage, finite-vector, source-path and full-text checks. KRKNF remains explicitly metadata-only.

| Measure | Verified result |
|---|---:|
| Issuer–filing metadata associations | 61,205 (61,196 distinct accessions) |
| Indexed reports | 3,595 |
| Indexed textual exhibits | 2,561 |
| Searchable source documents | 6,156 |
| Search passages | 179,159 |
| Structured company facts | 610,881 across 39 issuers |
| VOO fund reports / holdings rows | 20 / 10,416 |
| Metadata database before / after | 10.85 GB / 33.4 MB |
| Metadata database space recovered | 10.81 GB |
| Retained bulk archives | 2.92 GB |

The report count includes 207 annual reports/amendments, 459 quarterly reports/amendments, 2,842 current reports/amendments/variants and 87 fund reports/prospectuses. Source verification checked SHA-256 hashes for all 6,176 retained filing/exhibit files (2.66 GB) and all 39 original companyfacts responses (compressed to 6.1 MB). Twenty previously downloaded rendered fund documents remain preserved outside the active corpus, which now uses their original XML sources.

An independent comparison matched every normalized financial fact against the SEC response, including exact value text, concept, unit, accession and period fields. The metadata comparison included all 28 historical submissions files referenced by the issuer feeds. Live retrieval checks for GOOG and META returned SEC-linked passages; META also returned structured financial facts. The full backend suite passed 151 tests, with one pre-existing eventkit deprecation warning. No generated-answer grounding certification is implied.

The 10.81 GB saving is for the metadata database alone. Filing originals, the expanded search indexes and retained bulk archives are separate; the archives are not counted as recovered space. Detailed checks and per-issuer results are saved in [the rebuild report](/Users/imyjimmy/Documents/Finances/research/.sec/research-rebuild.json).

### Per-ticker coverage

| Ticker | Reports | Searchable documents | Structured company facts |
|---|---:|---:|---:|
| AAOI | 111 | 141 | 22,336 |
| AAPL | 63 | 86 | 25,604 |
| AEHR | 69 | 96 | 18,363 |
| AMD | 87 | 146 | 24,244 |
| AMZN | 72 | 122 | 30,289 |
| ANNA | 59 | 79 | 2,783 |
| ASST | 143 | 188 | 2,955 |
| AVGO | 77 | 116 | 15,453 |
| AXTI | 77 | 135 | 23,261 |
| BE | 83 | 123 | 17,295 |
| BNO | 96 | 166 | 7,973 |
| CIFR | 98 | 173 | 6,701 |
| COHR | 99 | 173 | 27,833 |
| FLNG | 58 | 98 | 3,768 |
| FRO | 59 | 63 | 9,388 |
| GLD | 34 | 34 | 9,092 |
| GLNG | 148 | 275 | 13,366 |
| GOOG | 79 | 110 | 21,504 |
| GROY | 142 | 379 | 1,686 |
| IAU | 25 | 25 | 5,974 |
| IBIT | 17 | 17 | 1,219 |
| INTC | 99 | 152 | 28,815 |
| IREN | 167 | 342 | 6,527 |
| KRKNF | 0 | 0 | Metadata only |
| LITE | 69 | 113 | 21,848 |
| MARA | 119 | 187 | 17,742 |
| META | 78 | 107 | 18,499 |
| MSFT | 67 | 101 | 33,058 |
| MSTR | 234 | 301 | 20,303 |
| MU | 81 | 116 | 27,533 |
| NET | 62 | 89 | 11,219 |
| NTR | 118 | 330 | 3,298 |
| NUAI | 66 | 97 | 2,137 |
| NUE | 66 | 110 | 26,463 |
| NVDA | 69 | 111 | 27,281 |
| OBE | 148 | 430 | 2,336 |
| ORCL | 71 | 100 | 26,367 |
| PYPL | 92 | 130 | 21,009 |
| TSLA | 82 | 130 | 24,544 |
| VOO | 87 | 87 | 10,416 fund holdings |
| VOXR | 124 | 378 | 815 |

## Repeating the work

Use the existing virtual environment:

```sh
.venv/bin/python scripts/rebuild_sec_holdings.py \
  --positions-dir /Users/imyjimmy/Documents/Finances/Van-Aken-Investments/fidelity/daily-positions \
  --start-date 2021-11-09 --phase all --exhibits \
  --include-research-stocks --add-symbols MSFT AMZN GOOG META TSLA AVGO ORCL \
  --report-name research-rebuild.json
```

The script selects the latest export by the date in its filename. It supports `--only TICKER`, separate `sync` and `index` phases, a `verify` phase, and a separate `compact` phase. Do not run two processes against the same report file or the same ticker simultaneously. The local embedding server must be running for semantic indexing. The expanded machine-readable result is `research/.sec/research-rebuild.json`; `holdings-rebuild.json` records the initial holdings pass.

For historical backfill, select a ticker and an earlier `--start-date`, optionally with `--end-date`. Existing newer documents remain indexed. Older entries without primary-document URLs resolve to the SEC's complete-submission text files; extraction selects report text and textual exhibits while excluding bundled binary payloads. This was validated against Apple's 1994 annual filing. Legacy annual/quarterly form variants are included. Metadata history remains scoped to the identified legal issuer (CIK); predecessor entities may require a separately verified CIK mapping in `.sec/issuer-registry/ticker-overrides.json`.

The compact phase keeps the compressed bulk sources for rollback; their bytes should not be counted as freed space. Normal refreshes no longer require those archives.
