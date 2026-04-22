"""Tolerant parsers for IBKR fundamental report XML payloads."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from math import isfinite
from typing import Any
from xml.etree import ElementTree

from investing_platform.models import FinancialMetricRow, FinancialPeriodColumn, FinancialStatementTable


STATEMENT_TYPE_LABELS = {
    "income_statement": "Income Statement",
    "balance_sheet": "Balance Sheet",
    "cash_flow": "Cash Flow",
    "ratios": "Ratios",
    "estimates": "Analyst Estimates",
    "summary": "Financial Summary",
}

STATEMENT_TYPE_ALIASES = {
    "inc": "income_statement",
    "income": "income_statement",
    "incomestatement": "income_statement",
    "is": "income_statement",
    "bal": "balance_sheet",
    "balance": "balance_sheet",
    "balancesheet": "balance_sheet",
    "bs": "balance_sheet",
    "cas": "cash_flow",
    "cash": "cash_flow",
    "cashflow": "cash_flow",
    "cashflowstatement": "cash_flow",
    "cf": "cash_flow",
}


@dataclass(slots=True)
class ParsedFundamentalReports:
    statements: list[FinancialStatementTable]
    ratios: list[FinancialStatementTable]
    estimates: list[FinancialStatementTable]
    source_notices: list[str]


def parse_ibkr_fundamental_reports(report_payloads: dict[str, str]) -> ParsedFundamentalReports:
    statements: list[FinancialStatementTable] = []
    ratios: list[FinancialStatementTable] = []
    estimates: list[FinancialStatementTable] = []
    source_notices: list[str] = []

    financial_statements_xml = report_payloads.get("ReportsFinStatements")
    if financial_statements_xml:
        statements = parse_financial_statement_xml(financial_statements_xml)
        if not statements:
            source_notices.append("IBKR returned ReportsFinStatements XML, but no statement tables could be parsed.")

    ratios_xml = report_payloads.get("ReportRatios")
    if ratios_xml:
        ratios = parse_metric_report_xml(ratios_xml, title="Ratios", statement_type="ratios")
        if not ratios:
            source_notices.append("IBKR returned ReportRatios XML, but no ratio rows could be parsed.")

    summary_xml = report_payloads.get("ReportsFinSummary")
    if summary_xml:
        summary_tables = parse_metric_report_xml(summary_xml, title="Financial Summary", statement_type="summary")
        ratios.extend(summary_tables)
        if not summary_tables:
            source_notices.append("IBKR returned ReportsFinSummary XML, but no summary rows could be parsed.")

    estimates_xml = report_payloads.get("RESC")
    if estimates_xml:
        estimates = parse_metric_report_xml(estimates_xml, title="Analyst Estimates", statement_type="estimates")
        if not estimates:
            source_notices.append("IBKR returned RESC XML, but no analyst estimate rows could be parsed.")

    return ParsedFundamentalReports(statements=statements, ratios=ratios, estimates=estimates, source_notices=source_notices)


def parse_financial_statement_xml(xml_payload: str) -> list[FinancialStatementTable]:
    root = _parse_xml(xml_payload)
    if root is None:
        return []
    coa_labels = _extract_coa_labels(root)
    periods = _extract_statement_periods(root, coa_labels)
    tables: list[FinancialStatementTable] = []
    for statement_type in ("income_statement", "balance_sheet", "cash_flow"):
        for period_type in ("annual", "quarterly"):
            matching_periods = [
                period for period in periods if period["statement_type"] == statement_type and period["period_type"] == period_type
            ]
            table = _build_statement_table(statement_type, period_type, matching_periods)
            if table is not None:
                tables.append(table)
    return tables


def parse_metric_report_xml(xml_payload: str, *, title: str, statement_type: str) -> list[FinancialStatementTable]:
    root = _parse_xml(xml_payload)
    if root is None:
        return []
    period_tables = _parse_period_metric_tables(root, title=title, statement_type=statement_type)
    if period_tables:
        return period_tables

    rows: list[FinancialMetricRow] = []
    seen_labels: set[str] = set()
    for element in root.iter():
        if list(element):
            continue
        label = _metric_label(element)
        value = _coerce_value((element.text or "").strip())
        if not label or value in {None, ""} or label in seen_labels:
            continue
        rows.append(FinancialMetricRow(label=label, values=[value]))
        seen_labels.add(label)

    if not rows:
        return []
    return [
        FinancialStatementTable(
            statementType=statement_type,  # type: ignore[arg-type]
            periodType="current",
            title=title,
            columns=[FinancialPeriodColumn(label="Current")],
            rows=rows,
        )
    ]


def _parse_xml(xml_payload: str) -> ElementTree.Element | None:
    try:
        return ElementTree.fromstring(xml_payload)
    except ElementTree.ParseError:
        return None


def _extract_coa_labels(root: ElementTree.Element) -> dict[str, str]:
    labels: dict[str, str] = {}
    for element in root.iter():
        if _tag_name(element).lower() not in {"mapitem", "coaitem"}:
            continue
        key = _first_attr(element, "coaItem", "coaCode", "code", "id")
        label = _first_attr(element, "statementLine", "lineName", "name")
        if label is None:
            label = (element.text or "").strip() or None
        if key and label:
            labels[_normalize_key(key)] = _clean_label(label)
    return labels


def _extract_statement_periods(root: ElementTree.Element, coa_labels: dict[str, str]) -> list[dict[str, Any]]:
    periods: list[dict[str, Any]] = []
    for period in root.iter():
        if _tag_name(period).lower() not in {"fiscalperiod", "period"}:
            continue
        period_type = _period_type(period)
        column = _period_column(period, period_type)
        for statement in period.iter():
            if _tag_name(statement).lower() != "statement":
                continue
            statement_type = _statement_type(_first_attr(statement, "Type", "type", "statementType", "StatementType"))
            if statement_type is None:
                continue
            values: list[tuple[str, float | str | None]] = []
            for line_item in statement.iter():
                if _tag_name(line_item).lower() not in {"lineitem", "line"}:
                    continue
                key = _first_attr(line_item, "coaCode", "coaItem", "code", "id")
                label = _line_item_label(line_item, key, coa_labels)
                value = _coerce_value((line_item.text or "").strip())
                if label and value not in {None, ""}:
                    values.append((label, value))
            if values:
                periods.append(
                    {
                        "statement_type": statement_type,
                        "period_type": period_type,
                        "column": column,
                        "values": values,
                    }
                )
    return periods


def _parse_period_metric_tables(root: ElementTree.Element, *, title: str, statement_type: str) -> list[FinancialStatementTable]:
    parsed_periods: list[dict[str, Any]] = []
    for period in root.iter():
        if _tag_name(period).lower() not in {"fiscalperiod", "period"}:
            continue
        values: list[tuple[str, float | str | None]] = []
        for element in period.iter():
            if element is period or list(element):
                continue
            label = _metric_label(element)
            value = _coerce_value((element.text or "").strip())
            if label and value not in {None, ""}:
                values.append((label, value))
        if values:
            period_type = _period_type(period)
            parsed_periods.append({"period_type": period_type, "column": _period_column(period, period_type), "values": values})

    tables: list[FinancialStatementTable] = []
    for period_type in ("annual", "quarterly", "unknown"):
        matching_periods = [period for period in parsed_periods if period["period_type"] == period_type]
        table = _build_statement_table(statement_type, period_type, matching_periods, title=title)
        if table is not None:
            tables.append(table)
    return tables


def _build_statement_table(
    statement_type: str,
    period_type: str,
    periods: list[dict[str, Any]],
    *,
    title: str | None = None,
) -> FinancialStatementTable | None:
    if not periods:
        return None
    columns = [period["column"] for period in periods]
    row_order: list[str] = []
    values_by_label: dict[str, list[float | str | None]] = {}
    for column_index, period in enumerate(periods):
        for label, value in period["values"]:
            if label not in values_by_label:
                row_order.append(label)
                values_by_label[label] = [None for _ in periods]
            values_by_label[label][column_index] = value
    rows = [FinancialMetricRow(label=label, values=values_by_label[label]) for label in row_order]
    if not rows:
        return None
    return FinancialStatementTable(
        statementType=statement_type,  # type: ignore[arg-type]
        periodType=period_type,  # type: ignore[arg-type]
        title=title or STATEMENT_TYPE_LABELS.get(statement_type, "Financial Table"),
        columns=columns,
        rows=rows,
    )


def _period_type(period: ElementTree.Element) -> str:
    raw = _first_attr(period, "Type", "type", "periodType", "PeriodType")
    normalized = _normalize_key(raw or "")
    if "annual" in normalized or normalized in {"a", "year", "fy"}:
        return "annual"
    if "interim" in normalized or "quarter" in normalized or normalized.startswith("q"):
        return "quarterly"
    return "unknown"


def _period_column(period: ElementTree.Element, period_type: str) -> FinancialPeriodColumn:
    end_date = _parse_date(_first_attr(period, "EndDate", "endDate", "periodEndDate", "date"))
    fiscal_year = _first_attr(period, "FiscalYear", "fiscalYear", "Year", "year")
    fiscal_period = _first_attr(period, "FiscalPeriod", "fiscalPeriod", "Period", "period")
    if period_type == "annual" and fiscal_year:
        label = f"FY {fiscal_year}"
    elif period_type == "quarterly" and fiscal_period and fiscal_year:
        label = f"{fiscal_period} {fiscal_year}"
    elif fiscal_period:
        label = fiscal_period
    elif end_date:
        label = end_date.isoformat()
    else:
        label = _first_attr(period, "Name", "name", "label") or "Period"
    return FinancialPeriodColumn(label=label, periodEnding=end_date, fiscalPeriod=fiscal_period)


def _statement_type(raw: str | None) -> str | None:
    normalized = _normalize_key(raw or "")
    return STATEMENT_TYPE_ALIASES.get(normalized)


def _line_item_label(element: ElementTree.Element, key: str | None, coa_labels: dict[str, str]) -> str | None:
    if key:
        mapped = coa_labels.get(_normalize_key(key))
        if mapped:
            return mapped
    return _metric_label(element)


def _metric_label(element: ElementTree.Element) -> str | None:
    for attr_name in ("FieldName", "fieldName", "name", "Name", "label", "Label", "desc", "Description", "coaCode", "coaItem"):
        value = element.attrib.get(attr_name)
        if value:
            return _clean_label(value)
    tag_name = _tag_name(element)
    if tag_name and tag_name.lower() not in {"value", "data"}:
        return _clean_label(tag_name)
    return None


def _first_attr(element: ElementTree.Element, *names: str) -> str | None:
    for name in names:
        value = element.attrib.get(name)
        if value not in {None, ""}:
            return str(value)
    normalized_names = {_normalize_key(name) for name in names}
    for key, value in element.attrib.items():
        if _normalize_key(key) in normalized_names and value not in {None, ""}:
            return str(value)
    return None


def _tag_name(element: ElementTree.Element) -> str:
    return str(element.tag).rsplit("}", 1)[-1]


def _clean_label(value: str) -> str:
    cleaned = value.replace("_", " ").replace("-", " ").strip()
    if cleaned.isupper() and len(cleaned) <= 8:
        return cleaned
    return " ".join(cleaned.split())


def _normalize_key(value: str) -> str:
    return "".join(character for character in str(value).lower() if character.isalnum())


def _coerce_value(value: str) -> float | str | None:
    if value in {"", "-", "--"}:
        return None
    normalized = value.replace(",", "").strip()
    multiplier = 1.0
    if normalized.endswith("%"):
        normalized = normalized[:-1].strip()
        multiplier = 1.0
    if normalized.startswith("(") and normalized.endswith(")"):
        normalized = f"-{normalized[1:-1]}"
    try:
        numeric = float(normalized) * multiplier
    except ValueError:
        return value
    if not isfinite(numeric):
        return None
    return numeric


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    text = value.strip()
    for fmt in ("%Y-%m-%d", "%Y%m%d", "%m/%d/%Y", "%d-%b-%Y", "%b %d, %Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None
