from investing_platform.services.edgar_grounding import checked_quotes, cited_claims, is_filing_url, verified_scales


def test_each_sentence_needs_its_own_evidence():
    assert cited_claims("Revenue was $130.5 billion [C1]. Net income was $72.9 billion. [C2]") == [
        ("Revenue was $130.5 billion", ["C1"]), ("Net income was $72.9 billion", ["C2"]),
    ]
    assert not cited_claims("Revenue was $130.5 billion. Net income was $72.9 billion [C2].")
    assert not cited_claims("Revenue was $130.5 billion [C1]. Demand is certain to grow.")


def test_rounding_has_to_match_the_cited_amount_and_scale():
    assert verified_scales("Net income was $72.9 billion", ["72880000000"], "") is not None
    assert verified_scales("Net income was $72.9 million", ["72880000000"], "") is None
    assert verified_scales("Revenue was $130.5 billion", ["72880000000"], "") is None


def test_quotes_must_come_from_each_attached_source():
    evidence = {"C1": "We depend on third parties.", "C2": "Delivery dates may change."}
    quotes = [{"id": key, "quote": phrase} for key, phrase in evidence.items()]
    assert checked_quotes({"supported": True, "quotes": quotes}, evidence) == evidence
    assert checked_quotes({"supported": True, "quotes": quotes[:1]}, evidence) is None
    assert checked_quotes({"supported": True, "quotes": [quotes[0], {"id": "C2", "quote": "Sales fell."}]}, evidence) is None


def test_citations_require_filing_document_urls():
    base = "https://www.sec.gov/Archives/edgar/data/1045810/000104581025000023/"
    assert is_filing_url(base + "nvda-20250126.htm")
    assert is_filing_url(base + "nvda-20250126.htm", "0001045810-25-000023")
    assert not is_filing_url(base + "nvda-20250126.htm", "0001045810-26-000023")
    assert not is_filing_url(base)
    assert not is_filing_url(base.replace("www.sec.gov", "example.org") + "nvda.htm")


def test_quote_includes_the_incident_that_caused_the_disruption():
    outcome = "These disruptions could delay sales."
    evidence = {"C1": "A security incident could interrupt service. " + outcome}
    verdict = {"supported": True, "quotes": [{"id": "C1", "quote": outcome}]}
    assert checked_quotes(verdict, evidence) == evidence
    assert checked_quotes(verdict, {"C1": outcome}) is None
