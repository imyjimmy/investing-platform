"""Smoke-test the local IB Gateway socket connection."""

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
    requested_account_id = sys.argv[1].strip().upper() if len(sys.argv) > 1 and sys.argv[1].strip() else settings.ib_account_id
    if settings.data_mode != "ibkr":
        print("INVESTING_PLATFORM_DATA_MODE is not set to `ibkr`. The smoke test will still try the configured gateway.")
    service = IBGatewayBrokerService(settings)
    try:
        status = service.connect(force=True)
        print(f"Connected: {status.connected} ({status.host}:{status.port}, clientId={status.clientId})")
        if status.managedAccounts:
            print(f"Managed accounts: {', '.join(status.managedAccounts)}")
        snapshot = service.get_portfolio_snapshot(requested_account_id)
        print(f"Account: {snapshot.account.accountId}")
        print(f"Net liquidation: {snapshot.account.netLiquidation:,.2f}")
        print(f"Cash balance: {snapshot.account.cashBalance or 0:,.2f}")
        print(f"Available funds: {snapshot.account.availableFunds:,.2f}")
        print(f"Excess liquidity: {snapshot.account.excessLiquidity:,.2f}")
        print(f"Buying power: {snapshot.account.buyingPower:,.2f}")
        print(f"Stock/ETF positions: {len(snapshot.positions)}")
        for position in snapshot.positions:
            print(
                f"  {position.symbol:>6} {position.secType:<3} qty={position.quantity:>12,.4f} "
                f"price={position.marketPrice:>10,.4f} value={position.marketValue:>12,.2f} "
                f"unrealized={position.unrealizedPnL:>12,.2f}"
            )
        print(f"Option positions: {len(snapshot.option_positions)}")
        print(f"Open orders: {len(snapshot.open_orders)}")
    except Exception as exc:  # pragma: no cover - runtime utility
        print(f"Connection test failed: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
