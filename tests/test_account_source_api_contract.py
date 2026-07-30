from __future__ import annotations

from investing_platform.main import app


def test_every_investment_account_source_exposes_the_common_metric_schema() -> None:
    schemas = app.openapi()["components"]["schemas"]
    expected_metric_fields = {
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

    assert set(schemas["AccountSourceMetrics"]["properties"]) == expected_metric_fields
    for response_schema in (
        "CoinbasePortfolioResponse",
        "FilesystemConnectorPortfolioResponse",
        "IbkrPortfolioResponse",
    ):
        assert schemas[response_schema]["properties"]["summary"] == {
            "$ref": "#/components/schemas/AccountSourceMetrics"
        }
