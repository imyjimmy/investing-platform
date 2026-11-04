from __future__ import annotations

from datetime import UTC, datetime
import pytest
from investing_platform.config import DashboardSettings
from investing_platform.services.coinbase import CoinbaseService, ResolvedCoinbaseCredentials
from investing_platform.services.coinbase import _external_cash_flow_amount_usd


def test_external_bank_funded_buy_counts_as_contribution() -> None:
    amount, skipped = _external_cash_flow_amount_usd(
        {
            "status": "completed",
            "type": "buy",
            "native_amount": {"amount": "12000.00", "currency": "USD"},
            "buy": {"payment_method_name": "Linked business checking"},
        }
    )

    assert amount == 12000.0
    assert skipped is False


def test_wallet_funded_buy_is_not_an_external_contribution() -> None:
    amount, skipped = _external_cash_flow_amount_usd(
        {
            "status": "completed",
            "type": "buy",
            "native_amount": {"amount": "12000.00", "currency": "USD"},
            "buy": {"payment_method_name": "USDC Wallet"},
        }
    )

    assert amount is None
    assert skipped is False


def test_external_bank_sale_counts_as_withdrawal() -> None:
    amount, skipped = _external_cash_flow_amount_usd(
        {
            "status": "completed",
            "type": "sell",
            "native_amount": {"amount": "2500.00", "currency": "USD"},
            "sell": {"payment_method_name": "Linked business checking"},
        }
    )

    assert amount == -2500.0
    assert skipped is False




@pytest.mark.parametrize("month", [1, 2, 4, 5, 7, 8, 10, 11])
def test_quarterly_coinbase_pnl_uses_calendar_boundary_prices_and_cash_flows(monkeypatch, month):
    from investing_platform.services import coinbase

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, month, 15, 12, tzinfo=UTC)

    monkeypatch.setattr(coinbase, "datetime", Clock)
    service = CoinbaseService(DashboardSettings())
    quarter_month = ((month - 1) // 3) * 3 + 1
    boundaries = []
    def transactions(**kwargs):
        boundaries.append(kwargs["created_after"])
        return [{"status": "completed", "type": "buy", "amount": {"amount": "1", "currency": "BTC"},
                 "native_amount": {"amount": "100", "currency": "USD"},
                 "buy": {"payment_method_name": "Bank"}}]
    monkeypatch.setattr(service, "_list_track_account_transactions", transactions)
    monkeypatch.setattr(service, "_lookup_historic_usd_price", lambda **kwargs: 100 if kwargs["as_of"].month == quarter_month else 125)
    result = service._derive_period_pnl_from_accounts(
        [{"id": "wallet"}], ResolvedCoinbaseCredentials("bearer", "test"), {"BTC": 3}, set(), 450,
    )
    assert result.quarterly_pnl == 150  # 450 - (2 BTC * 100 opening price) - 100 contribution
    assert result.quarterly_pnl_pct_basis == 200
    assert datetime(2026, quarter_month, 1, tzinfo=UTC) in boundaries
    assert len(boundaries) == (2 if month == quarter_month else 3)


def test_quarter_history_failure_preserves_day_and_month_pnl(monkeypatch):
    from investing_platform.services import coinbase

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2026, 11, 15, 12, tzinfo=UTC)

    monkeypatch.setattr(coinbase, "datetime", Clock)
    service = CoinbaseService(DashboardSettings())
    def calculate(**kwargs):
        if kwargs["period_start"].month == 10:
            raise RuntimeError("history temporarily unavailable")
        return 25, 1000, None
    monkeypatch.setattr(service, "_calculate_period_pnl", calculate)
    result = service._derive_period_pnl_from_accounts([], ResolvedCoinbaseCredentials("bearer", "test"), {}, set(), 1025)
    assert result.today_pnl == result.monthly_pnl == 25
    assert result.quarterly_pnl is None
    assert result.quarterly_pnl_pct_basis is None
    assert any("Quarter PnL:" in notice for notice in result.notices)
