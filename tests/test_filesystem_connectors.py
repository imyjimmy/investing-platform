from __future__ import annotations

from datetime import date, datetime
import math
import os
from pathlib import Path

import pytest

from investing_platform.config import DashboardSettings
from investing_platform.models import FilesystemConnectorConfigRequest
from investing_platform.services.filesystem_connectors import CSV_FOLDER_CONNECTOR_ID, FilesystemConnectorService


def test_csv_folder_portfolio_calculates_flow_adjusted_sharpe(tmp_path: Path) -> None:
    positions_dir = tmp_path / "positions"
    positions_dir.mkdir()
    _write_snapshot(positions_dir / "Portfolio_Positions_May-01-2026.csv", 1000.0, modified_at=datetime(2026, 5, 1, 16))
    _write_snapshot(positions_dir / "Portfolio_Positions_May-02-2026.csv", 1150.0, modified_at=datetime(2026, 5, 2, 16))
    _write_snapshot(positions_dir / "Portfolio_Positions_May-03-2026.csv", 1173.0, modified_at=datetime(2026, 5, 3, 16))
    history_csv = tmp_path / "Portfolio_History_for_Account_123.csv"
    history_csv.write_text(
        "\n".join(
            [
                "Run Date,Action,Amount ($)",
                "05/02/2026,ELECTRONIC FUNDS TRANSFER RECEIVED,100",
            ]
        ),
        encoding="utf-8",
    )

    service = FilesystemConnectorService(DashboardSettings(filesystem_connectors_state_file=tmp_path / "connectors.json"))
    service.configure_connector(
        "taxable",
        CSV_FOLDER_CONNECTOR_ID,
        FilesystemConnectorConfigRequest(
            displayName="Fidelity taxable",
            positionsDirectoryPath=str(positions_dir),
            historyCsvPath=str(history_csv),
        ),
    )

    portfolio = service.get_portfolio("taxable", CSV_FOLDER_CONNECTOR_ID)
    daily_returns = [0.05, 0.02]
    expected_sharpe = round((_mean(daily_returns) / _sample_standard_deviation(daily_returns)) * math.sqrt(252), 2)

    assert portfolio.annualizedSharpeRatio == pytest.approx(expected_sharpe)
    assert portfolio.sharpeObservations == 2
    assert portfolio.sharpePeriodStart == date(2026, 5, 1)
    assert portfolio.sharpePeriodEnd == date(2026, 5, 3)
    assert portfolio.todayPnl == 23.0
    assert portfolio.monthlyPnl == 73.0
    assert portfolio.summary.coverage == "complete"
    assert portfolio.summary.missingMetrics == []
    assert portfolio.summary.todayPnl == portfolio.todayPnl
    assert portfolio.summary.monthlyPnl == portfolio.monthlyPnl
    assert portfolio.summary.netWorth == portfolio.totalValue
    assert portfolio.sourceNotice is not None
    assert "flow-adjusted daily snapshot return observations" in portfolio.sourceNotice


def test_csv_folder_extends_stale_history_from_significant_snapshot_cash_flow(tmp_path: Path) -> None:
    positions_dir = tmp_path / "positions"
    positions_dir.mkdir()
    _write_snapshot(
        positions_dir / "Portfolio_Positions_May-04-2026.csv",
        100_000.0,
        daily_pnl=0.0,
        modified_at=datetime(2026, 5, 4, 16),
    )
    _write_snapshot(
        positions_dir / "Portfolio_Positions_May-05-2026.csv",
        102_000.0,
        daily_pnl=2_000.0,
        modified_at=datetime(2026, 5, 5, 16),
    )
    _write_snapshot(
        positions_dir / "Portfolio_Positions_May-06-2026.csv",
        112_500.0,
        daily_pnl=500.0,
        modified_at=datetime(2026, 5, 6, 16),
    )
    _write_snapshot(
        positions_dir / "Portfolio_Positions_May-07-2026.csv",
        113_625.0,
        daily_pnl=1_125.0,
        modified_at=datetime(2026, 5, 7, 16),
    )
    history_csv = tmp_path / "History_for_Account_123.csv"
    history_csv.write_text(
        "Run Date,Action,Amount ($)\n05/04/2026,ELECTRONIC FUNDS TRANSFER RECEIVED,100000\n",
        encoding="utf-8",
    )
    service = FilesystemConnectorService(DashboardSettings(filesystem_connectors_state_file=tmp_path / "connectors.json"))
    service.configure_connector(
        "taxable",
        CSV_FOLDER_CONNECTOR_ID,
        FilesystemConnectorConfigRequest(
            displayName="Fidelity taxable",
            positionsDirectoryPath=str(positions_dir),
            historyCsvPath=str(history_csv),
        ),
    )

    portfolio = service.get_portfolio("taxable", CSV_FOLDER_CONNECTOR_ID)

    assert portfolio.netContributions == 110_000.0
    assert portfolio.totalPnl == 3_625.0
    assert portfolio.todayPnl == 1_125.0
    assert portfolio.sourceNotice is not None
    assert "$10,000.00 inferred across 1 significant post-history snapshot movements" in portfolio.sourceNotice


def _write_snapshot(path: Path, value: float, *, modified_at: datetime, daily_pnl: float | None = None) -> None:
    daily_pnl_header = ",Today's Gain/Loss Dollar" if daily_pnl is not None else ""
    daily_pnl_value = f",{daily_pnl}" if daily_pnl is not None else ""
    path.write_text(
        "\n".join(
            [
                f"Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total{daily_pnl_header}",
                f"123,Fidelity taxable,VOO,Vanguard S&P 500 ETF,1,{value},{value},{value}{daily_pnl_value}",
            ]
        ),
        encoding="utf-8",
    )
    timestamp = modified_at.timestamp()
    os.utime(path, (timestamp, timestamp))


def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def _sample_standard_deviation(values: list[float]) -> float:
    mean_value = _mean(values)
    return math.sqrt(sum((value - mean_value) ** 2 for value in values) / (len(values) - 1))
