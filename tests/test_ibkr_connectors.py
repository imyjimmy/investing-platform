from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from pathlib import Path
import time

import pytest

from investing_platform.config import DashboardSettings
from investing_platform.models import AccountSnapshot, ConnectionStatus, IbkrConnectorConfigRequest
from investing_platform.services.base import PortfolioSnapshot
from investing_platform.services.ibkr_connectors import IbkrConnectorService
from investing_platform.services.ibkr_flex import FlexCashFlowSummary


class FakeBroker:
    def __init__(self, accounts: list[str]) -> None:
        self.accounts = accounts
        self.reconnect_count = 0
        self._resolved_account_id: str | None = None

    def connection_status(self) -> ConnectionStatus:
        return ConnectionStatus(
            mode="ibkr",
            connected=True,
            status="connected",
            executionMode="disabled",
            routedAccountType="live",
            host="127.0.0.1",
            port=4001,
            clientId=17,
            accountId=self._resolved_account_id or self.accounts[0],
            managedAccounts=self.accounts,
            marketDataType=1,
            marketDataMode="LIVE",
            usingMockData=False,
            lastSuccessfulConnectAt=datetime.now(UTC),
            lastHeartbeatAt=datetime.now(UTC),
        )

    def reconnect(self) -> ConnectionStatus:
        self.reconnect_count += 1
        return self.connection_status()

    def get_portfolio_snapshot(self, account_id: str) -> PortfolioSnapshot:
        generated_at = datetime.now(UTC)
        return PortfolioSnapshot(
            account=AccountSnapshot(
                accountId=account_id,
                netLiquidation=23000.0,
                availableFunds=10000.0,
                excessLiquidity=10000.0,
                buyingPower=40000.0,
                initMarginReq=5000.0,
                maintMarginReq=4000.0,
                cashBalance=5000.0,
                todayPnl=100.0,
                unrealizedPnl=1500.0,
                realizedPnl=500.0,
                marginUsagePct=20.0,
                optionPositionsCount=0,
                openOrdersCount=0,
                estimatedPremiumExpiringThisWeek=0.0,
                estimatedCommittedCapital=0.0,
                estimatedFreeOptionSellingCapacity=5000.0,
                generatedAt=generated_at,
            ),
            positions=[],
            option_positions=[],
            open_orders=[],
            generated_at=generated_at,
        )


class FakeFlexClient:
    def fetch_cash_flows(self, *, token: str, query_id: str, account_id: str) -> FlexCashFlowSummary:
        assert token == "local-secret"
        assert query_id == "42"
        assert account_id == "U-FOUND"
        today = datetime.now(UTC).date()
        month_start = today.replace(day=1)
        previous_month_end = month_start - timedelta(days=1)
        return FlexCashFlowSummary(
            net_contributions=20000.0,
            transaction_count=1,
            period_start=date(2026, 1, 1),
            period_end=date(2026, 7, 10),
            generated_at=datetime.now(UTC),
            cash_flows_by_date={month_start: 1000.0},
            equity_by_date={previous_month_end: 20000.0, today - timedelta(days=1): 22900.0},
        )


def test_ibkr_connector_discovers_and_persists_account_assignment(tmp_path: Path) -> None:
    state_path = tmp_path / "connectors.json"
    settings = DashboardSettings(filesystem_connectors_state_file=state_path)
    broker = FakeBroker(["U-FOUND"])
    service = IbkrConnectorService(settings, broker)

    initial = service.status("van-aken")
    assert initial.status == "unconfigured"
    assert initial.discoveredAccounts == ["U-FOUND"]
    assert service.test("van-aken").status == "unconfigured"
    assert broker.reconnect_count == 1

    saved = service.configure(
        "van-aken",
        IbkrConnectorConfigRequest(
            displayName="IBKR",
            enabled=True,
            host="127.0.0.1",
            port=4001,
            clientId=17,
            readonly=True,
            accountId="u-found",
        ),
    )

    assert saved.status == "ready"
    assert saved.accountId == "U-FOUND"
    assert broker._resolved_account_id == "U-FOUND"
    assert "U-FOUND" in state_path.read_text(encoding="utf-8")
    assert IbkrConnectorService(settings, broker).status("van-aken").accountId == "U-FOUND"


