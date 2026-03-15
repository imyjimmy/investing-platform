"""CLI entry point for the options volatility scanner."""

from __future__ import annotations

import argparse
import logging
from datetime import date
from pathlib import Path

import pandas as pd

from .config import AppConfig
from .data_ingestion import ingest_raw_data
from .feature_engineering import build_feature_frame
from .scoring import build_strategy_shortlists, score_candidates
from .storage import LocalDataStore
from .visualization import generate_scatter_plots


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Scan optionable equities for premium-selling candidates.")
    parser.add_argument("--config", default="configs/example_config.yaml", help="Path to YAML config file.")
    parser.add_argument("--as-of-date", default=None, help="Override config as-of date (YYYY-MM-DD).")
    parser.add_argument("--skip-plots", action="store_true", help="Disable scatter plot output.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    config = AppConfig.from_yaml(args.config)
    if args.as_of_date:
        config.runtime.as_of_date = date.fromisoformat(args.as_of_date)

    _configure_logging(config.runtime.log_level)
    store = LocalDataStore(config.resolved_data_dir())

    raw_data = ingest_raw_data(config, store)
    feature_frame = build_feature_frame(raw_data, config, store)
    scored = score_candidates(feature_frame, config)
    shortlists = build_strategy_shortlists(scored, config.runtime.top_n)

    scored_path = store.save_scored(scored[scored["eligible"]], config.runtime.as_of_date, "ranked_candidates.csv")
    store.save_scored(scored, config.runtime.as_of_date, "all_candidates_with_exclusions.csv")
    store.save_processed(feature_frame, "features", config.runtime.as_of_date, "engineered_features.csv")
    store.save_json(config.to_dict(), store.scored_snapshot_path(config.runtime.as_of_date, "run_config.json"))

    for shortlist_name, shortlist_frame in shortlists.items():
        store.save_scored(shortlist_frame, config.runtime.as_of_date, f"{shortlist_name}_top_{config.runtime.top_n}.csv")

    if config.runtime.generate_plots and not args.skip_plots:
        generate_scatter_plots(scored, store.scored_snapshot_path(config.runtime.as_of_date, "plots").parent / "plots", config.runtime.top_n)

    top_preview = scored[scored["eligible"]].head(min(10, len(scored)))
    if not top_preview.empty:
        pd.set_option("display.width", 160)
        pd.set_option("display.max_columns", 14)
        logging.getLogger(__name__).info("Top candidates:\n%s", top_preview[["ticker", "composite_score", "recommended_strategy", "why_it_ranked"]].to_string(index=False))
    logging.getLogger(__name__).info("Ranked candidates saved to %s", scored_path)


def _configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )


if __name__ == "__main__":
    main()
