"""IB Gateway worker-thread, connection, and low-level request helpers."""

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
import asyncio
from concurrent.futures import Future
from queue import Empty


class IBGatewayConnectionMixin:
    def _submit(self, callback: Callable[[Any], TaskResultT], timeout: float) -> TaskResultT:
        future: Future[Any] = Future()
        self._tasks.put(_PendingTask(callback=callback, future=future))
        return cast(TaskResultT, future.result(timeout=timeout))

    def _worker_main(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        ib = IB()
        ib.errorEvent += self._handle_ib_error
        try:
            while not self._stop_event.is_set():
                try:
                    self._auto_reconnect_if_needed(ib)
                    task = self._tasks.get(timeout=0.2)
                except Empty:
                    task = None
                if task is not None:
                    if task.future.cancelled():
                        continue
                    try:
                        result = task.callback(ib)
                    except Exception as exc:  # pragma: no cover - exercised in runtime
                        task.future.set_exception(exc)
                    else:
                        task.future.set_result(result)
                try:
                    if ib.isConnected():
                        ib.sleep(0.05)
                        self._mark_heartbeat()
                    else:
                        time.sleep(0.05)
                except Exception as exc:  # pragma: no cover - defensive
                    self._mark_error(str(exc))
                    try:
                        if ib.isConnected():
                            ib.disconnect()
                    except Exception:
                        pass
                    time.sleep(0.2)
        finally:
            try:
                if ib.isConnected():
                    ib.disconnect()
            finally:
                asyncio.set_event_loop(None)
                loop.close()

    def _handle_ib_error(self, req_id: int, error_code: int, error_string: str, contract: Any | None = None) -> None:
        contract_symbol = _string_or_none(getattr(contract, "symbol", None)) if contract is not None else None
        detail = error_string.strip()
        if contract_symbol:
            detail = f"{detail} [{contract_symbol}]"
        with self._status_lock:
            self._recent_ib_errors.append((datetime.now(UTC), int(error_code), detail))
            self._recent_ib_errors = self._recent_ib_errors[-24:]

    def _latest_market_data_issue(self, *, max_age_seconds: float = 30.0) -> str | None:
        cutoff = datetime.now(UTC) - timedelta(seconds=max_age_seconds)
        with self._status_lock:
            recent_errors = [entry for entry in self._recent_ib_errors if entry[0] >= cutoff]
        for _at, error_code, detail in reversed(recent_errors):
            lower_detail = detail.lower()
            if error_code == 10197 or "competing live session" in lower_detail:
                return (
                    "IBKR is blocking market data because another live TWS/Gateway session is active. "
                    "Log out of other live sessions, then reconnect this dashboard."
                )
            if error_code == 162 and "different ip address" in lower_detail:
                return (
                    "IBKR is blocking historical market data because the trading session is connected from a different IP address."
                )
            if error_code in {354, 10089, 10090, 10091} or "additional subscription" in lower_detail or "not subscribed" in lower_detail:
                return (
                    "IBKR says this API session is missing the required market-data subscriptions or entitlements."
                )
        return None

    def _auto_reconnect_if_needed(self, ib: Any) -> None:
        if ib.isConnected():
            return
        with self._status_lock:
            next_attempt = self._next_reconnect_attempt_at
        if next_attempt and datetime.now(UTC) < next_attempt:
            return
        try:
            self._connect_on_thread(ib, force=False)
        except Exception as exc:
            self._mark_error(str(exc))

    def _connect_on_thread(self, ib: Any, force: bool) -> None:
        if force and ib.isConnected():
            ib.disconnect()
            self._mark_disconnected(None)
        if ib.isConnected():
            self._mark_connected(self._resolved_port)
            return
        last_error: Exception | None = None
        for port in _ib_connection_port_candidates(self.settings.ib_port, self.settings.ib_port_auto_discover):
            try:
                ib.connect(
                    self.settings.ib_host,
                    port,
                    clientId=self.settings.ib_client_id,
                    readonly=self.settings.execution_mode == "disabled",
                    timeout=self.settings.ib_connect_timeout_seconds,
                    account=self.settings.ib_account_id or "",
                )
            except Exception as exc:
                last_error = exc
                continue
            ib.reqMarketDataType(_effective_market_data_type(self.settings.ib_market_data_type))
            self._remember_account_id(self._resolve_account_id(ib))
            self._mark_connected(port)
            return
        if last_error is not None:
            raise last_error

    def _qualify_one(self, ib: Any, contract: Any) -> Any:
        qualified = self._qualify_in_batches(ib, [contract])
        if not qualified:
            raise RuntimeError(f"Unable to qualify contract for {getattr(contract, 'symbol', 'unknown')}.")
        return qualified[0]

    def _qualify_in_batches(self, ib: Any, contracts: list[Any]) -> list[Any]:
        qualified: list[Any] = []
        for batch in _batched(contracts, 30):
            result = ib.qualifyContracts(*batch)
            qualified.extend(result)
        return qualified

    def _request_underlying_ticker(self, ib: Any, contract: Any) -> tuple[Any, int]:
        last_ticker: Any | None = None
        last_market_data_type = self.settings.ib_market_data_type
        for market_data_type in _market_data_type_candidates(self.settings.ib_market_data_type):
            ticker = self._req_ticker_snapshot(ib, contract, market_data_type) or self._req_market_data_snapshot(ib, contract, market_data_type)
            last_ticker = ticker
            last_market_data_type = market_data_type
            if _is_valid_number(_ticker_market_price(ticker)):
                return ticker, market_data_type
            market_data_issue = self._latest_market_data_issue()
            if _is_hard_market_data_blocker(market_data_issue):
                break
        if last_ticker is not None:
            return last_ticker, last_market_data_type
        market_data_issue = self._latest_market_data_issue()
        if market_data_issue:
            raise RuntimeError(f"No market data returned for {contract.symbol}. {market_data_issue}")
        raise RuntimeError(f"No market data returned for {contract.symbol}. Check the symbol and market data permissions in IB Gateway.")

    def _req_ticker_snapshot(self, ib: Any, contract: Any, market_data_type: int) -> Any | None:
        ib.reqMarketDataType(market_data_type)
        try:
            tickers = ib.reqTickers(contract)
        except Exception:
            return None
        if not tickers:
            return None
        return tickers[0]

    def _request_option_tickers(self, ib: Any, contracts: list[Any], preferred_market_data_type: int) -> tuple[list[Any], int]:
        best_tickers: list[Any] = []
        best_market_data_type = preferred_market_data_type
        best_score = -1
        minimum_useful_payloads = max(4, min(len(contracts), 10))
        for market_data_type in _option_market_data_type_candidates(preferred_market_data_type):
            tickers = self._req_market_data_in_batches(
                ib,
                contracts,
                market_data_type,
                generic_tick_list=OPTION_CHAIN_GENERIC_TICKS,
            )
            payload_count = sum(1 for ticker in tickers if _ticker_has_option_payload(ticker))
            score = sum(_ticker_option_payload_score(ticker) for ticker in tickers)
            if score > best_score:
                best_tickers = tickers
                best_market_data_type = market_data_type
                best_score = score
            if payload_count >= minimum_useful_payloads:
                break
            market_data_issue = self._latest_market_data_issue()
            if _is_hard_market_data_blocker(market_data_issue):
                break
        return best_tickers, best_market_data_type

    def _req_market_data_snapshot(self, ib: Any, contract: Any, market_data_type: int, generic_tick_list: str = "") -> Any:
        ib.reqMarketDataType(market_data_type)
        ticker = ib.reqMktData(contract, generic_tick_list, False, False)
        try:
            deadline = time.monotonic() + min(max(self.settings.ib_request_timeout_seconds / 4.0, 1.5), 4.0)
            while time.monotonic() < deadline:
                ib.sleep(0.2)
                if _ticker_has_quote_payload(ticker):
                    break
            return ticker
        finally:
            try:
                ib.cancelMktData(contract)
            except Exception:
                pass

    def _req_stock_overview_snapshot(self, ib: Any, contract: Any, market_data_type: int) -> Any | None:
        ib.reqMarketDataType(market_data_type)
        ticker = ib.reqMktData(contract, STOCK_OVERVIEW_GENERIC_TICKS, False, False)
        try:
            deadline = time.monotonic() + min(max(self.settings.ib_request_timeout_seconds / 3.0, 2.5), 6.0)
            while time.monotonic() < deadline:
                ib.sleep(0.25)
                if _ticker_has_quote_payload(ticker) and (
                    getattr(ticker, "fundamentalRatios", None) is not None or getattr(ticker, "dividends", None) is not None
                ):
                    break
            return ticker
        except Exception:
            return None
        finally:
            try:
                ib.cancelMktData(contract)
            except Exception:
                pass

    def _request_fundamental_report(self, ib: Any, contract: Any, report_type: str) -> str | None:
        try:
            payload = ib.reqFundamentalData(contract, report_type)
        except Exception:
            return None
        return payload if isinstance(payload, str) and payload.strip() else None

    def _req_market_data_in_batches(
        self,
        ib: Any,
        contracts: list[Any],
        market_data_type: int,
        generic_tick_list: str = "",
    ) -> list[Any]:
        tickers: list[Any] = []
        batch_size = _option_market_data_batch_size(self.settings.chain_batch_size, market_data_type)
        minimum_wait_seconds, deadline_seconds = _option_market_data_wait_profile(market_data_type)
        for batch in _batched(contracts, batch_size):
            ib.reqMarketDataType(market_data_type)
            batch_tickers = [ib.reqMktData(contract, generic_tick_list, False, False) for contract in batch]
            started_at = time.monotonic()
            settle_at = started_at + minimum_wait_seconds
            deadline = started_at + min(max(self.settings.ib_request_timeout_seconds / 8.0, deadline_seconds), deadline_seconds + 1.0)
            while time.monotonic() < deadline:
                ib.sleep(0.2)
                if time.monotonic() >= settle_at and all(_ticker_has_option_payload(ticker) for ticker in batch_tickers):
                    break
            tickers.extend(batch_tickers)
            for contract in batch:
                try:
                    ib.cancelMktData(contract)
                except Exception:
                    pass
        return tickers

    def _fetch_recent_option_midpoints(self, ib: Any, contracts: list[Any]) -> tuple[dict[int, float], datetime | None]:
        historical_midpoints: dict[int, float] = {}
        latest_bar_at: datetime | None = None
        for contract in contracts:
            midpoint, bar_at = _latest_option_midpoint(ib, contract)
            con_id = getattr(contract, "conId", None)
            if con_id and _is_valid_number(midpoint):
                historical_midpoints[int(con_id)] = round(float(midpoint), 4)
            if bar_at is not None and (latest_bar_at is None or bar_at > latest_bar_at):
                latest_bar_at = bar_at
        return historical_midpoints, latest_bar_at

    def _req_tickers_in_batches(self, ib: Any, contracts: list[Any]) -> list[Any]:
        tickers: list[Any] = []
        for batch in _batched(contracts, self.settings.chain_batch_size):
            tickers.extend(ib.reqTickers(*batch))
        return tickers

    def _ensure_connected(self, ib: Any) -> None:
        if not ib.isConnected():
            self._connect_on_thread(ib, force=False)
        if not ib.isConnected():
            raise RuntimeError(
                f"Unable to connect to IB Gateway at {self.settings.ib_host}:{self.settings.ib_port}. Verify the gateway is running and socket API access is enabled."
            )

    def _resolve_account_id(self, ib: Any, requested_account_id: str | None = None) -> str:
        if requested_account_id:
            normalized = requested_account_id.strip().upper()
            accounts = self._load_managed_accounts(ib)
            if accounts and normalized not in accounts:
                raise RuntimeError(f"Account {normalized} is not available in the current IB Gateway session.")
            return normalized
        if self.settings.ib_account_id:
            return self.settings.ib_account_id
        accounts = self._load_managed_accounts(ib)
        if not accounts:
            raise RuntimeError("IB Gateway returned no managed accounts. Check your gateway session and account permissions.")
        return accounts[0]

    def _load_managed_accounts(self, ib: Any) -> list[str]:
        accounts = list(ib.managedAccounts())
        normalized = [str(account).strip().upper() for account in accounts if str(account).strip()]
        self._remember_managed_accounts(normalized)
        return normalized

    def _portfolio_cache_key(self, account_id: str | None) -> str:
        return (account_id or self._resolved_account_id or self.settings.ib_account_id or "__default__").strip().upper()

    def _remember_account_id(self, account_id: str | None) -> None:
        if not account_id:
            return
        with self._status_lock:
            self._resolved_account_id = account_id

    def _remember_managed_accounts(self, accounts: list[str]) -> None:
        normalized = [account.strip().upper() for account in accounts if account.strip()]
        with self._status_lock:
            self._managed_accounts = normalized

    def _mark_connected(self, port: int | None = None) -> None:
        now = datetime.now(UTC)
        with self._status_lock:
            self._connected = True
            if port is not None:
                self._resolved_port = port
            self._last_successful_connect_at = now
            self._last_heartbeat_at = now
            self._last_error = None
            self._next_reconnect_attempt_at = None

    def _mark_disconnected(self, error: str | None) -> None:
        with self._status_lock:
            self._connected = False
            self._last_error = error
            self._next_reconnect_attempt_at = datetime.now(UTC) + timedelta(seconds=self.settings.ib_reconnect_interval_seconds)

    def _mark_error(self, error: str) -> None:
        self._mark_disconnected(error)

    def _mark_heartbeat(self) -> None:
        with self._status_lock:
            self._last_heartbeat_at = datetime.now(UTC)



