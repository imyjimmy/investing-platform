from __future__ import annotations

from dataclasses import dataclass

from investing_platform.services.ib_gateway_portfolio import _request_account_pnl


@dataclass
class FakePnl:
    dailyPnL: float
    unrealizedPnL: float
    realizedPnL: float


class FakeIb:
    def __init__(self) -> None:
        self.cancelled: list[tuple[str, str]] = []

    def reqPnL(self, account_id: str, model_code: str) -> FakePnl:
        assert account_id == "U-TEST"
        assert model_code == ""
        return FakePnl(dailyPnL=-125.5, unrealizedPnL=-500.0, realizedPnL=374.5)

    def cancelPnL(self, account_id: str, model_code: str) -> None:
        self.cancelled.append((account_id, model_code))

    def sleep(self, _: float) -> None:
        return


def test_account_pnl_subscription_returns_signed_values_and_is_cancelled() -> None:
    ib = FakeIb()

    values = _request_account_pnl(ib, "U-TEST")

    assert values == (-125.5, -500.0, 374.5)
    assert ib.cancelled == [("U-TEST", "")]
