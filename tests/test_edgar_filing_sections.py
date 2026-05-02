from __future__ import annotations

from investing_platform.services.edgar_filing_sections import extract_filing_sections


def test_extracts_10k_item_sections_and_ignores_toc_duplicates() -> None:
    text = "\n".join(
        [
            "Table of Contents",
            "Item 1. Business 4",
            "Item 1A. Risk Factors 9",
            "Item 1C. Cybersecurity 18",
            "Item 7. Management's Discussion and Analysis 40",
            "",
            "Item 1. Business",
            "We sell hardware and services.",
            "Item 1A. Risk Factors",
            "Supply constraints and competition may affect margins.",
            "Item 1C. Cybersecurity",
            "Cybersecurity incidents could disrupt operations.",
            "Item 7. Management's Discussion and Analysis",
            "Management discussed revenue and operating income.",
        ]
    )

    sections = extract_filing_sections(form="10-K", text=text)

    assert [section["sectionCode"] for section in sections] == ["1", "1A", "1C", "7"]
    assert sections[1]["section"] == "Item 1A. Risk Factors"
    assert sections[1]["sectionType"] == "risk_factors"
    assert "Supply constraints" in sections[1]["text"]
    assert "Table of Contents" not in sections[0]["text"]
    assert _ranges_are_monotonic(sections)


def test_extracts_10q_part_aware_sections() -> None:
    text = "\n".join(
        [
            "Part I",
            "Item 1. Financial Statements",
            "Condensed consolidated statements appear here.",
            "Item 2. Management's Discussion and Analysis",
            "Management discussed revenue and liquidity.",
            "Item 3. Quantitative and Qualitative Disclosures About Market Risk",
            "Market risk disclosures appear here.",
            "Item 4. Controls and Procedures",
            "Controls were evaluated.",
            "Part II",
            "Item 1A. Risk Factors",
            "Customer concentration remains a risk.",
        ]
    )

    sections = extract_filing_sections(form="10-Q", text=text)

    assert [section["sectionCode"] for section in sections] == ["I.1", "I.2", "I.3", "I.4", "II.1A"]
    assert sections[1]["section"] == "Part I Item 2. Management's Discussion and Analysis"
    assert sections[1]["sectionType"] == "mda"
    assert sections[-1]["sectionType"] == "risk_factors"
    assert _ranges_are_monotonic(sections)


def test_extracts_8k_sections_and_uses_items_metadata_fallback() -> None:
    text = "\n".join(
        [
            "Item 2.02. Results of Operations and Financial Condition",
            "The company reported quarterly results.",
            "Item 9.01. Financial Statements and Exhibits",
            "Exhibit 99.1 is furnished.",
        ]
    )

    sections = extract_filing_sections(form="8-K", text=text)
    fallback = extract_filing_sections(
        form="8-K",
        text="The company furnished an earnings release without item headings.",
        filing_items="2.02",
    )

    assert [section["sectionCode"] for section in sections] == ["2.02", "9.01"]
    assert sections[0]["sectionType"] == "results_of_operations"
    assert fallback[0]["section"] == "Item 2.02. Results of Operations and Financial Condition"
    assert fallback[0]["sectionType"] == "results_of_operations"


def test_falls_back_for_unknown_and_foreign_forms() -> None:
    for form in ("20-F", "40-F", "6-K", "S-1"):
        sections = extract_filing_sections(form=form, text="Item 1A. Risk Factors\nForeign-filer or unsupported text.")

        assert len(sections) == 1
        assert sections[0]["section"] == "Primary Document"
        assert sections[0]["sectionType"] == "primary_document"


def test_ignores_inline_item_references() -> None:
    text = "The company says to see Item 1A for risk factors inside this paragraph."

    sections = extract_filing_sections(form="10-K", text=text)

    assert len(sections) == 1
    assert sections[0]["section"] == "Primary Document"


def _ranges_are_monotonic(sections: list[dict]) -> bool:
    ranges = [(section["startChar"], section["endChar"]) for section in sections]
    return all(start < end for start, end in ranges) and ranges == sorted(ranges)
