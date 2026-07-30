from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import pytest

from investing_platform.services.ibkr_flex import IbkrFlexClient, IbkrFlexError, parse_flex_cash_flows


FLEX_XML = """\
<FlexQueryResponse queryName="Investing Platform Cash Flows" type="AF">
  <FlexStatements count="2">
    <FlexStatement accountId="U-OTHER" fromDate="20260101" toDate="20260710">
      <CashTransactions><CashTransaction accountId="U-OTHER" currency="USD" amount="999" type="Deposits/Withdrawals" /></CashTransactions>
    </FlexStatement>
    <FlexStatement accountId="U-TARGET" fromDate="2026-01-01" toDate="2026-07-10">
      <CashTransactions>
        <CashTransaction accountId="U-TARGET" currency="USD" fxRateToBase="1" amount="20000" type="Deposits/Withdrawals" transactionID="1" levelOfDetail="DETAIL" dateTime="2026-01-03;12:00:00" />
        <CashTransaction accountId="U-TARGET" currency="USD" fxRateToBase="1" amount="-1730.83" type="Deposits/Withdrawals" transactionID="2" levelOfDetail="DETAIL" dateTime="2026-01-03;13:00:00" />
        <CashTransaction accountId="U-TARGET" currency="USD" fxRateToBase="1" amount="20000" type="Deposits/Withdrawals" transactionID="1" levelOfDetail="SUMMARY" />
        <CashTransaction accountId="U-TARGET" currency="USD" fxRateToBase="1" amount="50" type="Dividends" transactionID="3" levelOfDetail="DETAIL" />
      </CashTransactions>
      <EquitySummaryInBase>
        <EquitySummaryByReportDateInBase accountId="U-TARGET" reportDate="2026-06-30" netLiquidation="22000" />
        <EquitySummaryByReportDateInBase accountId="U-TARGET" reportDate="2026-07-10" netLiquidation="22500" />
      </EquitySummaryInBase>
    </FlexStatement>
  </FlexStatements>
</FlexQueryResponse>
"""


def test_parse_flex_cash_flows_filters_account_and_non_contribution_cash() -> None:
    summary = parse_flex_cash_flows(FLEX_XML, account_id="u-target")

    assert summary.net_contributions == pytest.approx(18269.17)
    assert summary.transaction_count == 2
    assert summary.period_start is not None and summary.period_start.isoformat() == "2026-01-01"
    assert summary.period_end is not None and summary.period_end.isoformat() == "2026-07-10"
    assert summary.cash_flows_by_date[date(2026, 1, 3)] == pytest.approx(18269.17)
    assert summary.equity_by_date[date(2026, 6, 30)] == 22000.0
    assert summary.missing_sections == ()


def test_parse_flex_cash_flows_requires_cash_transactions_section() -> None:
    xml = '<FlexQueryResponse type="AF"><FlexStatements><FlexStatement accountId="U-TARGET" /></FlexStatements></FlexQueryResponse>'
    with pytest.raises(IbkrFlexError, match="Cash Transactions"):
        parse_flex_cash_flows(xml, account_id="U-TARGET")


def test_flex_client_runs_two_step_workflow_and_retries_pending_statement() -> None:
    session = FakeSession(
        [
            FakeResponse('<FlexStatementResponse><Status>Success</Status><ReferenceCode>123</ReferenceCode></FlexStatementResponse>'),
            FakeResponse('<FlexStatementResponse><Status>Fail</Status><ErrorCode>1019</ErrorCode><ErrorMessage>Generating</ErrorMessage></FlexStatementResponse>'),
            FakeResponse(FLEX_XML),
        ]
    )
    sleeps: list[float] = []
    client = IbkrFlexClient(session=session, sleeper=sleeps.append, poll_attempts=3, poll_interval_seconds=0.25)

    summary = client.fetch_cash_flows(token="secret", query_id="42", account_id="U-TARGET")

    assert summary.net_contributions == pytest.approx(18269.17)
    assert [call[0] for call in session.calls] == ["/SendRequest", "/GetStatement", "/GetStatement"]
    assert all(call[1]["t"] == "secret" for call in session.calls)
    assert sleeps == [0.25]


@dataclass
class FakeResponse:
    text: str
    status_code: int = 200

    @property
    def ok(self) -> bool:
        return 200 <= self.status_code < 300


class FakeSession:
    def __init__(self, responses: list[FakeResponse]) -> None:
        self.responses = responses
        self.headers: dict[str, str] = {}
        self.calls: list[tuple[str, dict[str, object]]] = []

    def get(self, url: str, *, params: dict[str, object], **_: object) -> FakeResponse:
        self.calls.append((url.removeprefix("https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService"), params))
        return self.responses.pop(0)