def test_ibkr_assignments_are_account_scoped_and_validate_gateway_accounts(tmp_path: Path) -> None:
    settings = DashboardSettings(filesystem_connectors_state_file=tmp_path / "connectors.json")
    broker = FakeBroker(["U-ONE", "U-TWO"])
    service = IbkrConnectorService(settings, broker)

    for account_key, account_id in (("van-aken", "U-ONE"), ("personal", "U-TWO")):
        service.configure(
            account_key,
            IbkrConnectorConfigRequest(host="127.0.0.1", port=4001, clientId=17, accountId=account_id),
        )

    assert service.status("van-aken").enabled is True
    assert service.status("van-aken").accountId == "U-ONE"
    assert service.status("personal").enabled is True
    assert service.status("personal").accountId == "U-TWO"

    with pytest.raises(ValueError, match="not available"):
        service.configure(
            "van-aken",
            IbkrConnectorConfigRequest(host="127.0.0.1", port=4001, clientId=17, accountId="U-MISSING"),
        )


def test_ibkr_connector_syncs_flex_contributions_without_exposing_token(tmp_path: Path) -> None:
    state_path = tmp_path / "connectors.json"
    settings = DashboardSettings(filesystem_connectors_state_file=state_path)
    service = IbkrConnectorService(settings, FakeBroker(["U-FOUND"]), flex_client=FakeFlexClient())  # type: ignore[arg-type]

    service.configure(
        "van-aken",
        IbkrConnectorConfigRequest(
            accountId="U-FOUND",
            flexEnabled=True,
            flexToken="local-secret",
            flexQueryId="42",
        ),
    )

    deadline = time.monotonic() + 1.0
    status = service.status("van-aken")
    while status.flexStatus != "ready" and time.monotonic() < deadline:
        time.sleep(0.01)
        status = service.status("van-aken")

    assert status.flexStatus == "ready"
    assert status.flexTokenConfigured is True
    assert status.flexNetContributions == 20000.0
    assert status.flexCashTransactionsCount == 1
    assert status.flexPerformanceReady is True
    assert status.flexEquitySnapshotsCount == 2
    assert "local-secret" not in status.model_dump_json()
    assert state_path.stat().st_mode & 0o777 == 0o600

    service.configure(
        "van-aken",
        IbkrConnectorConfigRequest(accountId="U-FOUND", flexEnabled=True, flexQueryId="42"),
    )
    saved_state = state_path.read_text(encoding="utf-8")
    assert "local-secret" in saved_state
    assert '"flex_net_contributions": 20000.0' in saved_state


def test_ibkr_connected_source_fulfills_common_metric_contract(tmp_path: Path) -> None:
    settings = DashboardSettings(filesystem_connectors_state_file=tmp_path / "connectors.json")
    service = IbkrConnectorService(settings, FakeBroker(["U-FOUND"]), flex_client=FakeFlexClient())  # type: ignore[arg-type]
    service.configure(
        "van-aken",
        IbkrConnectorConfigRequest(
            accountId="U-FOUND",
            flexEnabled=True,
            flexToken="local-secret",
            flexQueryId="42",
        ),
    )

    deadline = time.monotonic() + 1.0
    status = service.status("van-aken")
    while status.flexStatus != "ready" and time.monotonic() < deadline:
        time.sleep(0.01)
        status = service.status("van-aken")

    portfolio = service.portfolio("van-aken")
    assert portfolio.summary.coverage == "complete"
    assert portfolio.summary.missingMetrics == []
    assert portfolio.summary.totalPnl == 3000.0
    assert portfolio.summary.todayPnl == 100.0
    assert portfolio.summary.monthlyPnl == 2000.0
    assert portfolio.summary.netWorth == 23000.0
    assert portfolio.summary.netContributions == 20000.0
    assert portfolio.summary.todayPnlPctBasis == 22900.0
    assert portfolio.summary.monthlyPnlPctBasis == 20000.0
