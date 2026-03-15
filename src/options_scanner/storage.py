"""Filesystem persistence helpers for raw, processed, and scored datasets."""

from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from pathlib import Path
from typing import Iterable

import pandas as pd


LOGGER = logging.getLogger(__name__)


class LocalDataStore:
    """Stores immutable raw snapshots plus derived feature and score artifacts."""

    def __init__(self, base_dir: Path) -> None:
        self.base_dir = Path(base_dir)
        self.raw_dir = self.base_dir / "raw"
        self.processed_dir = self.base_dir / "processed"
        self.scored_dir = self.base_dir / "scored"
        self.ensure_directories()

    def ensure_directories(self) -> None:
        for path in (self.raw_dir, self.processed_dir, self.scored_dir):
            path.mkdir(parents=True, exist_ok=True)

    def raw_snapshot_path(self, dataset: str, as_of_date: date, provider_name: str, filename: str) -> Path:
        return self.raw_dir / dataset / f"as_of={as_of_date.isoformat()}" / f"provider={provider_name}" / filename

    def processed_snapshot_path(self, dataset: str, as_of_date: date, filename: str) -> Path:
        return self.processed_dir / dataset / f"as_of={as_of_date.isoformat()}" / filename

    def scored_snapshot_path(self, as_of_date: date, filename: str) -> Path:
        return self.scored_dir / f"as_of={as_of_date.isoformat()}" / filename

    def save_raw(self, df: pd.DataFrame, dataset: str, as_of_date: date, provider_name: str, filename: str) -> Path:
        path = self.raw_snapshot_path(dataset, as_of_date, provider_name, filename)
        path.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(path, index=False)
        LOGGER.info("Saved raw %s snapshot to %s", dataset, path)
        return path

    def save_processed(self, df: pd.DataFrame, dataset: str, as_of_date: date, filename: str) -> Path:
        path = self.processed_snapshot_path(dataset, as_of_date, filename)
        path.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(path, index=False)
        LOGGER.info("Saved processed %s snapshot to %s", dataset, path)
        return path

    def save_scored(self, df: pd.DataFrame, as_of_date: date, filename: str) -> Path:
        path = self.scored_snapshot_path(as_of_date, filename)
        path.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(path, index=False)
        LOGGER.info("Saved scored output to %s", path)
        return path

    def save_json(self, payload: dict, path: Path) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
        LOGGER.info("Saved metadata to %s", path)
        return path

    def load_option_snapshot_history(self, as_of_date: date, lookback_days: int) -> pd.DataFrame:
        earliest = as_of_date - timedelta(days=lookback_days)
        frames: list[pd.DataFrame] = []
        options_root = self.raw_dir / "options"
        for path in options_root.glob("as_of=*/provider=*/options_chain.csv"):
            snapshot_date = _extract_snapshot_date(path)
            if not snapshot_date or snapshot_date > as_of_date or snapshot_date < earliest:
                continue
            frame = pd.read_csv(path)
            if frame.empty:
                continue
            if "as_of_date" not in frame.columns:
                frame["as_of_date"] = snapshot_date.isoformat()
            frames.append(frame)
        if not frames:
            return pd.DataFrame()
        combined = pd.concat(frames, ignore_index=True)
        combined["as_of_date"] = pd.to_datetime(combined["as_of_date"]).dt.date
        return combined


def _extract_snapshot_date(path: Path) -> date | None:
    for part in path.parts:
        if part.startswith("as_of="):
            try:
                return date.fromisoformat(part.split("=", 1)[1])
            except ValueError:
                return None
    return None
