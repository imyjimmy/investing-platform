"""Auditable static vocabulary for EDGAR intelligence.

These terms are allowed only for safety checks, answer formatting, freshness
gating, and structured XBRL fact lookup. Retrieval ranking must not depend on
hand-authored business or question keyword lists.
"""

from __future__ import annotations

import re


ANSWER_BULLET_STYLE_TERMS = frozenset(
    {
        "summarize",
        "summarise",
        "summary",
        "list",
        "risks",
        "risk",
        "factors",
        "drivers",
        "driver",
        "headwinds",
        "tailwinds",
        "highlights",
        "overview",
        "breakdown",
        "compare",
        "comparison",
        "changed",
        "changes",
        "change",
        "key",
        "main",
        "major",
        "primary",
        "important",
        "notable",
        "pros",
        "cons",
        "opportunities",
        "threats",
        "weaknesses",
        "strengths",
    }
)

ANSWER_PARAGRAPH_EXCLUSION_TERMS = frozenset(
    {
        "risk",
        "risks",
        "factors",
        "drivers",
        "changed",
        "changes",
        "compare",
        "list",
    }
)
ANSWER_PARAGRAPH_EXCLUSION_SUBSTRINGS = ("summar",)

DIRECTION_GUARD_TERMS = frozenset(
    {
        "decrease",
        "decreased",
        "decline",
        "declined",
        "fall",
        "fell",
        "increase",
        "increased",
        "improve",
        "improved",
        "higher",
        "lower",
        "rise",
        "rose",
        "doubled",
        "halved",
    }
)

FRESHNESS_SENSITIVE_TERMS = (
    "today",
    "latest",
    "new filing",
    "recent 8-k",
    "most recent",
    "just filed",
)

REFUSAL_ANSWER_MARKERS = (
    "cannot answer",
    "can't answer",
    "insufficient evidence",
    "not enough evidence",
    "not supported by the retrieved",
)

PROMPT_INJECTION_RE = re.compile(
    r"(?i)\b(ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions|system\s+prompt|developer\s+message|answer\s+with|you\s+are\s+now)\b"
)

XBRL_CONCEPT_ALIASES: dict[str, list[str]] = {
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

XBRL_MONETARY_ALIASES = frozenset({"revenue", "operating income", "gross profit", "net income", "cash", "debt"})
XBRL_MARGIN_ALIASES = frozenset({"gross margin", "operating margin", "net margin"})
XBRL_DURATION_ALIASES = frozenset({"revenue", "operating income", "gross profit", "net income", *XBRL_MARGIN_ALIASES})
XBRL_INSTANT_ALIASES = frozenset({"cash", "debt"})
XBRL_FINANCIAL_FACT_HINT_RE = re.compile(
    r"\b(revenue|sales|income|profit|cash|debt|shares?|margin|fy|fiscal|quarter|annual|operating|gross|net)\b",
    re.IGNORECASE,
)
