"""IB Gateway stock quote, overview, and financial statement loading."""

from __future__ import annotations

import time
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Callable, Literal, cast

import pandas as pd

from investing_platform.models import *
from investing_platform.services.analytics import build_collateral_summary
from investing_platform.services.base import PortfolioSnapshot
from investing_platform.services.ib_gateway_chain_helpers import *
from investing_platform.services.ib_gateway_fundamental_helpers import *
from investing_platform.services.ib_gateway_models import *
from investing_platform.services.ib_gateway_order_helpers import *
from investing_platform.services.ib_gateway_quote_helpers import *
from investing_platform.services.ib_gateway_runtime import *
from investing_platform.services.ibkr_fundamentals import parse_ibkr_fundamental_reports


class IBGatewayMarketDataMixin:
    def _fetch_underlying_quote(self, ib: Any, symbol: str) -> UnderlyingQuote:
        self._ensure_connected(ib)
        contract = Stock(symbol, self.settings.ib_underlying_exchange, self.settings.ib_currency)
        qualified = self._qualify_one(ib, contract)
        ticker, resolved_market_data_type = self._request_underlying_ticker(ib, qualified)
        generated_at = datetime.now(UTC)
        price = _ticker_market_price(ticker)
        if not _is_valid_number(price):
            price = _latest_underlying_price(ib, qualified) or 0.0
        return UnderlyingQuote(
            symbol=symbol,
            price=round(price, 4),
            bid=round(_safe_float(getattr(ticker, "bid", None)), 4) if _is_valid_number(_safe_float(getattr(ticker, "bid", None))) else None,
            ask=round(_safe_float(getattr(ticker, "ask", None)), 4) if _is_valid_number(_safe_float(getattr(ticker, "ask", None))) else None,
            last=round(_safe_float(getattr(ticker, "last", None)), 4) if _is_valid_number(_safe_float(getattr(ticker, "last", None))) else None,
            close=round(_safe_float(getattr(ticker, "close", None)), 4) if _is_valid_number(_safe_float(getattr(ticker, "close", None))) else None,
            marketDataStatus=_market_data_mode_label(resolved_market_data_type),
            generatedAt=generated_at,
        )

    def _fetch_ticker_overview(self, ib: Any, symbol: str) -> TickerOverviewResponse:
        self._ensure_connected(ib)
        generated_at = datetime.now(UTC)
        qualified = self._qualify_one(ib, Stock(symbol, self.settings.ib_underlying_exchange, self.settings.ib_currency))
        ticker, resolved_market_data_type = self._request_underlying_ticker(ib, qualified)
        overview_ticker = self._req_stock_overview_snapshot(ib, qualified, resolved_market_data_type)
        if overview_ticker is not None:
            ticker = _merge_ticker_payloads(ticker, overview_ticker)
        price = _ticker_market_price(ticker)
        if not _is_valid_number(price):
            price = _latest_underlying_price(ib, qualified) or 0.0
        quote = UnderlyingQuote(
            symbol=symbol,
            price=round(price, 4),
            bid=_round_or_none(_safe_float(getattr(ticker, "bid", None)), 4),
            ask=_round_or_none(_safe_float(getattr(ticker, "ask", None)), 4),
            last=_round_or_none(_safe_float(getattr(ticker, "last", None)), 4),
            close=_round_or_none(_safe_float(getattr(ticker, "close", None)), 4),
            marketDataStatus=_market_data_mode_label(resolved_market_data_type),
            generatedAt=generated_at,
        )

        ratio_values = _extract_fundamental_ratios(getattr(ticker, "fundamentalRatios", None))
        source_notices: list[str] = []
        snapshot_xml = self._request_fundamental_report(ib, qualified, "ReportSnapshot")
        if snapshot_xml:
            ratio_values.update(_extract_fundamental_xml_values(snapshot_xml))
        else:
            source_notices.append("IBKR did not return a fundamental ReportSnapshot for this symbol/session.")
        calendar_xml = self._request_fundamental_report(ib, qualified, "CalendarReport")
        if calendar_xml:
            ratio_values.update(_extract_fundamental_xml_values(calendar_xml))

        fallback_values = _fetch_yfinance_fundamentals(symbol)
        if fallback_values:
            source_notices.append("Fundamental overview fields are filled from yfinance when IBKR does not return them.")

        shares_outstanding = _first_present(
            _normalize_share_count(_metric_value(ratio_values, "sharesoutstanding", "sharesout", "ttmsharesout", "commonsharesoutstanding")),
            _metric_value(fallback_values, "sharesoutstanding", "impliedsharesoutstanding"),
        )
        market_cap = _first_present(
            _normalize_large_statement_value(_metric_value(ratio_values, "marketcap", "mktcap", "marketcapitalization")),
            _metric_value(fallback_values, "marketcap"),
        )
        if market_cap is not None and shares_outstanding is not None and _is_valid_number(price):
            share_implied_market_cap = price * shares_outstanding
            if abs(market_cap - share_implied_market_cap) > abs(market_cap * 1_000_000.0 - share_implied_market_cap):
                market_cap *= 1_000_000.0
        revenue_ttm = _first_present(
            _normalize_large_statement_value(_metric_value(ratio_values, "revenuettm", "ttmrev", "revenue", "totalrevenuettm")),
            _metric_value(fallback_values, "totalrevenue", "revenuettm"),
        )
        net_income_ttm = _first_present(
            _normalize_large_statement_value(_metric_value(ratio_values, "netincomettm", "ttminc", "netincome", "incomeaftertax")),
            _metric_value(fallback_values, "netincometocommon", "netincome"),
        )
        eps_ttm = _first_present(
            _metric_value(ratio_values, "epsttm", "ttmeps", "ttmepsxclx", "eps", "epsinclx"),
            _metric_value(fallback_values, "trailingeps", "epsttm"),
        )
        dividend_data = getattr(ticker, "dividends", None)
        dividend_amount = _first_present(
            _metric_value(ratio_values, "dividend", "dividendamount", "dividendpershare", "dps"),
            _metric_value(fallback_values, "dividendrate", "trailingannualdividendrate"),
        )
        if dividend_amount is None:
            dividend_amount = _safe_float(getattr(dividend_data, "nextAmount", None))
        dividend_yield_pct = _normalize_percent(
            _first_present(
                _metric_value(ratio_values, "dividendyield", "yield", "ttmdividendyield"),
                _metric_value(fallback_values, "dividendyield", "trailingannualdividendyield"),
            )
        )
        if dividend_amount is not None and _is_valid_number(price):
            dividend_yield_pct = dividend_amount / price * 100.0
        ex_dividend_date = _parse_date_value(
            _first_present(
                _metric_raw_value(ratio_values, "exdividenddate", "exdate", "dividendexdate"),
                getattr(dividend_data, "nextDate", None),
                _metric_raw_value(fallback_values, "exdividenddate"),
            )
        )
        if dividend_amount is None:
            ex_dividend_date = None
        price_target = _first_present(
            _metric_value(ratio_values, "pricetarget", "targetprice", "consensusprice", "meanpricetarget"),
            _metric_value(fallback_values, "targetmeanprice", "pricetarget"),
        )
        price_target_upside_pct = ((price_target / price - 1.0) * 100.0) if price_target is not None and _is_valid_number(price) else None
        source_notice = " ".join(source_notices) if source_notices else None

        return TickerOverviewResponse(
            symbol=symbol,
            quote=quote,
            marketCap=_round_or_none(market_cap, 2),
            marketCapChangePct=_round_signed_or_none(_normalize_percent(_metric_value(ratio_values, "marketcapgrowth", "mktcapchg", "marketcapchangepct")), 2),
            revenueTtm=_round_or_none(revenue_ttm, 2),
            revenueTtmChangePct=_round_signed_or_none(
                _normalize_percent(_first_present(_metric_value(ratio_values, "revenuegrowth", "revenuegrowthrate", "ttmrevgrowth"), _metric_value(fallback_values, "revenuegrowth"))),
                2,
            ),
            netIncomeTtm=_round_signed_or_none(net_income_ttm, 2),
            netIncomeTtmChangePct=_round_signed_or_none(_normalize_percent(_metric_value(ratio_values, "netincomegrowth", "incomegrowth", "ttmincgrowth")), 2),
            epsTtm=_round_signed_or_none(eps_ttm, 4),
            epsTtmChangePct=_round_signed_or_none(
                _normalize_percent(_first_present(_metric_value(ratio_values, "epsgrowth", "ttmepsgrowth", "epsgrowthrate"), _metric_value(fallback_values, "earningsgrowth"))),
                2,
            ),
            sharesOutstanding=_round_or_none(shares_outstanding, 0),
            peRatio=_round_or_none(_first_present(_metric_value(ratio_values, "peratio", "pe", "peexclxor", "trailingpe"), _metric_value(fallback_values, "trailingpe")), 2),
            forwardPeRatio=_round_or_none(_first_present(_metric_value(ratio_values, "forwardpe", "forwardperatio", "projpe"), _metric_value(fallback_values, "forwardpe")), 2),
            dividendAmount=_round_or_none(dividend_amount, 4),
            dividendYieldPct=_round_or_none(dividend_yield_pct, 2),
            exDividendDate=ex_dividend_date,
            volume=_optional_int(_first_present(getattr(ticker, "volume", None), _metric_raw_value(fallback_values, "volume", "regularmarketvolume"))),
            open=_round_or_none(_first_present(_safe_float(getattr(ticker, "open", None)), _metric_value(fallback_values, "open", "regularmarketopen")), 4),
            previousClose=_round_or_none(_first_present(quote.close, _metric_value(fallback_values, "previousclose", "regularmarketpreviousclose")), 4),
            dayRangeLow=_round_or_none(_first_present(_safe_float(getattr(ticker, "low", None)), _metric_value(fallback_values, "daylow", "regularmarketdaylow")), 4),
            dayRangeHigh=_round_or_none(_first_present(_safe_float(getattr(ticker, "high", None)), _metric_value(fallback_values, "dayhigh", "regularmarketdayhigh")), 4),
            week52Low=_round_or_none(_first_present(_metric_value(ratio_values, "week52low", "low52week", "price52weeklow", "low52"), _metric_value(fallback_values, "fiftytwoweeklow")), 4),
            week52High=_round_or_none(_first_present(_metric_value(ratio_values, "week52high", "high52week", "price52weekhigh", "high52"), _metric_value(fallback_values, "fiftytwoweekhigh")), 4),
            beta=_round_or_none(_first_present(_metric_value(ratio_values, "beta", "betaspy", "beta5y"), _metric_value(fallback_values, "beta")), 2),
            analystRating=_analyst_rating(_first_present(_metric_raw_value(ratio_values, "analystRating", "recommendation", "consensusrating"), _metric_raw_value(fallback_values, "recommendationkey", "recommendationmean"))),
            priceTarget=_round_or_none(price_target, 4),
            priceTargetUpsidePct=_round_signed_or_none(price_target_upside_pct, 2),
            earningsDate=_parse_date_value(
                _first_present(
                    _metric_raw_value(ratio_values, "earningsdate", "nextearningsdate", "epsreportdate"),
                    _metric_raw_value(fallback_values, "earningstimestamp", "earningstimestampstart", "nextfiscalyearend"),
                )
            ),
            sourceNotice=source_notice,
            generatedAt=generated_at,
            isStale=False,
        )

    def _fetch_ticker_financials(self, ib: Any, symbol: str) -> TickerFinancialsResponse:
        self._ensure_connected(ib)
        generated_at = datetime.now(UTC)
        qualified = self._qualify_one(ib, Stock(symbol, self.settings.ib_underlying_exchange, self.settings.ib_currency))
        report_payloads: dict[str, str] = {}
        report_statuses: list[FundamentalReportStatus] = []
        for report_type in FUNDAMENTAL_FINANCIAL_REPORT_TYPES:
            payload = self._request_fundamental_report(ib, qualified, report_type)
            if payload:
                report_payloads[report_type] = payload
                report_statuses.append(FundamentalReportStatus(reportType=report_type, available=True))
            else:
                report_statuses.append(
                    FundamentalReportStatus(
                        reportType=report_type,
                        available=False,
                        message="IBKR returned no payload for this symbol/session.",
                    )
                )

        parsed = parse_ibkr_fundamental_reports(report_payloads)
        source_notices = [*parsed.source_notices]
        if not report_payloads:
            source_notices.append(
                "IBKR did not return financial statement reports for this symbol/session. Check fundamentals entitlements and TWS/Gateway support."
            )
        return TickerFinancialsResponse(
            symbol=symbol,
            reports=report_statuses,
            statements=parsed.statements,
            ratios=parsed.ratios,
            estimates=parsed.estimates,
            sourceNotices=source_notices,
            generatedAt=generated_at,
            isStale=False,
        )


