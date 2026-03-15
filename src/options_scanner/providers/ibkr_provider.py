"""Interactive Brokers TWS/Gateway options-chain provider."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
import logging
import math
import threading
import time
from typing import Any, Sequence

import pandas as pd

from .base import OptionsChainProvider, PriceDataProvider


LOGGER = logging.getLogger(__name__)


try:
    from ibapi.client import EClient
    from ibapi.contract import Contract, ContractDetails
    from ibapi.ticktype import TickTypeEnum
    from ibapi.wrapper import EWrapper
except ImportError:  # pragma: no cover - import guard
    EClient = object  # type: ignore[assignment]
    EWrapper = object  # type: ignore[assignment]
    Contract = object  # type: ignore[assignment]
    ContractDetails = object  # type: ignore[assignment]
    TickTypeEnum = None  # type: ignore[assignment]


GENERIC_OPTION_TICKS = "100,101,104,106,221"
UNDERLYING_SNAPSHOT_TICKS = "221"


@dataclass
class _ContractDetailsState:
    event: threading.Event = field(default_factory=threading.Event)
    details: list[ContractDetails] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


@dataclass
class _SecDefState:
    event: threading.Event = field(default_factory=threading.Event)
    definitions: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


@dataclass
class _SnapshotState:
    contract: Contract
    event: threading.Event = field(default_factory=threading.Event)
    data: dict[str, Any] = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)


@dataclass
class _HistoricalDataState:
    event: threading.Event = field(default_factory=threading.Event)
    bars: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


class _IBKRApiClient(EWrapper, EClient):
    """Small synchronous wrapper over the official IBKR socket API."""

    def __init__(
        self,
        host: str,
        port: int,
        client_id: int,
        market_data_type: int,
        connect_timeout_seconds: float,
    ) -> None:
        if TickTypeEnum is None:  # pragma: no cover - import guard
            raise RuntimeError(
                "ibapi is not installed. Install it with `pip install ibapi` or `pip install -r requirements.txt`."
            )
        EWrapper.__init__(self)
        EClient.__init__(self, wrapper=self)
        self._connect_host = host
        self._connect_port = port
        self._connect_client_id = client_id
        self.market_data_type = market_data_type
        self.connect_timeout_seconds = connect_timeout_seconds

        self._thread: threading.Thread | None = None
        self._connected_event = threading.Event()
        self._lock = threading.Lock()
        self._next_request_id = 1

        self._contract_states: dict[int, _ContractDetailsState] = {}
        self._secdef_states: dict[int, _SecDefState] = {}
        self._snapshot_states: dict[int, _SnapshotState] = {}
        self._historical_states: dict[int, _HistoricalDataState] = {}
        self._connection_errors: list[str] = []

    def connect_and_start(self) -> None:
        self.connect(self._connect_host, self._connect_port, self._connect_client_id)
        self._thread = threading.Thread(target=self.run, name="ibkr-api-thread", daemon=True)
        self._thread.start()
        if not self._connected_event.wait(self.connect_timeout_seconds):
            self.disconnect()
            details = f" Recent IBKR errors: {'; '.join(self._connection_errors)}" if self._connection_errors else ""
            raise TimeoutError(
                f"Timed out connecting to IBKR at {self._connect_host}:{self._connect_port}. Make sure TWS or IB Gateway is running and API access is enabled.{details}"
            )
        self.reqMarketDataType(self.market_data_type)

    def close(self) -> None:
        try:
            if self.isConnected():
                self.disconnect()
        finally:
            if self._thread is not None:
                self._thread.join(timeout=1.0)

    def nextValidId(self, orderId: int) -> None:  # noqa: N802 - IBKR callback name
        with self._lock:
            self._next_request_id = max(self._next_request_id, orderId)
        self._connected_event.set()

    def error(self, reqId: int, errorCode: int, errorString: str) -> None:  # noqa: N802 - IBKR callback name
        message = f"{errorCode}: {errorString}"
        if reqId in self._contract_states:
            self._contract_states[reqId].errors.append(message)
            self._contract_states[reqId].event.set()
            return
        if reqId in self._secdef_states:
            self._secdef_states[reqId].errors.append(message)
            self._secdef_states[reqId].event.set()
            return
        if reqId in self._snapshot_states:
            self._snapshot_states[reqId].errors.append(message)
            if errorCode in {200, 354, 10167, 10168}:
                self._snapshot_states[reqId].event.set()
            return
        if reqId in self._historical_states:
            self._historical_states[reqId].errors.append(message)
            self._historical_states[reqId].event.set()
            return
        self._connection_errors.append(message)

    def contractDetails(self, reqId: int, contractDetails: ContractDetails) -> None:  # noqa: N802 - IBKR callback name
        if reqId in self._contract_states:
            self._contract_states[reqId].details.append(contractDetails)

    def contractDetailsEnd(self, reqId: int) -> None:  # noqa: N802 - IBKR callback name
        if reqId in self._contract_states:
            self._contract_states[reqId].event.set()

    def securityDefinitionOptionParameter(  # noqa: N802 - IBKR callback name
        self,
        reqId: int,
        exchange: str,
        underlyingConId: int,
        tradingClass: str,
        multiplier: str,
        expirations: set,
        strikes: set,
    ) -> None:
        if reqId in self._secdef_states:
            self._secdef_states[reqId].definitions.append(
                {
                    "exchange": exchange,
                    "underlying_con_id": underlyingConId,
                    "trading_class": tradingClass,
                    "multiplier": multiplier,
                    "expirations": set(expirations),
                    "strikes": sorted(float(strike) for strike in strikes if strike is not None),
                }
            )

    def securityDefinitionOptionParameterEnd(self, reqId: int) -> None:  # noqa: N802 - IBKR callback name
        if reqId in self._secdef_states:
            self._secdef_states[reqId].event.set()

    def tickPrice(self, reqId: int, tickType: int, price: float, attrib: Any) -> None:  # noqa: N802 - IBKR callback name
        if reqId not in self._snapshot_states or price is None or price <= 0:
            return
        state = self._snapshot_states[reqId]
        tick_name = TickTypeEnum.to_str(tickType)
        if tick_name in {"BID", "DELAYED_BID"}:
            state.data["bid"] = float(price)
        elif tick_name in {"ASK", "DELAYED_ASK"}:
            state.data["ask"] = float(price)
        elif tick_name in {"LAST", "DELAYED_LAST"}:
            state.data["last"] = float(price)
        elif tick_name in {"CLOSE", "DELAYED_CLOSE"}:
            state.data["close"] = float(price)
        elif tick_name == "MARK_PRICE":
            state.data["mark"] = float(price)

    def tickSize(self, reqId: int, tickType: int, size: int) -> None:  # noqa: N802 - IBKR callback name
        if reqId not in self._snapshot_states or size is None or size < 0:
            return
        state = self._snapshot_states[reqId]
        tick_name = TickTypeEnum.to_str(tickType)
        if tick_name in {"VOLUME", "DELAYED_VOLUME", "OPTION_CALL_VOLUME", "OPTION_PUT_VOLUME"}:
            state.data["volume"] = int(size)
        elif tick_name in {"OPTION_CALL_OPEN_INTEREST", "OPTION_PUT_OPEN_INTEREST"}:
            state.data["open_interest"] = int(size)
        elif tick_name in {"BID_SIZE", "DELAYED_BID_SIZE"}:
            state.data["bid_size"] = int(size)
        elif tick_name in {"ASK_SIZE", "DELAYED_ASK_SIZE"}:
            state.data["ask_size"] = int(size)

    def tickGeneric(self, reqId: int, tickType: int, value: float) -> None:  # noqa: N802 - IBKR callback name
        if reqId not in self._snapshot_states or value is None:
            return
        state = self._snapshot_states[reqId]
        tick_name = TickTypeEnum.to_str(tickType)
        if tick_name == "OPTION_IMPLIED_VOL" and _is_finite_positive(value):
            state.data["implied_vol"] = float(value)
        elif tick_name == "MARK_PRICE" and _is_finite_positive(value):
            state.data["mark"] = float(value)

    def tickOptionComputation(  # noqa: N802 - IBKR callback name
        self,
        reqId: int,
        tickType: int,
        tickAttrib: int,
        impliedVol: float,
        delta: float,
        optPrice: float,
        pvDividend: float,
        gamma: float,
        vega: float,
        theta: float,
        undPrice: float,
    ) -> None:
        if reqId not in self._snapshot_states:
            return
        state = self._snapshot_states[reqId]
        tick_name = TickTypeEnum.to_str(tickType)

        if _is_finite_positive(impliedVol):
            if tick_name in {"MODEL_OPTION", "DELAYED_MODEL_OPTION"} or "implied_vol" not in state.data:
                state.data["implied_vol"] = float(impliedVol)
        if _is_finite_number(delta):
            if tick_name in {"MODEL_OPTION", "DELAYED_MODEL_OPTION"} or "delta" not in state.data:
                state.data["delta"] = float(delta)
        if _is_finite_positive(undPrice):
            state.data["underlying_price"] = float(undPrice)
        if _is_finite_positive(optPrice):
            if tick_name in {"MODEL_OPTION", "DELAYED_MODEL_OPTION"}:
                state.data["mark"] = float(optPrice)

    def tickSnapshotEnd(self, reqId: int) -> None:  # noqa: N802 - IBKR callback name
        if reqId in self._snapshot_states:
            self._snapshot_states[reqId].event.set()

    def historicalData(self, reqId: int, bar: Any) -> None:  # noqa: N802 - IBKR callback name
        if reqId not in self._historical_states:
            return
        self._historical_states[reqId].bars.append(
            {
                "date": str(bar.date),
                "open": float(bar.open),
                "high": float(bar.high),
                "low": float(bar.low),
                "close": float(bar.close),
                "volume": float(bar.volume),
            }
        )

    def historicalDataEnd(self, reqId: int, start: str, end: str) -> None:  # noqa: N802 - IBKR callback name
        if reqId in self._historical_states:
            self._historical_states[reqId].event.set()

    def request_contract_details(self, contract: Contract, timeout_seconds: float) -> list[ContractDetails]:
        req_id = self._allocate_request_id()
        state = _ContractDetailsState()
        self._contract_states[req_id] = state
        self.reqContractDetails(req_id, contract)
        if not state.event.wait(timeout_seconds):
            self._contract_states.pop(req_id, None)
            raise TimeoutError(f"Timed out waiting for contract details for {contract.symbol}.")
        self._contract_states.pop(req_id, None)
        if state.errors and not state.details:
            raise RuntimeError(f"IBKR contract details error for {contract.symbol}: {'; '.join(state.errors)}")
        return state.details

    def request_option_parameters(self, symbol: str, sec_type: str, con_id: int, timeout_seconds: float) -> list[dict[str, Any]]:
        req_id = self._allocate_request_id()
        state = _SecDefState()
        self._secdef_states[req_id] = state
        self.reqSecDefOptParams(req_id, symbol, "", sec_type, con_id)
        if not state.event.wait(timeout_seconds):
            raise TimeoutError(f"Timed out waiting for security definition option parameters for {symbol}.")
        self._secdef_states.pop(req_id, None)
        if state.errors and not state.definitions:
            raise RuntimeError(f"IBKR option parameter error for {symbol}: {'; '.join(state.errors)}")
        return state.definitions

    def request_historical_bars(
        self,
        contract: Contract,
        end_date: date,
        duration_str: str,
        bar_size_setting: str,
        what_to_show: str,
        use_rth: bool,
        timeout_seconds: float,
    ) -> list[dict[str, Any]]:
        req_id = self._allocate_request_id()
        state = _HistoricalDataState()
        self._historical_states[req_id] = state
        end_datetime = f"{end_date:%Y%m%d} 23:59:59"
        self.reqHistoricalData(
            req_id,
            contract,
            end_datetime,
            duration_str,
            bar_size_setting,
            what_to_show,
            int(use_rth),
            1,
            False,
            [],
        )
        if not state.event.wait(timeout_seconds):
            self._historical_states.pop(req_id, None)
            raise TimeoutError(f"Timed out waiting for historical bars for {contract.symbol}.")
        self._historical_states.pop(req_id, None)
        if state.errors and not state.bars:
            raise RuntimeError(f"IBKR historical data error for {contract.symbol}: {'; '.join(state.errors)}")
        return state.bars

    def request_snapshots(
        self,
        contracts: Sequence[Contract],
        generic_ticks: str,
        snapshot_timeout_seconds: float,
        batch_size: int,
        batch_pause_seconds: float,
    ) -> list[dict[str, Any]]:
        snapshots: list[dict[str, Any]] = []
        for batch in _batched(list(contracts), batch_size):
            req_ids: list[int] = []
            for contract in batch:
                req_id = self._allocate_request_id()
                state = _SnapshotState(
                    contract=contract,
                    data={
                        "symbol": contract.symbol,
                        "expiration": contract.lastTradeDateOrContractMonth,
                        "option_type": "call" if contract.right == "C" else "put",
                        "strike": float(contract.strike),
                    },
                )
                self._snapshot_states[req_id] = state
                req_ids.append(req_id)
                self.reqMktData(req_id, contract, generic_ticks, True, False, [])

            for req_id in req_ids:
                state = self._snapshot_states[req_id]
                state.event.wait(snapshot_timeout_seconds)
                try:
                    self.cancelMktData(req_id)
                except Exception:  # pragma: no cover - defensive cleanup
                    pass
                snapshots.append(dict(state.data))
                self._snapshot_states.pop(req_id, None)

            if batch_pause_seconds > 0:
                time.sleep(batch_pause_seconds)
        return snapshots

    def _allocate_request_id(self) -> int:
        with self._lock:
            req_id = self._next_request_id
            self._next_request_id += 1
        return req_id


class InteractiveBrokersOptionsProvider(OptionsChainProvider):
    """Current options-chain snapshots from Interactive Brokers TWS or IB Gateway."""

    name = "ibkr"

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 7497,
        client_id: int = 1,
        readonly: bool = True,
        use_client_portal: bool = False,
        account_id: str | None = None,
        market_data_type: int = 1,
        underlying_exchange: str = "SMART",
        option_exchange: str = "SMART",
        currency: str = "USD",
        min_dte: int = 7,
        max_dte: int = 60,
        max_expirations: int = 6,
        moneyness_pct: float = 0.20,
        max_strikes_per_expiry: int = 18,
        max_contracts_per_ticker: int = 120,
        connect_timeout_seconds: float = 10.0,
        request_timeout_seconds: float = 10.0,
        snapshot_timeout_seconds: float = 8.0,
        snapshot_batch_size: int = 25,
        batch_pause_seconds: float = 0.25,
    ) -> None:
        self.host = host
        self.port = int(port)
        self.client_id = int(client_id)
        self.readonly = readonly
        self.use_client_portal = use_client_portal
        self.account_id = account_id or None
        self.market_data_type = int(market_data_type)
        self.underlying_exchange = underlying_exchange
        self.option_exchange = option_exchange
        self.currency = currency
        self.min_dte = int(min_dte)
        self.max_dte = int(max_dte)
        self.max_expirations = int(max_expirations)
        self.moneyness_pct = float(moneyness_pct)
        self.max_strikes_per_expiry = int(max_strikes_per_expiry)
        self.max_contracts_per_ticker = int(max_contracts_per_ticker)
        self.connect_timeout_seconds = float(connect_timeout_seconds)
        self.request_timeout_seconds = float(request_timeout_seconds)
        self.snapshot_timeout_seconds = float(snapshot_timeout_seconds)
        self.snapshot_batch_size = int(snapshot_batch_size)
        self.batch_pause_seconds = float(batch_pause_seconds)

    def get_options_chain(self, tickers: Sequence[str], as_of_date: date) -> pd.DataFrame:
        if as_of_date != date.today():
            LOGGER.warning(
                "IBKR does not provide historical point-in-time option chains via this adapter. Requested %s; fetching the latest available live snapshot instead.",
                as_of_date.isoformat(),
            )

        client = _IBKRApiClient(
            host=self.host,
            port=self.port,
            client_id=self.client_id,
            market_data_type=self.market_data_type,
            connect_timeout_seconds=self.connect_timeout_seconds,
        )
        client.connect_and_start()
        try:
            rows: list[dict[str, Any]] = []
            for ticker in tickers:
                rows.extend(self._fetch_ticker_chain(client, ticker.upper(), as_of_date))
            return pd.DataFrame(rows)
        finally:
            client.close()

    def _fetch_ticker_chain(self, client: _IBKRApiClient, ticker: str, as_of_date: date) -> list[dict[str, Any]]:
        LOGGER.info("Fetching IBKR option chain for %s", ticker)
        underlying_contract = self._resolve_underlying_contract(client, ticker)
        underlying_snapshot = client.request_snapshots(
            [underlying_contract],
            UNDERLYING_SNAPSHOT_TICKS,
            self.snapshot_timeout_seconds,
            batch_size=1,
            batch_pause_seconds=0.0,
        )[0]
        underlying_price = _best_underlying_price(underlying_snapshot)
        if not _is_finite_positive(underlying_price):
            raise RuntimeError(
                f"Could not determine an underlying price for {ticker} from IBKR market data. Check that TWS/IB Gateway is running and the symbol has market data permissions."
            )

        option_definitions = client.request_option_parameters(
            ticker,
            underlying_contract.secType,
            underlying_contract.conId,
            timeout_seconds=self.request_timeout_seconds,
        )
        selected_definition = _select_option_definition(option_definitions, self.option_exchange)
        expiration_strings = _select_expirations(
            selected_definition["expirations"],
            as_of_date,
            min_dte=self.min_dte,
            max_dte=self.max_dte,
            max_expirations=self.max_expirations,
        )
        strikes = _select_strikes(
            selected_definition["strikes"],
            underlying_price,
            moneyness_pct=self.moneyness_pct,
            max_strikes=self.max_strikes_per_expiry,
        )
        contracts = self._build_option_contracts(
            ticker=ticker,
            multiplier=selected_definition["multiplier"],
            trading_class=selected_definition["trading_class"],
            expirations=expiration_strings,
            strikes=strikes,
        )
        contracts.sort(
            key=lambda contract: (contract.lastTradeDateOrContractMonth, abs(float(contract.strike) - underlying_price), contract.right)
        )
        if self.max_contracts_per_ticker > 0:
            contracts = contracts[: self.max_contracts_per_ticker]

        snapshots = client.request_snapshots(
            contracts,
            GENERIC_OPTION_TICKS,
            self.snapshot_timeout_seconds,
            batch_size=self.snapshot_batch_size,
            batch_pause_seconds=self.batch_pause_seconds,
        )
        rows: list[dict[str, Any]] = []
        for snapshot in snapshots:
            expiration = _parse_ibkr_expiration(snapshot.get("expiration"))
            if expiration is None:
                continue
            bid = _numeric_or_none(snapshot.get("bid"))
            ask = _numeric_or_none(snapshot.get("ask"))
            mark = _numeric_or_none(snapshot.get("mark"))
            mid = _midpoint(bid, ask) if bid is not None and ask is not None else mark
            volume = _int_or_default(snapshot.get("volume"), 0)
            open_interest = _int_or_default(snapshot.get("open_interest"), 0)
            implied_vol = _numeric_or_none(snapshot.get("implied_vol"))
            delta = _numeric_or_none(snapshot.get("delta"))

            rows.append(
                {
                    "ticker": ticker,
                    "as_of_date": as_of_date.isoformat(),
                    "expiration": expiration.isoformat(),
                    "dte": max((expiration - as_of_date).days, 0),
                    "option_type": snapshot.get("option_type"),
                    "strike": snapshot.get("strike"),
                    "bid": bid,
                    "ask": ask,
                    "mid": mid,
                    "mark": mark,
                    "volume": volume,
                    "open_interest": open_interest,
                    "implied_vol": implied_vol,
                    "delta": delta,
                    "underlying_price": _numeric_or_none(snapshot.get("underlying_price")) or underlying_price,
                }
            )
        return rows

    def _resolve_underlying_contract(self, client: _IBKRApiClient, ticker: str) -> Contract:
        contract = Contract()
        contract.symbol = ticker
        contract.secType = "STK"
        contract.exchange = self.underlying_exchange
        contract.currency = self.currency
        details = client.request_contract_details(contract, timeout_seconds=self.request_timeout_seconds)
        if not details:
            raise RuntimeError(f"IBKR could not resolve underlying contract details for {ticker}.")
        return details[0].contract

    def _build_option_contracts(
        self,
        ticker: str,
        multiplier: str,
        trading_class: str,
        expirations: Sequence[str],
        strikes: Sequence[float],
    ) -> list[Contract]:
        contracts: list[Contract] = []
        for expiration in expirations:
            for strike in strikes:
                for right in ("C", "P"):
                    contract = Contract()
                    contract.symbol = ticker
                    contract.secType = "OPT"
                    contract.exchange = self.option_exchange
                    contract.currency = self.currency
                    contract.lastTradeDateOrContractMonth = expiration
                    contract.strike = float(strike)
                    contract.right = right
                    contract.multiplier = multiplier or "100"
                    contract.tradingClass = trading_class
                    contracts.append(contract)
        return contracts


class InteractiveBrokersPriceProvider(PriceDataProvider):
    """Daily OHLCV history from Interactive Brokers TWS or IB Gateway."""

    name = "ibkr"

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 7497,
        client_id: int = 11,
        market_data_type: int = 1,
        exchange: str = "SMART",
        currency: str = "USD",
        what_to_show: str = "TRADES",
        use_rth: bool = True,
        connect_timeout_seconds: float = 10.0,
        request_timeout_seconds: float = 15.0,
    ) -> None:
        self.host = host
        self.port = int(port)
        self.client_id = int(client_id)
        self.market_data_type = int(market_data_type)
        self.exchange = exchange
        self.currency = currency
        self.what_to_show = what_to_show
        self.use_rth = bool(use_rth)
        self.connect_timeout_seconds = float(connect_timeout_seconds)
        self.request_timeout_seconds = float(request_timeout_seconds)

    def get_prices(self, tickers: Sequence[str], start_date: date, end_date: date) -> pd.DataFrame:
        client = _IBKRApiClient(
            host=self.host,
            port=self.port,
            client_id=self.client_id,
            market_data_type=self.market_data_type,
            connect_timeout_seconds=self.connect_timeout_seconds,
        )
        client.connect_and_start()
        try:
            frames: list[pd.DataFrame] = []
            duration_days = max((end_date - start_date).days + 10, 30)
            duration_str = f"{duration_days} D"
            for ticker in tickers:
                contract = Contract()
                contract.symbol = ticker.upper()
                contract.secType = "STK"
                contract.exchange = self.exchange
                contract.currency = self.currency
                details = client.request_contract_details(contract, timeout_seconds=self.request_timeout_seconds)
                if not details:
                    LOGGER.warning("Skipping %s because IBKR could not resolve the underlying contract.", ticker)
                    continue
                bars = client.request_historical_bars(
                    details[0].contract,
                    end_date=end_date,
                    duration_str=duration_str,
                    bar_size_setting="1 day",
                    what_to_show=self.what_to_show,
                    use_rth=self.use_rth,
                    timeout_seconds=self.request_timeout_seconds,
                )
                if not bars:
                    LOGGER.warning("Skipping %s because IBKR returned no daily history.", ticker)
                    continue
                frame = pd.DataFrame(bars)
                frame["date"] = pd.to_datetime(frame["date"], format="%Y%m%d", errors="coerce").dt.date
                frame = frame[frame["date"].between(start_date, end_date)]
                frame["ticker"] = ticker.upper()
                frames.append(frame[["ticker", "date", "open", "high", "low", "close", "volume"]])
            if not frames:
                return pd.DataFrame(columns=["ticker", "date", "open", "high", "low", "close", "volume"])
            return pd.concat(frames, ignore_index=True)
        finally:
            client.close()


def _select_option_definition(definitions: Sequence[dict[str, Any]], preferred_exchange: str) -> dict[str, Any]:
    if not definitions:
        raise RuntimeError("IBKR returned no option definitions for the underlying.")
    preferred = [definition for definition in definitions if definition.get("exchange") == preferred_exchange]
    candidates = preferred or list(definitions)
    return max(candidates, key=lambda definition: len(definition.get("expirations", [])))


def _select_expirations(
    expirations: Sequence[str],
    as_of_date: date,
    min_dte: int,
    max_dte: int,
    max_expirations: int,
) -> list[str]:
    parsed: list[tuple[date, str]] = []
    for expiration_string in expirations:
        expiration = _parse_ibkr_expiration(expiration_string)
        if expiration is None:
            continue
        dte = (expiration - as_of_date).days
        if dte <= 0:
            continue
        if min_dte <= dte <= max_dte:
            parsed.append((expiration, expiration_string))
    if not parsed:
        for expiration_string in expirations:
            expiration = _parse_ibkr_expiration(expiration_string)
            if expiration is None:
                continue
            dte = (expiration - as_of_date).days
            if dte > 0:
                parsed.append((expiration, expiration_string))
        parsed.sort(key=lambda item: item[0])
        return [item[1] for item in parsed[:max_expirations]]
    parsed.sort(key=lambda item: item[0])
    return [item[1] for item in parsed[:max_expirations]]


def _select_strikes(strikes: Sequence[float], spot: float, moneyness_pct: float, max_strikes: int) -> list[float]:
    if not strikes:
        raise RuntimeError("IBKR returned no option strikes for the underlying.")
    lower = spot * (1.0 - moneyness_pct)
    upper = spot * (1.0 + moneyness_pct)
    filtered = [float(strike) for strike in strikes if lower <= float(strike) <= upper]
    candidates = filtered or [float(strike) for strike in strikes]
    candidates.sort(key=lambda strike: abs(strike - spot))
    selected = candidates[:max_strikes]
    return sorted(set(selected))


def _best_underlying_price(snapshot: dict[str, Any]) -> float | None:
    bid = _numeric_or_none(snapshot.get("bid"))
    ask = _numeric_or_none(snapshot.get("ask"))
    last = _numeric_or_none(snapshot.get("last"))
    mark = _numeric_or_none(snapshot.get("mark"))
    close = _numeric_or_none(snapshot.get("close"))

    midpoint = _midpoint(bid, ask)
    for candidate in (mark, midpoint, last, close):
        if _is_finite_positive(candidate):
            return float(candidate)
    return None


def _parse_ibkr_expiration(raw: Any) -> date | None:
    if raw is None:
        return None
    raw_text = str(raw)
    try:
        if len(raw_text) >= 8:
            return datetime.strptime(raw_text[:8], "%Y%m%d").date()
    except ValueError:
        return None
    return None


def _batched(items: list[Any], size: int) -> list[list[Any]]:
    if size <= 0:
        return [items]
    return [items[index : index + size] for index in range(0, len(items), size)]


def _midpoint(bid: float | None, ask: float | None) -> float | None:
    if bid is None or ask is None:
        return None
    if bid <= 0 or ask <= 0:
        return None
    return (bid + ask) / 2.0


def _numeric_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(parsed):
        return None
    return parsed


def _int_or_default(value: Any, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed


def _is_finite_positive(value: Any) -> bool:
    numeric = _numeric_or_none(value)
    return numeric is not None and numeric > 0


def _is_finite_number(value: Any) -> bool:
    return _numeric_or_none(value) is not None
