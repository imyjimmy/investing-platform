"""Issuer-scoped XBRL fact extraction and retrieval helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from typing import Any
import zipfile

from investing_platform.config import DashboardSettings
from investing_platform.models import EdgarQuestionRequest
from investing_platform.services.edgar_common import WorkspacePaths


CONCEPT_ALIASES: dict[str, list[str]] = {
    "revenue": [
        "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        "us-gaap:Revenues",
        "us-gaap:SalesRevenueNet",
    ],
    "operating income": [
        "us-gaap:OperatingIncomeLoss",
    ],
    "gross profit": [
        "us-gaap:GrossProfit",
    ],
    "net income": [
        "us-gaap:NetIncomeLoss",
    ],
    "cash": [
        "us-gaap:CashAndCashEquivalentsAtCarryingValue",
        "us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ],
    "debt": [
        "us-gaap:LongTermDebtCurrent",
        "us-gaap:LongTermDebtNoncurrent",
        "us-gaap:DebtCurrent",
    ],
    "shares": [
        "dei:EntityCommonStockSharesOutstanding",
        "us-gaap:WeightedAverageNumberOfSharesOutstandingBasic",
        "us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding",
        "us-gaap:WeightedAverageNumberOfSharesOutstandingBasicAndDiluted",
    ],
    "gross margin": [
        "us-gaap:GrossProfit",
        "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        "us-gaap:Revenues",
        "us-gaap:SalesRevenueNet",
    ],
    "operating margin": [
        "us-gaap:OperatingIncomeLoss",
        "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        "us-gaap:Revenues",
        "us-gaap:SalesRevenueNet",
    ],
    "net margin": [
        "us-gaap:NetIncomeLoss",
        "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",
        "us-gaap:Revenues",
        "us-gaap:SalesRevenueNet",
    ],
}

_MONETARY_ALIASES = {"revenue", "operating income", "gross profit", "net income", "cash", "debt"}
_MARGIN_ALIASES = {"gross margin", "operating margin", "net margin"}
_DURATION_ALIASES = {"revenue", "operating income", "gross profit", "net income", *_MARGIN_ALIASES}
_INSTANT_ALIASES = {"cash", "debt"}
_FINANCIAL_FACT_HINT_RE = re.compile(
    r"\b(revenue|sales|income|profit|cash|debt|shares?|margin|fy|fiscal|quarter|annual|operating|gross|net)\b",
    re.IGNORECASE,
)


@dataclass(slots=True)
class XbrlFact:
    fact_id: str
    ticker: str
    cik: str
    concept: str
    value_text: str
    citation_id: str = ""
    accession_number: str | None = None
    form: str | None = None
    filing_date: str | None = None
    label: str | None = None
    taxonomy: str | None = None
    unit: str | None = None
    value_number: float | None = None
    period_start: str | None = None
    period_end: str | None = None
    instant: str | None = None
    fiscal_year: int | None = None
    fiscal_period: str | None = None
    frame: str | None = None
    source_url: str | None = None
    source_path: str | None = None
    score: float = 0.0

    @property
    def period_label(self) -> str | None:
        if self.period_start and self.period_end:
            return f"{self.period_start} to {self.period_end}"
        return self.instant or self.period_end

    @property
    def evidence_text(self) -> str:
        return " ".join(
            str(part)
            for part in (
                self.ticker,
                self.cik,
                self.accession_number,
                self.form,
                self.filing_date,
                self.concept,
                self.label,
                self.taxonomy,
                self.unit,
                self.value_text,
                self.period_start,
                self.period_end,
                self.instant,
                self.fiscal_year,
                self.fiscal_period,
                self.frame,
            )
            if part not in {None, ""}
        )


@dataclass(slots=True)
class XbrlExtractionResult:
    facts_count: int = 0
    concepts_count: int = 0
    limitations: list[str] | None = None


class EdgarXbrlFactService:
    """Build and query ticker-scoped XBRL fact artifacts from SEC companyfacts."""

    def __init__(self, settings: DashboardSettings) -> None:
        self._settings = settings

    def build_issuer_facts(self, *, paths: WorkspacePaths, filings: list[dict[str, Any]]) -> XbrlExtractionResult:
        ticker = paths.stock_root.name.upper()
        cik = self._issuer_cik(filings)
        if not cik:
            return self._unavailable(paths, "Structured XBRL facts were unavailable because no issuer CIK was present.")

        companyfacts_path = self._companyfacts_zip_path()
        if not companyfacts_path.exists():
            return self._unavailable(
                paths,
                f"Structured XBRL facts were unavailable because companyfacts.zip was not found at {companyfacts_path}.",
            )

        try:
            payload = self._read_companyfacts_payload(companyfacts_path, cik)
        except (OSError, ValueError, zipfile.BadZipFile) as exc:
            return self._unavailable(paths, f"Structured XBRL facts could not be read from companyfacts.zip: {exc}")
        if payload is None:
            return self._unavailable(paths, f"Structured XBRL facts were unavailable for CIK {cik.zfill(10)} in companyfacts.zip.")

        rows = self._dedupe_rows(self._normalize_companyfacts_payload(payload, ticker=ticker, cik=cik, filings=filings))
        if not rows:
            return self._unavailable(paths, f"Structured XBRL facts were unavailable for {ticker}; no usable fact rows were found.")

        xbrl_dir = paths.intelligence_dir / "xbrl"
        xbrl_dir.mkdir(parents=True, exist_ok=True)
        facts_jsonl_path = xbrl_dir / "facts.jsonl"
        with facts_jsonl_path.open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, sort_keys=True))
                handle.write("\n")
        self._write_concepts_json(xbrl_dir / "concepts.json", rows)
        self._write_facts_sqlite(xbrl_dir / "facts.sqlite3", rows)
        return XbrlExtractionResult(facts_count=len(rows), concepts_count=len({row["concept"] for row in rows}), limitations=[])

    def _unavailable(self, paths: WorkspacePaths, limitation: str) -> XbrlExtractionResult:
        self._clear_xbrl_artifacts(paths)
        return XbrlExtractionResult(limitations=[limitation])

    def _clear_xbrl_artifacts(self, paths: WorkspacePaths) -> None:
        xbrl_dir = paths.intelligence_dir / "xbrl"
        for name in ("facts.jsonl", "concepts.json", "facts.sqlite3"):
            path = xbrl_dir / name
            if path.exists():
                path.unlink()

    def retrieve_facts(
        self,
        *,
        paths: WorkspacePaths,
        request: EdgarQuestionRequest,
        active_accessions: set[str],
    ) -> tuple[list[XbrlFact], list[str]]:
        matches = self._matched_alias_concepts(request.question)
        if not matches:
            return [], []

        sqlite_path = paths.intelligence_dir / "xbrl" / "facts.sqlite3"
        if not sqlite_path.exists():
            if self._looks_like_financial_fact_question(request.question):
                return [], ["Structured XBRL facts are unavailable for this issuer."]
            return [], []

        concepts = sorted({concept for _alias, concept, _rank in matches})
        concept_rank = self._concept_rank(matches)
        try:
            with sqlite3.connect(sqlite_path) as connection:
                connection.row_factory = sqlite3.Row
                placeholders = ",".join("?" for _concept in concepts)
                rows = connection.execute(f"SELECT * FROM facts WHERE concept IN ({placeholders})", concepts).fetchall()
        except sqlite3.Error as exc:
            return [], [f"Structured XBRL facts could not be queried: {exc}"]

        allowed_forms = {form.upper() for form in request.forms}
        allowed_accessions = {accession.strip() for accession in request.accessionNumbers if accession.strip()}
        source_path = str(paths.intelligence_dir / "xbrl" / "facts.jsonl")
        facts: list[XbrlFact] = []
        aliases = {alias for alias, _concept, _rank in matches}
        for row in rows:
            accession = str(row["accession_number"] or "") or None
            form = str(row["form"] or "").upper() or None
            filing_date = str(row["filing_date"] or "") or None
            if allowed_accessions and accession not in allowed_accessions:
                continue
            if allowed_forms and (not form or form not in allowed_forms):
                continue
            if filing_date and not self._filing_date_matches(filing_date, request):
                continue
            fact = self._fact_from_row(row, source_path=source_path)
            fact.score = self._rank_fact(fact, concept_rank=concept_rank, active_accessions=active_accessions, aliases=aliases, request=request)
            facts.append(fact)

        facts.sort(key=lambda fact: (fact.score, self._date_rank(fact.filing_date or fact.period_end or fact.instant)), reverse=True)
        return self._dedupe_facts(facts)[: min(max(request.maxChunks, 4), 12)], []

    def _companyfacts_zip_path(self) -> Path:
        return self._settings.research_root / ".sec" / "filing-metadata" / "companyfacts.zip"

    def _issuer_cik(self, filings: list[dict[str, Any]]) -> str | None:
        for filing in filings:
            candidate = re.sub(r"\D+", "", str(filing.get("cik10") or filing.get("cik") or ""))
            if candidate:
                return candidate.lstrip("0") or "0"
        return None

    def _read_companyfacts_payload(self, archive_path: Path, cik: str) -> dict[str, Any] | None:
        cik10 = cik.zfill(10)
        candidates = {
            f"CIK{cik10}.json",
            f"CIK{cik}.json",
            f"{cik10}.json",
            f"{cik}.json",
        }
        with zipfile.ZipFile(archive_path) as archive:
            names = archive.namelist()
            matched_name = next((name for name in names if Path(name).name in candidates), None)
            if matched_name is None:
                return None
            with archive.open(matched_name) as handle:
                return json.loads(handle.read().decode("utf-8"))

    def _normalize_companyfacts_payload(
        self,
        payload: dict[str, Any],
        *,
        ticker: str,
        cik: str,
        filings: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        facts = payload.get("facts")
        if not isinstance(facts, dict):
            return []
        filing_by_accession = self._filing_lookup(filings)
        rows: list[dict[str, Any]] = []
        for taxonomy, concepts in facts.items():
            if not isinstance(concepts, dict):
                continue
            for concept_name, concept_payload in concepts.items():
                if not isinstance(concept_payload, dict):
                    continue
                units = concept_payload.get("units")
                if not isinstance(units, dict):
                    continue
                concept = f"{taxonomy}:{concept_name}"
                label = str(concept_payload.get("label") or concept_name)
                for unit, unit_facts in units.items():
                    if not isinstance(unit_facts, list):
                        continue
                    for raw_fact in unit_facts:
                        if not isinstance(raw_fact, dict) or "val" not in raw_fact:
                            continue
                        row = self._normalize_fact_row(
                            raw_fact,
                            ticker=ticker,
                            cik=cik,
                            concept=concept,
                            label=label,
                            taxonomy=str(taxonomy),
                            unit=str(unit),
                            filing_by_accession=filing_by_accession,
                        )
                        if row is not None:
                            rows.append(row)
        return rows

    def _normalize_fact_row(
        self,
        raw_fact: dict[str, Any],
        *,
        ticker: str,
        cik: str,
        concept: str,
        label: str,
        taxonomy: str,
        unit: str,
        filing_by_accession: dict[str, dict[str, Any]],
    ) -> dict[str, Any] | None:
        raw_value = raw_fact.get("val")
        if raw_value is None:
            return None
        value_text = str(raw_value).strip()
        if not value_text:
            return None
        accession = str(raw_fact.get("accn") or raw_fact.get("accessionNumber") or "").strip() or None
        filing = filing_by_accession.get(accession or "") or filing_by_accession.get(_accession_no_dashes(accession or ""))
        form = str(raw_fact.get("form") or (filing or {}).get("form") or "").strip() or None
        filing_date = str(raw_fact.get("filed") or (filing or {}).get("filingDate") or "").strip() or None
        period_start = str(raw_fact.get("start") or "").strip() or None
        period_end = str(raw_fact.get("end") or "").strip() or None
        instant = period_end if period_end and not period_start else None
        source_url = str((filing or {}).get("primaryDocumentUrl") or "").strip() or self._source_url(cik, accession)
        row = {
            "fact_id": self._fact_id(concept, unit, raw_fact),
            "ticker": ticker,
            "cik": cik.zfill(10),
            "accession_number": accession,
            "form": form,
            "filing_date": filing_date,
            "concept": concept,
            "label": label,
            "taxonomy": taxonomy,
            "unit": unit,
            "value_text": value_text,
            "value_number": self._safe_number(raw_value),
            "period_start": period_start,
            "period_end": period_end,
            "instant": instant,
            "fiscal_year": self._safe_int(raw_fact.get("fy")),
            "fiscal_period": str(raw_fact.get("fp") or "").strip() or None,
            "frame": str(raw_fact.get("frame") or "").strip() or None,
            "source_url": source_url,
        }
        return row

    def _write_concepts_json(self, destination: Path, rows: list[dict[str, Any]]) -> None:
        concepts: dict[str, dict[str, Any]] = {}
        for row in rows:
            concept = row["concept"]
            entry = concepts.setdefault(
                concept,
                {
                    "label": row.get("label"),
                    "taxonomy": row.get("taxonomy"),
                    "units": [],
                    "factCount": 0,
                },
            )
            if row.get("unit") not in entry["units"]:
                entry["units"].append(row.get("unit"))
            entry["factCount"] += 1
        destination.write_text(json.dumps({"concepts": concepts}, indent=2, sort_keys=True), encoding="utf-8")

    def _dedupe_rows(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        deduped: list[dict[str, Any]] = []
        seen: set[str] = set()
        for row in rows:
            fact_id = str(row.get("fact_id") or "")
            if fact_id in seen:
                continue
            seen.add(fact_id)
            deduped.append(row)
        return deduped

    def _write_facts_sqlite(self, destination: Path, rows: list[dict[str, Any]]) -> None:
        if destination.exists():
            destination.unlink()
        with sqlite3.connect(destination) as connection:
            connection.execute(
                """
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
                )
                """
            )
            connection.executemany(
                """
                INSERT OR REPLACE INTO facts (
                    fact_id, ticker, cik, accession_number, form, filing_date, concept, label,
                    taxonomy, unit, value_text, value_number, period_start, period_end, instant,
                    fiscal_year, fiscal_period, frame, source_url
                ) VALUES (
                    :fact_id, :ticker, :cik, :accession_number, :form, :filing_date, :concept,
                    :label, :taxonomy, :unit, :value_text, :value_number, :period_start,
                    :period_end, :instant, :fiscal_year, :fiscal_period, :frame, :source_url
                )
                """,
                rows,
            )
            connection.execute("CREATE INDEX facts_concept_idx ON facts(concept)")
            connection.execute("CREATE INDEX facts_accession_idx ON facts(accession_number)")
            connection.execute("CREATE INDEX facts_period_idx ON facts(fiscal_year, fiscal_period, filing_date)")
            connection.commit()

    def _fact_from_row(self, row: sqlite3.Row, *, source_path: str) -> XbrlFact:
        return XbrlFact(
            fact_id=str(row["fact_id"]),
            ticker=str(row["ticker"]),
            cik=str(row["cik"]),
            accession_number=str(row["accession_number"] or "") or None,
            form=str(row["form"] or "") or None,
            filing_date=str(row["filing_date"] or "") or None,
            concept=str(row["concept"]),
            label=str(row["label"] or "") or None,
            taxonomy=str(row["taxonomy"] or "") or None,
            unit=str(row["unit"] or "") or None,
            value_text=str(row["value_text"]),
            value_number=row["value_number"],
            period_start=str(row["period_start"] or "") or None,
            period_end=str(row["period_end"] or "") or None,
            instant=str(row["instant"] or "") or None,
            fiscal_year=self._safe_int(row["fiscal_year"]),
            fiscal_period=str(row["fiscal_period"] or "") or None,
            frame=str(row["frame"] or "") or None,
            source_url=str(row["source_url"] or "") or None,
            source_path=source_path,
        )

    def _matched_alias_concepts(self, question: str) -> list[tuple[str, str, int]]:
        normalized = f" {re.sub(r'[^a-z0-9:.-]+', ' ', question.lower())} "
        matches: list[tuple[str, str, int]] = []
        for alias, concepts in CONCEPT_ALIASES.items():
            if f" {alias} " not in normalized:
                continue
            for rank, concept in enumerate(concepts):
                matches.append((alias, concept, rank))
        for concept in re.findall(r"\b(?:us-gaap|dei):[A-Za-z0-9_]+\b", question):
            matches.append(("explicit concept", concept, 0))
        return matches

    def _concept_rank(self, matches: list[tuple[str, str, int]]) -> dict[str, int]:
        ranks: dict[str, int] = {}
        for _alias, concept, rank in matches:
            ranks[concept] = min(ranks.get(concept, 999), rank)
        return ranks

    def _rank_fact(
        self,
        fact: XbrlFact,
        *,
        concept_rank: dict[str, int],
        active_accessions: set[str],
        aliases: set[str],
        request: EdgarQuestionRequest,
    ) -> float:
        score = 1000.0 - concept_rank.get(fact.concept, 999)
        if fact.accession_number and fact.accession_number in request.accessionNumbers:
            score += 80
        if fact.accession_number and fact.accession_number in active_accessions:
            score += 35
        if request.forms and fact.form and fact.form.upper() in {form.upper() for form in request.forms}:
            score += 25
        if fact.form in {"10-K", "10-Q", "10-K/A", "10-Q/A"}:
            score += 10
        if aliases.intersection(_DURATION_ALIASES) and fact.period_start and fact.period_end:
            score += 14
        if aliases.intersection(_INSTANT_ALIASES) and fact.instant:
            score += 14
        if "shares" in aliases and fact.unit and "share" in fact.unit.lower():
            score += 18
        if aliases.intersection(_MONETARY_ALIASES | _MARGIN_ALIASES) and fact.unit and fact.unit.upper() == "USD":
            score += 18
        if fact.fiscal_period in {"FY", "Q4", "Q3", "Q2", "Q1"}:
            score += 5
        return score

    def _dedupe_facts(self, facts: list[XbrlFact]) -> list[XbrlFact]:
        deduped: list[XbrlFact] = []
        seen: set[tuple[str, str | None, str | None, str | None, str | None, str]] = set()
        for fact in facts:
            key = (fact.concept, fact.period_start, fact.period_end or fact.instant, fact.unit, fact.accession_number, fact.value_text)
            if key in seen:
                continue
            seen.add(key)
            deduped.append(fact)
        return deduped

    def _looks_like_financial_fact_question(self, question: str) -> bool:
        return bool(_FINANCIAL_FACT_HINT_RE.search(question))

    def _filing_date_matches(self, filing_date: str, request: EdgarQuestionRequest) -> bool:
        parsed = _parse_date(filing_date)
        if parsed is None:
            return not request.startDate and not request.endDate
        if request.startDate and parsed < request.startDate:
            return False
        if request.endDate and parsed > request.endDate:
            return False
        return True

    def _date_rank(self, value: str | None) -> int:
        parsed = _parse_date(value or "")
        return parsed.toordinal() if parsed else 0

    def _filing_lookup(self, filings: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        lookup: dict[str, dict[str, Any]] = {}
        for filing in filings:
            accession = str(filing.get("accessionNumber") or "")
            if accession:
                lookup[accession] = filing
                lookup[_accession_no_dashes(accession)] = filing
        return lookup

    def _source_url(self, cik: str, accession: str | None) -> str | None:
        if not accession:
            return None
        return f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{_accession_no_dashes(accession)}/"

    def _fact_id(self, concept: str, unit: str, raw_fact: dict[str, Any]) -> str:
        payload = json.dumps(
            {
                "concept": concept,
                "unit": unit,
                "accn": raw_fact.get("accn"),
                "start": raw_fact.get("start"),
                "end": raw_fact.get("end"),
                "val": raw_fact.get("val"),
                "fy": raw_fact.get("fy"),
                "fp": raw_fact.get("fp"),
                "frame": raw_fact.get("frame"),
            },
            sort_keys=True,
        )
        return hashlib.sha1(payload.encode("utf-8")).hexdigest()[:24]

    def _safe_number(self, value: Any) -> float | None:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _safe_int(self, value: Any) -> int | None:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None


def _accession_no_dashes(accession: str) -> str:
    return accession.replace("-", "")


def _parse_date(value: str) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None
