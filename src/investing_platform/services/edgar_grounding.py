"""Checks applied to each claim before a filing answer is displayed."""

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import re
from urllib.parse import urlsplit


MARKER = re.compile(r"\[C(\d+)\]")
MARKER_GROUP = re.compile(r"\[C\d+\](?:[\s,]*\[C\d+\])*")
SCALES = {"thousand": 10**3, "million": 10**6, "billion": 10**9, "trillion": 10**12}
SCALED_AMOUNT = re.compile(r"(?<![\w.])(-?\$?\d+(?:,\d{3})*(?:\.\d+)?)\s+(thousand|million|billion|trillion)\b", re.I)
REFERENTIAL_CONDITION = re.compile(r"\b(?:such|these|those|this) (?:disruptions?|incidents?|events?|conditions?|risks?)\b", re.I)


def is_filing_url(url: str | None, accession: str | None = None) -> bool:
    if not url:
        return False
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.netloc not in {"www.sec.gov", "sec.gov"}:
        return False
    path = re.fullmatch(r"/Archives/edgar/data/\d+/(?:(\d+)/)?([^/]+\.(?:html?|txt|xml|pdf))", parsed.path, re.I)
    if not path:
        return False
    if accession and re.fullmatch(r"\d{10}-\d{2}-\d{6}", accession):
        if path[1]:
            return path[1] == accession.replace("-", "")
        return path[2] == f"{accession}.txt"
    return True


def cited_claims(answer: str) -> list[tuple[str, list[str]]]:
    # Accept both "claim [C1]." and "claim. [C1]" while keeping uncited sentences separate.
    answer = re.sub(r"([.!?])[ \t]+(" + MARKER_GROUP.pattern + r")", r" \2\1", answer)
    answer = re.sub(r"\b(?:[A-Za-z]\.){2,}", lambda m: m[0].replace(".", "\u2024"), answer)
    claims = []
    for sentence in re.split(r"(?<=[.!?])\s+|[;\n]+", answer):
        sentence = sentence.replace("\u2024", ".")
        start = 0
        for group in MARKER_GROUP.finditer(sentence):
            claim = sentence[start:group.start()].strip(" \t-*•,")
            if not claim:
                return []
            claims.append((claim, list(dict.fromkeys("C" + n for n in MARKER.findall(group[0])))))
            start = group.end()
        if sentence[start:].strip(" \t.,!?"):
            return []
    return claims


def verified_scales(claim: str, usd_values: list[str], source_text: str) -> str | None:
    """Return unscaled prose for the literal-number check after comparing monetary units."""
    for match in SCALED_AMOUNT.finditer(claim):
        number = Decimal(match[1].replace("$", "").replace(",", ""))
        scale = SCALES[match[2].lower()]
        # Text can also report an explicitly scaled amount, without an XBRL citation.
        values = list(usd_values)
        for source in SCALED_AMOUNT.finditer(source_text):
            amount = Decimal(source[1].replace("$", "").replace(",", ""))
            values.append(str(amount * SCALES[source[2].lower()]))
        try:
            if not any((Decimal(v) / scale).quantize(number, rounding=ROUND_HALF_UP) == number for v in values):
                return None
        except InvalidOperation:
            return None
    return SCALED_AMOUNT.sub("", claim)


def checked_quotes(verdict: dict, evidence: dict[str, str]) -> dict[str, str] | None:
    if verdict.get("supported") is not True or not isinstance(verdict.get("quotes"), list):
        return None
    quotes = {}
    for entry in verdict["quotes"]:
        if not isinstance(entry, dict):
            return None
        key, quote = entry.get("id"), entry.get("quote")
        if not isinstance(key, str) or key not in evidence or not isinstance(quote, str):
            return None
        quote = " ".join(quote.split())
        source = " ".join(evidence[key].split())
        if not quote or quote not in source:
            return None
        # A consequence of "these disruptions" can describe a completely
        # different risk. Give the second reviewer the original antecedent.
        first_sentence = re.split(r"(?<=[.!?])\s+", quote, maxsplit=1)[0]
        if REFERENTIAL_CONDITION.search(first_sentence):
            prefix = source.partition(quote)[0].rstrip()
            if not prefix:
                return None
            preceding = re.split(r"(?<=[.!?])\s+", prefix)[-2:]
            start = source.rfind(preceding[0], 0, len(prefix))
            quote = source[start:source.index(quote) + len(quote)]
        quotes[key] = quote
    return quotes if quotes.keys() == evidence.keys() else None


def contextual_quotes(quotes: dict[str, str], evidence: dict[str, str]) -> dict[str, str]:
    """Keep the quote verbatim and include nearby sentences defining its period or conditions."""
    result = {}
    for key, quote in quotes.items():
        source = " ".join(evidence[key].split())
        offset = source.find(quote)
        if offset < 0:
            result[key] = quote
            continue
        before = source[:offset].rstrip()
        after = source[offset + len(quote):].lstrip()
        previous = re.split(r"(?<=[.!?])\s+", before)[-2:]
        following = re.split(r"(?<=[.!?])\s+", after)[:1]
        prefix = " ".join(previous)
        suffix = " ".join(following)
        start = source.rfind(prefix, 0, offset) if prefix and len(prefix) <= 900 else offset
        end = source.find(suffix, offset + len(quote)) + len(suffix) if suffix and len(suffix) <= 500 else offset + len(quote)
        result[key] = source[start if start >= 0 else offset:max(end, offset + len(quote))].strip()
    return result
