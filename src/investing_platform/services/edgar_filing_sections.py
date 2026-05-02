"""Section extraction helpers for primary EDGAR filing documents."""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any


PRIMARY_SECTION = "Primary Document"
SUPPORTED_10K_FORMS = {"10-K", "10-K/A"}
SUPPORTED_10Q_FORMS = {"10-Q", "10-Q/A"}
SUPPORTED_8K_FORMS = {"8-K", "8-K/A"}

_PART_RE = re.compile(r"^part\s+([ivx]+)\b", re.IGNORECASE)
_ITEM_RE = re.compile(
    r"^(?:part\s+([ivx]+)\s*[-:.\u2013\u2014]?\s*)?item\s+([0-9]+[a-z]?)\.?\s*(?:[-:.\u2013\u2014]\s*)?(.*)$",
    re.IGNORECASE,
)
_EIGHT_K_ITEM_RE = re.compile(r"^item\s+([0-9]\.\d{2})\.?\s*(?:[-:.\u2013\u2014]\s*)?(.*)$", re.IGNORECASE)

_TEN_K_ITEMS: dict[str, tuple[str, str]] = {
    "1": ("Business", "business"),
    "1A": ("Risk Factors", "risk_factors"),
    "1B": ("Unresolved Staff Comments", "unresolved_staff_comments"),
    "1C": ("Cybersecurity", "cybersecurity"),
    "2": ("Properties", "properties"),
    "3": ("Legal Proceedings", "legal_proceedings"),
    "7": ("Management's Discussion and Analysis", "mda"),
    "7A": ("Quantitative and Qualitative Disclosures About Market Risk", "market_risk"),
    "8": ("Financial Statements and Supplementary Data", "financial_statements"),
    "9A": ("Controls and Procedures", "controls_and_procedures"),
}

_TEN_Q_ITEMS: dict[tuple[str, str], tuple[str, str]] = {
    ("I", "1"): ("Financial Statements", "financial_statements"),
    ("I", "2"): ("Management's Discussion and Analysis", "mda"),
    ("I", "3"): ("Quantitative and Qualitative Disclosures About Market Risk", "market_risk"),
    ("I", "4"): ("Controls and Procedures", "controls_and_procedures"),
    ("II", "1"): ("Legal Proceedings", "legal_proceedings"),
    ("II", "1A"): ("Risk Factors", "risk_factors"),
    ("II", "2"): ("Unregistered Sales of Equity Securities", "equity_sales"),
    ("II", "5"): ("Other Information", "other_information"),
    ("II", "6"): ("Exhibits", "exhibits"),
}

_EIGHT_K_ITEMS: dict[str, tuple[str, str]] = {
    "1.01": ("Entry into a Material Definitive Agreement", "entry_into_material_agreement"),
    "2.02": ("Results of Operations and Financial Condition", "results_of_operations"),
    "5.02": ("Departure of Directors or Certain Officers", "departure_of_directors_or_officers"),
    "7.01": ("Regulation FD Disclosure", "reg_fd_disclosure"),
    "8.01": ("Other Events", "other_events"),
    "9.01": ("Financial Statements and Exhibits", "financial_statements_and_exhibits"),
}


@dataclass(slots=True)
class _Heading:
    start: int
    section: str
    section_code: str
    section_title: str
    section_type: str
    key: str


def extract_filing_sections(*, form: str, text: str, filing_items: str | None = None) -> list[dict[str, Any]]:
    """Extract major SEC item sections from normalized filing text.

    The parser intentionally favors conservative, line-anchored headings. When
    it cannot produce useful sections, it returns a single Primary Document
    fallback so indexing can continue.
    """

    normalized_form = str(form or "").strip().upper()
    if not text.strip():
        return []

    if normalized_form in SUPPORTED_10K_FORMS:
        headings = _dedupe_by_later_heading(_find_10k_headings(text))
        return _sections_from_headings(text, headings) or [_primary_document(text)]
    if normalized_form in SUPPORTED_10Q_FORMS:
        headings = _dedupe_by_later_heading(_find_10q_headings(text))
        return _sections_from_headings(text, headings) or [_primary_document(text)]
    if normalized_form in SUPPORTED_8K_FORMS:
        headings = _dedupe_by_later_heading(_find_8k_headings(text))
        sections = _sections_from_headings(text, headings)
        if sections:
            return sections
        if filing_items:
            return [_eight_k_metadata_fallback(text, filing_items)]
    return [_primary_document(text)]


def _find_10k_headings(text: str) -> list[_Heading]:
    headings: list[_Heading] = []
    for line, start in _iter_lines_with_offsets(text):
        match = _ITEM_RE.match(line)
        if not match:
            continue
        raw_code = _normalize_item_code(match.group(2))
        if raw_code not in _TEN_K_ITEMS:
            continue
        title, section_type = _TEN_K_ITEMS[raw_code]
        display_title = _display_title(match.group(3), title)
        headings.append(
            _Heading(
                start=start,
                section=f"Item {raw_code}. {display_title}",
                section_code=raw_code,
                section_title=display_title,
                section_type=section_type,
                key=raw_code,
            )
        )
    return headings


