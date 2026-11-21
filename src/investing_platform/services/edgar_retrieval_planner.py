"""Metadata-only retrieval planning for EDGAR filing Q&A.

The planner exists to answer one question before semantic retrieval starts:
which filing set should be searched?  It deliberately avoids topic keywords,
lexical boosts, and answer-specific shortcuts.  It only interprets filing
metadata operators such as SEC form names and recency scope.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
import re
from typing import Any, Iterable, Mapping


FORM_TOKEN_RE = re.compile(
    r"\b(?:form\s+)?(?P<form>(?:10|20|40|8|6)\s*-\s*[a-z])(?P<amendment>\s*/\s*a)?\b",
    re.IGNORECASE,
)
LATEST_SCOPE_RE = re.compile(
    r"\b(?:latest|newest|most\s+recent)\b|\blast\s+(?:filing|report|annual|quarterly|10-q|10-k|8-k|6-k|20-f|40-f)\b",
    re.IGNORECASE,
)
REPORT_PHRASE_FORMS: tuple[tuple[re.Pattern[str], tuple[str, ...]], ...] = (
    (re.compile(r"\b(?:quarterly|interim)\s+reports?\b", re.IGNORECASE), ("10-Q", "10-Q/A")),
    (re.compile(r"\bannual\s+reports?\b", re.IGNORECASE), ("10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A")),
    (re.compile(r"\bcurrent\s+reports?\b", re.IGNORECASE), ("8-K", "8-K/A", "6-K", "6-K/A")),
)
BASE_FORM_FAMILIES: dict[str, tuple[str, ...]] = {
    "10-Q": ("10-Q", "10-Q/A"),
    "10-K": ("10-K", "10-K/A"),
    "8-K": ("8-K", "8-K/A"),
    "6-K": ("6-K", "6-K/A"),
    "20-F": ("20-F", "20-F/A"),
    "40-F": ("40-F", "40-F/A"),
}


REPORT_PERIOD_RE = re.compile(
    r"\b(?:year|quarter|period|months?)\s+(?:ended|ending)\s+"
    r"([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})\b", re.IGNORECASE,
)


def asks_about_current_guidance(question: str) -> bool:
    """An unqualified outlook question refers to the latest releases."""
    return bool(re.search(r"\b(guidance|outlook|forecast)\b", question, re.I)) and not re.search(
        r"\b(?:19\d{2}|20\d{2}|FY\s*\d+|Q[1-4]|historical|history|since|ago|last year)\b", question, re.I
    )


def asks_for_guidance_change(question: str) -> bool:
    return bool(re.search(
        r"\b(rais(?:e|ed)|lower(?:ed)?|cut|increas(?:e|ed)|decreas(?:e|ed)|revis(?:e|ed|ion)|"
        r"chang(?:e|ed)|compar(?:e|ed|ison)|higher|lower|hike|boost)\b", question, re.I,
    ))


def earnings_release(filing: Mapping[str, Any]) -> bool:
    return filing.get("form") == "8-K" and "2.02" in re.split(r"[,;\s]+", str(filing.get("items") or ""))


def passage_query(question: str) -> str:
    """Remove filing identifiers already enforced by the accession filter."""
    topic = FORM_TOKEN_RE.sub(" ", question)
    if requested_period_end(question):
        topic = REPORT_PERIOD_RE.sub(" ", topic)
    topic = re.sub(r"\b(?:in its\s+)?for the\s*(?=[,?]|$)|\bin its\s*(?=[,?]|$)", " ", topic, flags=re.I)
    return " ".join(topic.split()).strip(" ,") or question


def requested_period_end(question: str) -> date | None:
    dates = REPORT_PERIOD_RE.findall(question)
    if len(dates) != 1:
        return None
    for pattern in ("%B %d %Y", "%b %d %Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(dates[0].replace(",", ""), pattern).date()
        except ValueError:
            continue
    return None


@dataclass(frozen=True, slots=True)
class EdgarRetrievalPlan:
    """Filing metadata filters to apply before vector search."""

    forms: tuple[str, ...] = ()
    accession_numbers: tuple[str, ...] = ()
    reasons: tuple[str, ...] = ()


class EdgarRetrievalPlanner:
    """Plan simple EDGAR metadata scope for a natural-language question."""

    def plan(
        self,
        *,
        question: str,
        filings: Iterable[Mapping[str, Any]],
        forms: Iterable[str] = (),
        accession_numbers: Iterable[str] = (),
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> EdgarRetrievalPlan:
        explicit_accessions = self._normalize_accessions(accession_numbers)
        if explicit_accessions:
            return EdgarRetrievalPlan(reasons=("explicit_accessions",))

        explicit_forms = self._normalize_forms(forms)
        inferred_forms = () if explicit_forms else self._forms_from_question(question)
        scope_forms = explicit_forms or inferred_forms
        filtered_filings = self._filter_filings(
            filings,
            forms=scope_forms,
            start_date=start_date,
            end_date=end_date,
        )

        reasons: list[str] = []
        if inferred_forms:
            reasons.append("form_scope")

        period_end = requested_period_end(question)
        if period_end and scope_forms:
            filtered_filings = [f for f in filtered_filings if f.get("accessionNumber")
                                and str(f.get("reportDate")) == period_end.isoformat()]
            if not filtered_filings:
                return EdgarRetrievalPlan(forms=inferred_forms, reasons=(*reasons, "report_period_unavailable"))
            reasons.append("report_period")

        if asks_about_current_guidance(question) and not scope_forms and not period_end:
            reports = sorted((f for f in filtered_filings if earnings_release(f) and f.get("accessionNumber")),
                             key=lambda f: (str(f.get("filingDate")), str(f["accessionNumber"])), reverse=True)
            if reports:
                count = 2 if asks_for_guidance_change(question) else 1
                return EdgarRetrievalPlan(
                    accession_numbers=tuple(str(f["accessionNumber"]) for f in reports[:count]),
                    reasons=("earnings_outlook",),
                )

        if self._requests_latest_scope(question):
            latest_accessions = self._latest_accessions(filtered_filings)
            if latest_accessions:
                reasons.append("latest_scope")
                return EdgarRetrievalPlan(
                    forms=inferred_forms,
                    accession_numbers=latest_accessions,
                    reasons=tuple(reasons),
                )

        if "report_period" in reasons:
            matches = tuple(str(f["accessionNumber"]) for f in filtered_filings)
            return EdgarRetrievalPlan(forms=inferred_forms, accession_numbers=matches, reasons=tuple(reasons))
        return EdgarRetrievalPlan(forms=inferred_forms, reasons=tuple(reasons))

    def _requests_latest_scope(self, question: str) -> bool:
        return bool(LATEST_SCOPE_RE.search(question))

    def _forms_from_question(self, question: str) -> tuple[str, ...]:
        forms: list[str] = []
        for match in FORM_TOKEN_RE.finditer(question):
            form = self._normalize_form(match.group("form"))
            if not form:
                continue
            if match.group("amendment"):
                forms.append(f"{form}/A")
            else:
                forms.extend(BASE_FORM_FAMILIES.get(form, (form,)))

        for pattern, phrase_forms in REPORT_PHRASE_FORMS:
            if pattern.search(question):
                forms.extend(phrase_forms)

        return tuple(dict.fromkeys(forms))

    def _filter_filings(
        self,
        filings: Iterable[Mapping[str, Any]],
        *,
        forms: tuple[str, ...],
        start_date: date | None,
        end_date: date | None,
    ) -> list[Mapping[str, Any]]:
        allowed_forms = set(forms)
        filtered: list[Mapping[str, Any]] = []
        for filing in filings:
            form = str(filing.get("form") or "").strip().upper()
            if allowed_forms and form not in allowed_forms:
                continue
            filing_date = self._parse_date(str(filing.get("filingDate") or ""))
            if start_date or end_date:
                if filing_date is None:
                    continue
                if start_date and filing_date < start_date:
                    continue
                if end_date and filing_date > end_date:
                    continue
            filtered.append(filing)
        return filtered

    def _latest_accessions(self, filings: Iterable[Mapping[str, Any]]) -> tuple[str, ...]:
        dated_accessions: list[tuple[date, str]] = []
        for filing in filings:
            accession = str(filing.get("accessionNumber") or "").strip()
            filing_date = self._parse_date(str(filing.get("filingDate") or ""))
            if accession and filing_date is not None:
                dated_accessions.append((filing_date, accession))
        if not dated_accessions:
            return ()
        newest_date = max(filing_date for filing_date, _accession in dated_accessions)
        return tuple(accession for filing_date, accession in dated_accessions if filing_date == newest_date)

    def _normalize_forms(self, forms: Iterable[str]) -> tuple[str, ...]:
        normalized = [self._normalize_form(form) for form in forms]
        return tuple(dict.fromkeys(form for form in normalized if form))

    def _normalize_accessions(self, accession_numbers: Iterable[str]) -> tuple[str, ...]:
        return tuple(dict.fromkeys(accession.strip() for accession in accession_numbers if accession.strip()))

    def _normalize_form(self, form: str) -> str:
        normalized = re.sub(r"\s+", "", form.strip().upper())
        if not normalized:
            return ""
        normalized = normalized.replace("-A", "/A") if normalized.endswith("-A") else normalized
        if normalized.endswith("/A"):
            base = normalized[:-2]
            return f"{base}/A" if base else ""
        return normalized

    def _parse_date(self, value: str) -> date | None:
        try:
            return date.fromisoformat(value)
        except ValueError:
            return None
