"""Order and option-strategy helper functions for the IB Gateway adapter."""

from __future__ import annotations

from typing import Any, Literal, cast

from investing_platform.models import ChainRow, OptionOrderLegRequest, OptionOrderRequest, StockOrderRequest
from investing_platform.services.ib_gateway_chain_helpers import *
from investing_platform.services.ib_gateway_models import _ResolvedOptionLeg, _StrategyPermissionProbe
from investing_platform.services.ib_gateway_quote_helpers import *

def _strategy_tag(right: str, quantity: int, covered_contracts: int) -> str:
    if right == "C" and quantity < 0:
        return "covered-call" if covered_contracts >= abs(quantity) else "short-option"
    if right == "P" and quantity < 0:
        return "cash-secured-put"
    if quantity > 0:
        return "long-option"
    return "other"


def _order_open_or_close(
    contract: Any,
    side: str,
    quantity: float,
    stock_qty: dict[str, float],
    option_qty: dict[tuple[str, str, str, float], int],
) -> str:
    if contract.secType == "OPT":
        key = (
            contract.symbol,
            contract.right,
            _normalize_expiry(contract.lastTradeDateOrContractMonth),
            round(float(contract.strike), 2),
        )
        existing_qty = option_qty.get(key, 0)
        if side == "BUY" and existing_qty < 0:
            return "closing"
        if side == "SELL" and existing_qty > 0:
            return "closing"
        return "opening"
    existing_stock = stock_qty.get(contract.symbol, 0.0)
    if side == "SELL" and existing_stock > 0:
        return "closing"
    return "opening"


def _request_open_or_close(
    request: OptionOrderRequest,
    resolved_legs: list[_ResolvedOptionLeg],
    stock_qty: dict[str, float],
    option_qty: dict[tuple[str, str, str, float], int],
) -> Literal["opening", "closing", "unknown"]:
    if len(resolved_legs) == 1:
        return cast(Literal["opening", "closing", "unknown"], _order_open_or_close(resolved_legs[0].contract, request.action, float(request.quantity), stock_qty, option_qty))
    leg_states = {
        _order_open_or_close(
            resolved_leg.contract,
            resolved_leg.request_leg.action,
            float(request.quantity * resolved_leg.request_leg.ratio),
            stock_qty,
            option_qty,
        )
        for resolved_leg in resolved_legs
    }
    if len(leg_states) == 1:
        return cast(Literal["opening", "closing", "unknown"], next(iter(leg_states)))
    return "unknown"


def _aggregate_leg_reference_price(resolved_legs: list[_ResolvedOptionLeg]) -> float | None:
    total = 0.0
    has_price = False
    for resolved_leg in resolved_legs:
        if not _is_valid_number(resolved_leg.market_reference_price):
            continue
        leg_sign = 1.0 if resolved_leg.request_leg.action == "SELL" else -1.0
        total += float(resolved_leg.market_reference_price) * leg_sign * resolved_leg.request_leg.ratio
        has_price = True
    if not has_price:
        return None
    return round(total, 4)


def _strategy_payoff_bounds(
    request: OptionOrderRequest,
    opening_or_closing: str,
) -> tuple[float | None, float | None]:
    if opening_or_closing != "opening":
        return None, None
    metrics = _vertical_spread_metrics(request)
    if metrics is None:
        return None, None
    width_dollars, net_limit_dollars = metrics
    if request.action == "SELL":
        max_profit = net_limit_dollars
        max_loss = max(width_dollars - net_limit_dollars, 0.0)
        return round(max_profit, 2), round(max_loss, 2)
    max_profit = max(width_dollars - net_limit_dollars, 0.0)
    max_loss = max(net_limit_dollars, 0.0)
    return round(max_profit, 2), round(max_loss, 2)


def _vertical_spread_metrics(request: OptionOrderRequest) -> tuple[float, float] | None:
    resolved_legs = request.resolved_legs()
    if len(resolved_legs) != 2 or request.limitPrice is None:
        return None
    expiries = {leg.expiry for leg in resolved_legs}
    rights = {leg.right for leg in resolved_legs}
    actions = {leg.action for leg in resolved_legs}
    if len(expiries) != 1 or len(rights) != 1 or actions != {"BUY", "SELL"}:
        return None
    strikes = sorted(leg.strike for leg in resolved_legs)
    width = abs(strikes[1] - strikes[0]) * 100.0 * request.quantity
    net_limit = abs(float(request.limitPrice)) * 100.0 * request.quantity
    return width, net_limit


def _strategy_tag_from_order_ref(order_ref: Any) -> str | None:
    if order_ref is None:
        return None
    raw = str(order_ref).strip()
    if not raw.startswith("options-dashboard:paper:"):
        return None
    parts = raw.split(":")
    if len(parts) < 8 or not parts[-1].endswith("legs"):
        return None
    return parts[4] or None


