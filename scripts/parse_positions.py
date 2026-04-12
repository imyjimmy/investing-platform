"""Print a compact view of live or paper IBKR option positions."""

from __future__ import annotations

import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_DIR = PROJECT_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from investing_platform.config import DashboardSettings  # noqa: E402
from investing_platform.services.ib_gateway import IBGatewayBrokerService  # noqa: E402


def main() -> int:
    settings = DashboardSettings.load()
    service = IBGatewayBrokerService(settings)
    try:
        service.connect(force=False)
        snapshot = service.get_portfolio_snapshot()
    except Exception as exc:  # pragma: no cover - runtime utility
        print(f"Position parser failed: {exc}")
        return 1

    print(f"Account: {snapshot.account.accountId}")
    print("Short option risk view:")
    for position in snapshot.option_positions:
        if position.shortOrLong != "short":
            continue
        print(
            f"  {position.symbol:>5} {position.right}{position.strike:<8g} {position.expiry} "
            f"qty={position.quantity:<4} dte={position.dte:<3} spot={position.underlyingSpot or 0:>8.2f} "
            f"risk={position.assignmentRiskLevel:<8} collateral={position.collateralEstimate:>10,.2f}"
        )
    print(f"Open orders: {len(snapshot.open_orders)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
