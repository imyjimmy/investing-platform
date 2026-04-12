"""Loads the latest ranked stock universe snapshot for dashboard querying."""

from __future__ import annotations

from datetime import UTC, date, datetime
from pathlib import Path

import pandas as pd

from investing_platform.models import UniverseCandidate, UniverseSnapshotResponse


class UniverseScreenerService:
    """Serves the latest ranked universe snapshot produced by options-scanner flows."""

    def __init__(self, project_root: Path) -> None:
        self.project_root = Path(project_root)
        self._cached_path: Path | None = None
        self._cached_mtime_ns: int | None = None
        self._cached_snapshot: UniverseSnapshotResponse | None = None

    def get_latest_snapshot(self) -> UniverseSnapshotResponse:
        path = self._latest_ranked_candidates_path()
        stat = path.stat()
        if (
            self._cached_snapshot is not None
            and self._cached_path == path
            and self._cached_mtime_ns == stat.st_mtime_ns
        ):
            return self._cached_snapshot

        frame = pd.read_csv(path)
        if frame.empty:
            raise RuntimeError(f"The latest ranked universe snapshot at {path} is empty.")

        snapshot_date = _snapshot_date_from_path(path)
        if snapshot_date is None:
            snapshot_date = _coerce_date(
                frame.get("as_of_date", pd.Series(dtype="object")).iloc[0] if "as_of_date" in frame.columns else None
            )
        if snapshot_date is None:
            raise RuntimeError(f"Could not resolve a snapshot date from {path}.")

        if "eligible" in frame.columns:
            frame["eligible"] = frame["eligible"].fillna(False).astype(bool)
        frame = frame.sort_values(
            by=["eligible", "composite_score", "beta_component", "implied_vol_component"],
            ascending=[False, False, False, False],
            na_position="last",
        ).reset_index(drop=True)

        rows = [
            UniverseCandidate(
                symbol=str(row.get("ticker", "")).upper(),
                asOfDate=snapshot_date,
                lastClose=_optional_float(row.get("last_close")),
                betaQqq60d=_optional_float(row.get("beta_qqq_60d")),
                betaQqq120d=_optional_float(row.get("beta_qqq_120d")),
                betaSpy120d=_optional_float(row.get("beta_spy_120d")),
                hv20=_optional_float(row.get("hv20")),
                hv60=_optional_float(row.get("hv60")),
                atmFrontMonthIv=_optional_float(row.get("atm_front_month_iv")),
                atm3045dIv=_optional_float(row.get("atm_30_45d_iv")),
                ivToHv20=_optional_float(row.get("iv_to_hv20")),
                avgDailyDollarVolume20d=_optional_float(row.get("avg_daily_dollar_volume_20d")),
                totalOptionVolume=_optional_int(row.get("total_option_volume")),
                totalOptionOpenInterest=_optional_int(row.get("total_option_open_interest")),
                compositeScore=_optional_float(row.get("composite_score")),
                betaComponent=_optional_float(row.get("beta_component")),
                impliedVolComponent=_optional_float(row.get("implied_vol_component")),
                recommendedStrategy=_optional_str(row.get("recommended_strategy")),
                whyItRanked=_optional_str(row.get("why_it_ranked")),
                eligible=bool(row.get("eligible", False)),
            )
            for _, row in frame.iterrows()
            if str(row.get("ticker", "")).strip()
        ]

        staleness_days = (date.today() - snapshot_date).days
        source_notice = (
            f"Universe query uses the latest ranked scanner snapshot from {snapshot_date.isoformat()}."
            if staleness_days <= 7
            else f"Universe query is showing the latest ranked scanner snapshot from {snapshot_date.isoformat()}."
        )
        snapshot = UniverseSnapshotResponse(
            snapshotDate=snapshot_date,
            rows=rows,
            sourceNotice=source_notice,
            generatedAt=datetime.now(UTC),
            isStale=staleness_days > 7,
        )
        self._cached_path = path
        self._cached_mtime_ns = stat.st_mtime_ns
        self._cached_snapshot = snapshot
        return snapshot

    def _latest_ranked_candidates_path(self) -> Path:
        candidates = sorted(
            self.project_root.glob("data/scored/as_of=*/ranked_candidates.csv"),
            key=lambda candidate: candidate.parent.name,
        )
        if not candidates:
            raise RuntimeError("No ranked universe snapshots were found under data/scored.")
        return candidates[-1]


def _optional_float(value: object) -> float | None:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if pd.isna(number):
        return None
    return float(number)


def _optional_int(value: object) -> int | None:
    try:
        number = int(float(value))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return number


def _optional_str(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text or text.lower() == "nan":
        return None
    return text


def _coerce_date(value: object) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None


def _snapshot_date_from_path(path: Path) -> date | None:
    for part in path.parts:
        if part.startswith("as_of="):
            return _coerce_date(part.split("=", 1)[1])
    return None
