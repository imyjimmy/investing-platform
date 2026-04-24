"""Market option chain helpers shared across API routes."""

from __future__ import annotations

from investing_platform.models import OptionChainResponse, OptionContractQuoteResponse
from investing_platform.services.base import BrokerService


def get_option_chain(
    broker: BrokerService,
    symbol: str,
    *,
    expiry: str | None = None,
    strike_limit: int | None = None,
    lower_moneyness_pct: float | None = None,
    upper_moneyness_pct: float | None = None,
    min_moneyness_pct: float | None = None,
    max_moneyness_pct: float | None = None,
) -> OptionChainResponse:
    return broker.get_option_chain(
        symbol,
        expiry=expiry,
        strike_limit=strike_limit,
        lower_moneyness_pct=lower_moneyness_pct,
        upper_moneyness_pct=upper_moneyness_pct,
        min_moneyness_pct=min_moneyness_pct,
        max_moneyness_pct=max_moneyness_pct,
    )


def get_option_contract_quote(
    broker: BrokerService,
    symbol: str,
    *,
    expiry: str,
    strike: float,
    right: str,
) -> OptionContractQuoteResponse:
    chain = get_option_chain(broker, symbol, expiry=expiry)
    right_code = right.upper()
    side_prefix = "call" if right_code == "C" else "put"

    for row in chain.rows:
        if abs(float(row.strike) - float(strike)) > 1e-6:
            continue
        return OptionContractQuoteResponse(
            symbol=symbol.upper(),
            expiry=chain.selectedExpiry,
            strike=float(strike),
            right=right_code,
            bid=getattr(row, f"{side_prefix}Bid"),
            ask=getattr(row, f"{side_prefix}Ask"),
            mid=getattr(row, f"{side_prefix}Mid"),
            iv=getattr(row, f"{side_prefix}IV"),
            delta=getattr(row, f"{side_prefix}Delta"),
            theta=getattr(row, f"{side_prefix}Theta"),
            generatedAt=chain.generatedAt,
            isStale=chain.isStale,
        )

    raise ValueError("Requested option contract was not found in the selected chain snapshot.")
