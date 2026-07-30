from __future__ import annotations

from investing_platform.models import AccountSourceMetrics


def test_common_account_source_contract_exposes_required_dashboard_metrics() -> None:
    summary = AccountSourceMetrics(
        totalPnl=10.0,
        todayPnl=2.0,
        monthlyPnl=5.0,
        totalPnlPctBasis=100.0,
        todayPnlPctBasis=105.0,
        monthlyPnlPctBasis=100.0,
        netWorth=110.0,
        netContributions=100.0,
    )

    assert summary.coverage == "complete"
    assert summary.missingMetrics == []
    assert set(summary.model_dump()) == {
        "totalPnl",
        "todayPnl",
        "monthlyPnl",
        "totalPnlPctBasis",
        "todayPnlPctBasis",
        "monthlyPnlPctBasis",
        "netWorth",
        "netContributions",
        "missingMetrics",
        "coverage",
    }


def test_common_account_source_contract_makes_omitted_metrics_explicit() -> None:
    summary = AccountSourceMetrics(netWorth=110.0)

    assert summary.coverage == "partial"
    assert summary.missingMetrics == [
        "totalPnl",
        "todayPnl",
        "monthlyPnl",
        "netContributions",
    ]
