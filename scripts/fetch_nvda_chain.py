"""Fetch and print the current NVDA option chain snapshot from the dashboard service."""

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
        chain = service.get_option_chain("NVDA")
    except Exception as exc:  # pragma: no cover - runtime utility
        print(f"NVDA chain fetch failed: {exc}")
        return 1

    print(f"NVDA spot: {chain.underlying.price:,.2f}")
    print(f"Selected expiry: {chain.selectedExpiry}")
    print("Top 10 strikes:")
    for row in chain.rows[:10]:
        print(
            f"  {row.strike:>8.2f} | call mid={row.callMid or 0:>7.2f} | put mid={row.putMid or 0:>7.2f} | dist={row.distanceFromSpotPct:>6.2f}%"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
