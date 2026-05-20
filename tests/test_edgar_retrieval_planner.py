from __future__ import annotations

from datetime import date

from investing_platform.services.edgar_retrieval_planner import EdgarRetrievalPlanner


def test_latest_scope_selects_newest_accession_from_metadata() -> None:
    planner = EdgarRetrievalPlanner()

    plan = planner.plan(
        question="From IREN's latest filing, what revenue did they report?",
        filings=[
            {"form": "20-F", "filingDate": "2025-09-12", "accessionNumber": "old-annual"},
            {"form": "10-Q", "filingDate": "2026-05-08", "accessionNumber": "latest-quarter"},
            {"form": "6-K", "filingDate": "2026-03-21", "accessionNumber": "older-current"},
        ],
    )

    assert plan.forms == ()
    assert plan.accession_numbers == ("latest-quarter",)
    assert plan.reasons == ("latest_scope",)


def test_latest_form_scope_selects_newest_matching_form_family() -> None:
    planner = EdgarRetrievalPlanner()

    plan = planner.plan(
        question="Summarize the latest 10-Q.",
        filings=[
            {"form": "10-Q", "filingDate": "2025-11-08", "accessionNumber": "prior-quarter"},
            {"form": "10-Q/A", "filingDate": "2026-05-10", "accessionNumber": "amended-quarter"},
            {"form": "8-K", "filingDate": "2026-05-12", "accessionNumber": "current-report"},
        ],
    )

    assert plan.forms == ("10-Q", "10-Q/A")
    assert plan.accession_numbers == ("amended-quarter",)
    assert plan.reasons == ("form_scope", "latest_scope")


def test_report_phrase_scope_maps_to_filing_metadata_not_topic_terms() -> None:
    planner = EdgarRetrievalPlanner()

    plan = planner.plan(
        question="What did the annual report say?",
        filings=[
            {"form": "10-Q", "filingDate": "2026-05-08", "accessionNumber": "quarter"},
            {"form": "20-F", "filingDate": "2025-09-12", "accessionNumber": "annual"},
        ],
    )

    assert plan.forms == ("10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A")
    assert plan.accession_numbers == ()
    assert plan.reasons == ("form_scope",)


def test_explicit_accession_scope_is_preserved() -> None:
    planner = EdgarRetrievalPlanner()

    plan = planner.plan(
        question="Use the latest filing.",
        filings=[
            {"form": "10-Q", "filingDate": "2026-05-08", "accessionNumber": "latest"},
        ],
        accession_numbers=["manual"],
    )

    assert plan.forms == ()
    assert plan.accession_numbers == ()
    assert plan.reasons == ("explicit_accessions",)


def test_date_filters_bound_latest_selection() -> None:
    planner = EdgarRetrievalPlanner()

    plan = planner.plan(
        question="Use the latest filing.",
        filings=[
            {"form": "10-Q", "filingDate": "2026-05-08", "accessionNumber": "outside"},
            {"form": "10-Q", "filingDate": "2026-03-08", "accessionNumber": "inside"},
            {"form": "10-Q", "filingDate": "2025-12-08", "accessionNumber": "too-old"},
        ],
        start_date=date(2026, 1, 1),
        end_date=date(2026, 4, 1),
    )

    assert plan.accession_numbers == ("inside",)


def test_topic_language_does_not_create_a_plan() -> None:
    planner = EdgarRetrievalPlanner()

    plan = planner.plan(
        question="Evaluate IREN revenue targets, NVIDIA, bullishness, and management guidance.",
        filings=[
            {"form": "10-Q", "filingDate": "2026-05-08", "accessionNumber": "latest"},
        ],
    )

    assert plan.forms == ()
    assert plan.accession_numbers == ()
    assert plan.reasons == ()