def _find_10q_headings(text: str) -> list[_Heading]:
    headings: list[_Heading] = []
    current_part: str | None = None
    for line, start in _iter_lines_with_offsets(text):
        part_match = _PART_RE.match(line)
        if part_match:
            current_part = _normalize_part(part_match.group(1))
        match = _ITEM_RE.match(line)
        if not match:
            continue
        part = _normalize_part(match.group(1)) if match.group(1) else current_part
        raw_code = _normalize_item_code(match.group(2))
        if part is None:
            continue
        key = (part, raw_code)
        if key not in _TEN_Q_ITEMS:
            continue
        title, section_type = _TEN_Q_ITEMS[key]
        display_title = _display_title(match.group(3), title)
        section_code = f"{part}.{raw_code}"
        headings.append(
            _Heading(
                start=start,
                section=f"Part {part} Item {raw_code}. {display_title}",
                section_code=section_code,
                section_title=display_title,
                section_type=section_type,
                key=section_code,
            )
        )
    return headings


def _find_8k_headings(text: str) -> list[_Heading]:
    headings: list[_Heading] = []
    for line, start in _iter_lines_with_offsets(text):
        match = _EIGHT_K_ITEM_RE.match(line)
        if not match:
            continue
        code = match.group(1)
        title, section_type = _EIGHT_K_ITEMS.get(code, ("Current Report Item", "current_report_item"))
        display_title = _display_title(match.group(2), title)
        headings.append(
            _Heading(
                start=start,
                section=f"Item {code}. {display_title}",
                section_code=code,
                section_title=display_title,
                section_type=section_type,
                key=code,
            )
        )
    return headings


def _sections_from_headings(text: str, headings: list[_Heading]) -> list[dict[str, Any]]:
    if not headings:
        return []
    sections: list[dict[str, Any]] = []
    ordered = sorted(headings, key=lambda heading: heading.start)
    for index, heading in enumerate(ordered):
        end = ordered[index + 1].start if index + 1 < len(ordered) else len(text)
        sections.append(_section_payload(text, heading, end))
    return [section for section in sections if section["text"].strip()] or [_primary_document(text)]


def _section_payload(text: str, heading: _Heading, end: int) -> dict[str, Any]:
    start, trimmed_end = _trim_range(text, heading.start, end)
    return {
        "section": heading.section,
        "sectionCode": heading.section_code,
        "sectionTitle": heading.section_title,
        "sectionType": heading.section_type,
        "startChar": start,
        "endChar": trimmed_end,
        "text": text[start:trimmed_end],
    }


def _primary_document(text: str) -> dict[str, Any]:
    start, end = _trim_range(text, 0, len(text))
    return {
        "section": PRIMARY_SECTION,
        "sectionCode": None,
        "sectionTitle": PRIMARY_SECTION,
        "sectionType": "primary_document",
        "startChar": start,
        "endChar": end,
        "text": text[start:end],
    }


def _eight_k_metadata_fallback(text: str, filing_items: str) -> dict[str, Any]:
    codes = re.findall(r"\d\.\d{2}", filing_items)
    if len(codes) == 1:
        code = codes[0]
        title, section_type = _EIGHT_K_ITEMS.get(code, ("Current Report Item", "current_report_item"))
        heading = _Heading(
            start=0,
            section=f"Item {code}. {title}",
            section_code=code,
            section_title=title,
            section_type=section_type,
            key=code,
        )
        return _section_payload(text, heading, len(text))
    start, end = _trim_range(text, 0, len(text))
    label = ", ".join(codes) if codes else filing_items.strip()
    return {
        "section": f"Items {label}",
        "sectionCode": label,
        "sectionTitle": "Current Report Items",
        "sectionType": "current_report_items",
        "startChar": start,
        "endChar": end,
        "text": text[start:end],
    }


def _dedupe_by_later_heading(headings: list[_Heading]) -> list[_Heading]:
    by_key: dict[str, _Heading] = {}
    for heading in headings:
        by_key[heading.key] = heading
    return sorted(by_key.values(), key=lambda heading: heading.start)


def _iter_lines_with_offsets(text: str) -> list[tuple[str, int]]:
    lines: list[tuple[str, int]] = []
    offset = 0
    for raw_line in text.splitlines(keepends=True):
        stripped = re.sub(r"[ \t\r\f\v]+", " ", raw_line.strip())
        if stripped:
            line_start = offset + raw_line.find(raw_line.strip())
            lines.append((stripped, line_start))
        offset += len(raw_line)
    return lines


def _normalize_item_code(value: str) -> str:
    return value.strip().upper()


def _normalize_part(value: str) -> str:
    return value.strip().upper()


def _display_title(raw_title: str, fallback: str) -> str:
    title = re.sub(r"\s+", " ", raw_title or "").strip(" .:-\u2013\u2014")
    title = re.sub(r"\s+\d+$", "", title).strip(" .:-\u2013\u2014")
    if not title or len(title) <= 2:
        return fallback
    return title


def _trim_range(text: str, start: int, end: int) -> tuple[int, int]:
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return start, end
