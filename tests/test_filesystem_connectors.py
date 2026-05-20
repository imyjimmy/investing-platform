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
    assert portfolio.sourceNotice is not None
    assert "flow-adjusted daily snapshot return observations" in portfolio.sourceNotice


def _write_snapshot(path: Path, value: float, *, modified_at: datetime) -> None:
    path.write_text(
        "\n".join(
            [
                "Account Number,Account Name,Symbol,Description,Quantity,Last Price,Current Value,Cost Basis Total",
                f"123,Fidelity taxable,VOO,Vanguard S&P 500 ETF,1,{value},{value},{value}",
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