def _strategy_permission_from_preview(
    warning_text: str | None,
    note: str | None,
) -> tuple[Literal["permitted", "blocked", "unknown"], str]:
    combined = " ".join(part.strip() for part in [warning_text or "", note or ""] if part and part.strip())
    lowered = combined.lower()
    blocked_markers = (
        "not allowed",
        "not approved",
        "not permitted",
        "no trading permission",
        "trading permission",
        "permission",
        "account is not eligible",
        "not available for this account",
    )
    if any(marker in lowered for marker in blocked_markers):
        return "blocked", combined or "Blocked by IBKR account permissions."
    if combined:
        return "permitted", combined
    return "permitted", "Permitted by IBKR what-if preview."


def _strategy_permission_from_error(detail: str) -> tuple[Literal["permitted", "blocked", "unknown"], str]:
    lowered = detail.lower()
    blocked_markers = (
        "not allowed",
        "not approved",
        "not permitted",
        "no trading permission",
        "trading permission",
        "permission",
        "limited option",
    )
    if any(marker in lowered for marker in blocked_markers):
        return "blocked", detail
    return "unknown", detail


def _build_strategy_permission_probes(
    chain: OptionChainResponse,
    *,
    stock_shares: int,
) -> list[_StrategyPermissionProbe]:
    rows = sorted(chain.rows, key=lambda row: row.strike)
    spot = float(chain.underlying.price) if _is_valid_number(chain.underlying.price) else None
    call_rows = [row for row in rows if row.callBid is not None or row.callAsk is not None or row.callMid is not None]
    put_rows = [row for row in rows if row.putBid is not None or row.putAsk is not None or row.putMid is not None]
    rows_above_spot = [row for row in rows if spot is not None and row.strike > spot]
    rows_below_spot = [row for row in rows if spot is not None and row.strike < spot]
    shared_rows = [
        row
        for row in rows
        if (row.callBid is not None or row.callAsk is not None or row.callMid is not None)
        and (row.putBid is not None or row.putAsk is not None or row.putMid is not None)
    ]
    later_expiry = next((candidate for candidate in sorted(chain.expiries) if candidate > chain.selectedExpiry), None)

    def pick_nearest(candidates: list[ChainRow], target: float | None) -> ChainRow | None:
        if not candidates:
            return None
        if target is None:
            return candidates[0]
        return min(candidates, key=lambda row: abs(row.strike - target))

    def pick_next_higher(candidates: list[ChainRow], strike: float) -> ChainRow | None:
        return next((row for row in candidates if row.strike > strike), None)

    def pick_next_lower(candidates: list[ChainRow], strike: float) -> ChainRow | None:
        lower = [row for row in candidates if row.strike < strike]
        return lower[-1] if lower else None

    def butterfly_triplet(candidates: list[ChainRow], target: float | None) -> tuple[ChainRow, ChainRow, ChainRow] | None:
        if len(candidates) < 3:
            return None
        middle = pick_nearest(candidates[1:-1], target) if len(candidates) > 2 else None
        if middle is None:
            return None
        lower = pick_next_lower(candidates, middle.strike)
        upper = pick_next_higher(candidates, middle.strike)
        if lower is None or upper is None:
            return None
        return lower, middle, upper

    def condor_quartet(candidates: list[ChainRow], target: float | None) -> tuple[ChainRow, ChainRow, ChainRow, ChainRow] | None:
        if len(candidates) < 4:
            return None
        anchor = pick_nearest(candidates, target)
        if anchor is None:
            return None
        index = candidates.index(anchor)
        low_index = max(min(index - 1, len(candidates) - 4), 0)
        quartet = candidates[low_index : low_index + 4]
        return tuple(quartet) if len(quartet) == 4 else None

    def leg(row: ChainRow, right: Literal["C", "P"], action: Literal["BUY", "SELL"], *, expiry: str | None = None, ratio: int = 1) -> OptionOrderLegRequest:
        return OptionOrderLegRequest(
            expiry=expiry or chain.selectedExpiry,
            strike=row.strike,
            right=right,
            action=action,
            ratio=ratio,
        )

    def make_request(
        label: str,
        strategy_tag: str,
        action: Literal["BUY", "SELL"],
        legs: list[OptionOrderLegRequest] | None,
        unavailable_detail: str,
    ) -> _StrategyPermissionProbe:
        if not legs:
            return _StrategyPermissionProbe(strategy_key=strategy_tag.replace("-spread", "").replace("-option", "-option"), label=label, request=None, unavailable_detail=unavailable_detail)
        primary = legs[0]
        return _StrategyPermissionProbe(
            strategy_key=_strategy_family_key_for_tag(strategy_tag),
            label=label,
            request=OptionOrderRequest(
                accountId="PENDING",
                symbol=chain.symbol,
                expiry=primary.expiry,
                strike=primary.strike,
                right=primary.right,
                action=action,
                quantity=1,
                orderType="MKT",
                tif="DAY",
                strategyTag=cast(Any, strategy_tag),
                structureLabel=label,
                legs=legs,
            ),
        )

    atm_row = pick_nearest(shared_rows, spot)
    long_call = pick_nearest(call_rows, spot)
    long_put = pick_nearest(put_rows, spot)
    short_call = pick_nearest(rows_above_spot or call_rows, spot)
    short_put = pick_nearest(list(reversed(rows_below_spot)) or put_rows, spot)
    call_spread_long = short_call
    call_spread_short = pick_next_higher(call_rows, call_spread_long.strike) if call_spread_long is not None else None
    put_credit_short = short_put
    put_credit_long = pick_next_lower(put_rows, put_credit_short.strike) if put_credit_short is not None else None
    call_bfly = butterfly_triplet(call_rows, spot)
    call_condor = condor_quartet(call_rows, spot)
    iron_center = atm_row
    iron_lower = pick_next_lower(put_rows, iron_center.strike) if iron_center is not None else None
    iron_upper = pick_next_higher(call_rows, iron_center.strike) if iron_center is not None else None

    probes: list[_StrategyPermissionProbe] = [
        make_request(
            "Single Option",
            "long-option",
            "BUY",
            [leg(long_call, "C", "BUY")] if long_call is not None else None,
            "No liquid call was available to test this strategy.",
        ),
        make_request(
            "Covered Option",
            "cash-secured-put",
            "SELL",
            [leg(put_credit_short, "P", "SELL")] if put_credit_short is not None else None,
            "No liquid put was available to test this strategy.",
        ),
        make_request(
            "Straddle",
            "straddle",
            "BUY",
            [leg(atm_row, "C", "BUY"), leg(atm_row, "P", "BUY")] if atm_row is not None else None,
            "No at-the-money call/put pair was available to test this strategy.",
        ),
        make_request(
            "Strangle",
            "strangle",
            "BUY",
            [leg(short_put, "P", "BUY"), leg(short_call, "C", "BUY")] if short_put is not None and short_call is not None else None,
            "No out-of-the-money put/call pair was available to test this strategy.",
        ),
        make_request(
            "Vertical",
            "call-debit-spread",
            "BUY",
            [leg(call_spread_long, "C", "BUY"), leg(call_spread_short, "C", "SELL")]
            if call_spread_long is not None and call_spread_short is not None
            else None,
            "No two call strikes were available to test this strategy.",
        ),
        make_request(
            "Butterfly",
            "butterfly",
            "BUY",
            [leg(call_bfly[0], "C", "BUY"), leg(call_bfly[1], "C", "SELL", ratio=2), leg(call_bfly[2], "C", "BUY")] if call_bfly is not None else None,
            "No three-strike call butterfly was available to test this strategy.",
        ),
        make_request(
            "Condor",
            "condor",
            "BUY",
            [leg(call_condor[0], "C", "BUY"), leg(call_condor[1], "C", "SELL"), leg(call_condor[2], "C", "SELL"), leg(call_condor[3], "C", "BUY")]
            if call_condor is not None
            else None,
            "No four-strike call condor was available to test this strategy.",
        ),
    ]

    if stock_shares >= 100 and short_call is not None and short_put is not None:
        collar_legs = [leg(short_put, "P", "BUY"), leg(short_call, "C", "SELL")]
        probes.append(make_request("Collar (with stock)", "collar", "BUY", collar_legs, ""))
    else:
        probes.append(
            _StrategyPermissionProbe(
                strategy_key="collar",
                label="Collar (with stock)",
                request=None,
                unavailable_detail="No 100-share stock position was available in this symbol to test a collar.",
            )
        )

    probes.extend(
        [
            make_request(
                "Iron Butterfly",
                "iron-butterfly",
                "SELL",
                [leg(iron_lower, "P", "BUY"), leg(iron_center, "P", "SELL"), leg(iron_center, "C", "SELL"), leg(iron_upper, "C", "BUY")]
                if iron_center is not None and iron_lower is not None and iron_upper is not None
                else None,
                "No iron butterfly wings were available to test this strategy.",
            ),
            make_request(
                "Iron Condor",
                "iron-condor",
                "SELL",
                [leg(put_credit_long, "P", "BUY"), leg(put_credit_short, "P", "SELL"), leg(short_call, "C", "SELL"), leg(call_spread_short, "C", "BUY")]
                if put_credit_long is not None and put_credit_short is not None and short_call is not None and call_spread_short is not None
                else None,
                "No iron condor structure was available to test this strategy.",
            ),
            make_request(
                "Calendar",
                "calendar-spread",
                "BUY",
                [leg(long_call, "C", "BUY", expiry=later_expiry), leg(long_call, "C", "SELL")]
                if long_call is not None and later_expiry is not None
                else None,
                "No later expiration was available to test this strategy.",
            ),
            make_request(
                "Diagonal",
                "diagonal-spread",
                "BUY",
                [leg(call_spread_long, "C", "BUY", expiry=later_expiry), leg(call_spread_short, "C", "SELL")]
                if call_spread_long is not None and call_spread_short is not None and later_expiry is not None
                else None,
                "No later expiration and strike pair was available to test this strategy.",
            ),
            make_request(
                "Ratio",
                "ratio-spread",
                "BUY",
                [leg(call_spread_long, "C", "SELL"), leg(call_spread_short, "C", "BUY", ratio=2)]
                if call_spread_long is not None and call_spread_short is not None
                else None,
                "No ratio spread pair was available to test this strategy.",
            ),
        ]
    )
    return probes




__all__ = [name for name in globals() if ((name.startswith("_") and not name.startswith("__")) or name.isupper())]
