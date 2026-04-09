"""Command-line wrapper for the SEC EDGAR downloader."""

from __future__ import annotations

import argparse
import json
import sys

from options_dashboard.models import EdgarDownloadRequest
from options_dashboard.services.app_state import get_edgar_service


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Download SEC EDGAR metadata and filing documents.")
    parser.add_argument("--ticker", help="Public ticker symbol, for example AEHR.")
    parser.add_argument("--company", dest="company_name", help="Company name as published by the SEC.")
    parser.add_argument("--cik", help="CIK with or without leading zeroes.")
    parser.add_argument("--form", action="append", dest="form_types", default=[], help="Repeatable SEC form filter, for example 8-K.")
    parser.add_argument("--start-date", dest="start_date", help="Inclusive filing start date in YYYY-MM-DD format.")
    parser.add_argument("--end-date", dest="end_date", help="Inclusive filing end date in YYYY-MM-DD format.")
    parser.add_argument(
        "--mode",
        dest="download_mode",
        choices=["primary-document", "all-attachments", "metadata-only", "full-filing-bundle"],
        default="primary-document",
        help="Download mode to apply to matched filings.",
    )
    parser.add_argument("--output", dest="output_dir", help="Research root override. Downloads land under [output]/stocks/[ticker].")
    parser.add_argument(
        "--include-exhibits",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Whether attachment-oriented modes should include likely exhibit files.",
    )
    parser.add_argument(
        "--resume",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Skip files whose local checksum still matches the manifest.",
    )
    parser.add_argument("--max-requests-per-second", dest="max_requests_per_second", type=float, help="SEC-safe request ceiling.")
    parser.add_argument("--user-agent", dest="user_agent", help="Descriptive SEC user agent, for example 'Your Name you@example.com'.")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        request = EdgarDownloadRequest(
            ticker=args.ticker,
            companyName=args.company_name,
            cik=args.cik,
            formTypes=args.form_types,
            startDate=args.start_date,
            endDate=args.end_date,
            downloadMode=args.download_mode,
            outputDir=args.output_dir,
            includeExhibits=args.include_exhibits,
            resume=args.resume,
            maxRequestsPerSecond=args.max_requests_per_second,
            userAgent=args.user_agent,
        )
        result = get_edgar_service().download(request)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1

    print(json.dumps(result.model_dump(mode="json"), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
