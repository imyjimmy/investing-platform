from __future__ import annotations

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
