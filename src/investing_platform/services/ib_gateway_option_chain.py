"""IB Gateway option-chain loading and historical fallback handling."""

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


class IBGatewayOptionChainMixin:
    def _load_saved_option_chain(
        self,
        symbol: str,
        expiry: str | None,
        strike_limit: int,
        lower_moneyness_pct: float,
        upper_moneyness_pct: float,
        min_moneyness_pct: float | None,
        max_moneyness_pct: float | None,
    ) -> OptionChainResponse | None:
        if not self._option_snapshot_root.exists():
            return None

        ranked_snapshots: list[tuple[date, int, Path, str]] = []
        for path in self._option_snapshot_root.glob("as_of=*/provider=*/options_chain.csv"):
            provider_name = _extract_snapshot_provider(path)
            if provider_name is None or provider_name == "mock":
                continue
            snapshot_date = _extract_snapshot_date(path)
            if snapshot_date is None or snapshot_date > _market_session_date():
                continue
            ranked_snapshots.append((snapshot_date, _snapshot_provider_priority(provider_name), path, provider_name))

        for snapshot_date, _priority, path, provider_name in sorted(
            ranked_snapshots,
            key=lambda item: (item[0], item[1]),
            reverse=True,
        ):
            try:
                frame = pd.read_csv(path)
            except Exception:
                continue
            if frame.empty or "ticker" not in frame.columns:
                continue
            symbol_frame = frame[frame["ticker"].astype(str).str.upper() == symbol].copy()
            if symbol_frame.empty:
                continue
            response = self._build_saved_option_chain_response(
                symbol_frame,
                symbol,
                expiry,
                strike_limit,
                lower_moneyness_pct,
                upper_moneyness_pct,
                min_moneyness_pct,
                max_moneyness_pct,
                snapshot_date,
                provider_name,
            )
            if response is not None:
                return response
        return None

    def _build_saved_option_chain_response(
        self,
        frame: pd.DataFrame,
        symbol: str,
        expiry: str | None,
        strike_limit: int,
        lower_moneyness_pct: float,
        upper_moneyness_pct: float,
        min_moneyness_pct: float | None,
        max_moneyness_pct: float | None,
        snapshot_date: date,
        provider_name: str,
    ) -> OptionChainResponse | None:
        if "expiration" not in frame.columns or "strike" not in frame.columns or "option_type" not in frame.columns:
            return None

        working = frame.copy()
        working["expiration"] = working["expiration"].astype(str)
        working["option_type"] = working["option_type"].astype(str).str.lower()
        expiries = sorted(working["expiration"].dropna().unique().tolist())
        if not expiries:
            return None

        selected_expiry = expiry if expiry in expiries else expiries[0]
        filtered = working[working["expiration"] == selected_expiry].copy()
        if filtered.empty:
            return None

        quote_as_of = _snapshot_close_timestamp(snapshot_date)
        underlying_price = _snapshot_underlying_price(filtered)
        selected_strikes = set(
            _select_strikes_for_window(
                filtered["strike"].dropna().astype(float).tolist(),
                underlying_price,
                lower_moneyness_pct,
                upper_moneyness_pct,
                strike_limit,
                min_moneyness_pct,
                max_moneyness_pct,
            )
        )
        filtered = filtered[filtered["strike"].astype(float).isin(selected_strikes)].copy()
        rows: list[ChainRow] = []
        for strike, strike_frame in filtered.groupby("strike", sort=True):
            call_row = _snapshot_option_row(strike_frame, "call")
            put_row = _snapshot_option_row(strike_frame, "put")
            dte = _snapshot_dte(call_row, put_row, selected_expiry, snapshot_date)
            call_mid = _snapshot_option_mid(call_row)
            put_mid = _snapshot_option_mid(put_row)
            rows.append(
                ChainRow(
                    strike=round(float(strike), 2),
                    distanceFromSpotPct=round((float(strike) - underlying_price) / underlying_price * 100.0, 2)
                    if _is_valid_number(underlying_price) and underlying_price > 0
                    else 0.0,
                    callBid=_round_or_none(_snapshot_float(call_row, "bid"), 4),
                    callAsk=_round_or_none(_snapshot_float(call_row, "ask"), 4),
                    callMid=_round_or_none(call_mid, 4),
                    callVolume=_snapshot_int(call_row, "volume"),
                    callOpenInterest=_snapshot_int(call_row, "open_interest"),
                    callIV=_round_or_none(_snapshot_pct(call_row, "implied_vol"), 2),
                    callDelta=_round_signed_or_none(_snapshot_float(call_row, "delta"), 4),
                    callTheta=None,
                    callVega=None,
                    callRho=None,
                    callAnnualizedYieldPct=_round_or_none(_annualized_yield(call_mid, underlying_price, dte), 2),
                    putBid=_round_or_none(_snapshot_float(put_row, "bid"), 4),
                    putAsk=_round_or_none(_snapshot_float(put_row, "ask"), 4),
                    putMid=_round_or_none(put_mid, 4),
                    putVolume=_snapshot_int(put_row, "volume"),
                    putOpenInterest=_snapshot_int(put_row, "open_interest"),
                    putIV=_round_or_none(_snapshot_pct(put_row, "implied_vol"), 2),
                    putDelta=_round_signed_or_none(_snapshot_float(put_row, "delta"), 4),
                    putTheta=None,
                    putVega=None,
                    putRho=None,
                    putAnnualizedYieldPct=_round_or_none(_annualized_yield(put_mid, float(strike), dte), 2),
                    conservativePutCollateral=round(float(strike) * 100.0, 2),
                )
            )

        if not rows:
            return None

        provider_label = provider_name.upper()
        return OptionChainResponse(
            symbol=symbol,
            selectedExpiry=selected_expiry,
            expiries=expiries,
            underlying=UnderlyingQuote(
                symbol=symbol,
                price=round(underlying_price, 4),
                bid=None,
                ask=None,
                last=None,
                close=round(underlying_price, 4),
                marketDataStatus=f"{provider_label} SNAPSHOT",
                generatedAt=quote_as_of,
            ),
            rows=rows,
            highlights=_chain_highlights(rows, selected_expiry),
            quoteSource="historical",
            quoteAsOf=quote_as_of,
            quoteNotice=(
                f"Market is closed, so the chain is showing the latest saved {provider_label} snapshot for {symbol} "
                f"from {snapshot_date.isoformat()} close."
            ),
            generatedAt=datetime.now(UTC),
            isStale=False,
        )

    def _fetch_option_chain(
        self,
        ib: Any,
        symbol: str,
        expiry: str | None,
        strike_limit: int,
        lower_moneyness_pct: float,
        upper_moneyness_pct: float,
        min_moneyness_pct: float | None,
        max_moneyness_pct: float | None,
    ) -> OptionChainResponse:
        self._ensure_connected(ib)
        generated_at = datetime.now(UTC)
        underlying_contract = self._qualify_one(ib, Stock(symbol, self.settings.ib_underlying_exchange, self.settings.ib_currency))
        underlying_ticker, resolved_market_data_type = self._request_underlying_ticker(ib, underlying_contract)
        underlying_price = _ticker_market_price(underlying_ticker)
        if not _is_valid_number(underlying_price):
            underlying_price = _latest_underlying_price(ib, underlying_contract) or 0.0
        if not _is_valid_number(underlying_price):
            market_data_issue = self._latest_market_data_issue()
            if market_data_issue:
                raise RuntimeError(
                    f"No market or recent historical price returned for {symbol}. {market_data_issue}"
                )
            raise RuntimeError(
                f"No market or recent historical price returned for {symbol}. Check the symbol and market data permissions in IB Gateway."
            )

        definitions = ib.reqSecDefOptParams(symbol, "", underlying_contract.secType, underlying_contract.conId)
        if not definitions:
            raise RuntimeError(f"IB Gateway returned no option definitions for {symbol}.")
        definition = _select_definition(definitions, self.settings.ib_option_exchange, symbol)
        expiries = _select_expiries(
            definition.expirations,
            min_days=0,
            max_days=120,
            limit=self.settings.chain_expiry_limit,
        )
        selected_expiry = expiry if expiry in expiries else expiries[0]
        strikes = _select_strikes_for_window(
            definition.strikes,
            underlying_price,
            lower_moneyness_pct=lower_moneyness_pct,
            upper_moneyness_pct=upper_moneyness_pct,
            limit=strike_limit,
            min_moneyness_pct=min_moneyness_pct,
            max_moneyness_pct=max_moneyness_pct,
        )
        contracts: list[Any] = []
        for strike in strikes:
            contracts.append(
                Option(
                    symbol,
                    selected_expiry.replace("-", ""),
                    float(strike),
                    "C",
                    self.settings.ib_option_exchange,
                    currency=self.settings.ib_currency,
                    tradingClass=definition.tradingClass,
                )
            )
            contracts.append(
                Option(
                    symbol,
                    selected_expiry.replace("-", ""),
                    float(strike),
                    "P",
                    self.settings.ib_option_exchange,
                    currency=self.settings.ib_currency,
                    tradingClass=definition.tradingClass,
                )
            )
        qualified_contracts = self._qualify_in_batches(ib, contracts)
        contracts_by_strike: dict[float, dict[str, Any]] = {}
        for contract in qualified_contracts:
            contracts_by_strike.setdefault(float(contract.strike), {})[contract.right] = contract
        if not qualified_contracts:
            raise RuntimeError(f"No option contracts qualified for {symbol} {selected_expiry}.")
        tickers, resolved_market_data_type = self._request_option_tickers(ib, qualified_contracts, resolved_market_data_type)
        market_data_issue = self._latest_market_data_issue()
        quote_source = "streaming" if any(_ticker_has_live_option_quote(ticker) for ticker in tickers) else "unavailable"
        quote_as_of: datetime | None = None
        historical_midpoints: dict[int, float] = {}
        if quote_source == "unavailable":
            fallback_contracts = _select_historical_fallback_contracts(
                qualified_contracts,
                underlying_price,
                self.settings.chain_historical_fallback_contract_limit,
            )
            historical_midpoints, quote_as_of = self._fetch_recent_option_midpoints(ib, fallback_contracts)
            if historical_midpoints:
                quote_source = "historical"
        by_strike: dict[float, dict[str, Any]] = {}
        for ticker in tickers:
            contract = ticker.contract
            by_strike.setdefault(float(contract.strike), {})[contract.right] = ticker
        rows: list[ChainRow] = []
        dte = max((date.fromisoformat(selected_expiry) - date.today()).days, 1)
        for strike in sorted(contracts_by_strike):
            strike_tickers = by_strike.get(strike, {})
            call_ticker = strike_tickers.get("C")
            put_ticker = strike_tickers.get("P")
            call_contract = contracts_by_strike[strike].get("C")
            put_contract = contracts_by_strike[strike].get("P")
            call_historical_mid = historical_midpoints.get(int(call_contract.conId)) if call_contract is not None else None
            put_historical_mid = historical_midpoints.get(int(put_contract.conId)) if put_contract is not None else None
            call_mid = (
                _midpoint(_safe_float(getattr(call_ticker, "bid", None)), _safe_float(getattr(call_ticker, "ask", None)))
                or _ticker_option_mark(call_ticker)
                or call_historical_mid
            )
            put_mid = (
                _midpoint(_safe_float(getattr(put_ticker, "bid", None)), _safe_float(getattr(put_ticker, "ask", None)))
                or _ticker_option_mark(put_ticker)
                or put_historical_mid
            )
            call_iv = _extract_greek(call_ticker, "impliedVol", percent=True)
            call_delta = _extract_greek(call_ticker, "delta")
            call_gamma = _extract_greek(call_ticker, "gamma")
            call_theta = _extract_greek(call_ticker, "theta")
            call_vega = _extract_greek(call_ticker, "vega")
            call_rho = _extract_greek(call_ticker, "rho")
            put_iv = _extract_greek(put_ticker, "impliedVol", percent=True)
            put_delta = _extract_greek(put_ticker, "delta")
            put_gamma = _extract_greek(put_ticker, "gamma")
            put_theta = _extract_greek(put_ticker, "theta")
            put_vega = _extract_greek(put_ticker, "vega")
            put_rho = _extract_greek(put_ticker, "rho")
            rows.append(
                ChainRow(
                    strike=round(strike, 2),
                    distanceFromSpotPct=round((strike - underlying_price) / underlying_price * 100.0, 2),
                    callBid=_round_or_none(_safe_float(getattr(call_ticker, "bid", None)), 4),
                    callAsk=_round_or_none(_safe_float(getattr(call_ticker, "ask", None)), 4),
                    callMid=_round_or_none(call_mid, 4),
                    callVolume=_extract_option_volume(call_ticker, "C"),
                    callOpenInterest=_extract_option_open_interest(call_ticker, "C"),
                    callIV=_round_or_none(call_iv, 2),
                    callDelta=_round_signed_or_none(call_delta, 4),
                    callGamma=_round_signed_or_none(call_gamma, 4),
                    callTheta=_round_signed_or_none(call_theta, 4),
                    callVega=_round_signed_or_none(call_vega, 4),
                    callRho=_round_signed_or_none(call_rho, 4),
                    callAnnualizedYieldPct=_round_or_none(_annualized_yield(call_mid, underlying_price, dte), 2),
                    putBid=_round_or_none(_safe_float(getattr(put_ticker, "bid", None)), 4),
                    putAsk=_round_or_none(_safe_float(getattr(put_ticker, "ask", None)), 4),
                    putMid=_round_or_none(put_mid, 4),
                    putVolume=_extract_option_volume(put_ticker, "P"),
                    putOpenInterest=_extract_option_open_interest(put_ticker, "P"),
                    putIV=_round_or_none(put_iv, 2),
                    putDelta=_round_signed_or_none(put_delta, 4),
                    putGamma=_round_signed_or_none(put_gamma, 4),
                    putTheta=_round_signed_or_none(put_theta, 4),
                    putVega=_round_signed_or_none(put_vega, 4),
                    putRho=_round_signed_or_none(put_rho, 4),
                    putAnnualizedYieldPct=_round_or_none(_annualized_yield(put_mid, strike, dte), 2),
                    conservativePutCollateral=round(strike * 100.0, 2),
                )
            )
        underlying = UnderlyingQuote(
            symbol=symbol,
            price=round(underlying_price, 4),
            bid=_round_or_none(_safe_float(getattr(underlying_ticker, "bid", None)), 4),
            ask=_round_or_none(_safe_float(getattr(underlying_ticker, "ask", None)), 4),
            last=_round_or_none(_safe_float(getattr(underlying_ticker, "last", None)), 4),
            close=_round_or_none(_safe_float(getattr(underlying_ticker, "close", None)), 4),
            marketDataStatus=_market_data_mode_label(resolved_market_data_type),
            generatedAt=generated_at,
        )
        return OptionChainResponse(
            symbol=symbol,
            selectedExpiry=selected_expiry,
            expiries=expiries,
            underlying=underlying,
            rows=rows,
            highlights=_chain_highlights(rows, selected_expiry),
            quoteSource=quote_source,  # type: ignore[arg-type]
            quoteAsOf=quote_as_of,
            quoteNotice=_quote_notice(quote_source, quote_as_of, market_data_issue),
            generatedAt=generated_at,
            isStale=False,
        )


