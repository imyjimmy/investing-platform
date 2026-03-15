"""Optional scatter plots for inspecting top scanner candidates."""

from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd


LOGGER = logging.getLogger(__name__)


def generate_scatter_plots(scored: pd.DataFrame, output_dir: Path, top_n: int = 10) -> list[Path]:
    """Create a small set of scatter plots for manual review."""

    try:
        import matplotlib.pyplot as plt
    except ImportError:  # pragma: no cover - optional dependency
        LOGGER.warning("matplotlib is not installed; skipping scatter plot generation.")
        return []

    eligible = scored[scored["eligible"]].copy()
    if eligible.empty:
        return []

    output_dir.mkdir(parents=True, exist_ok=True)
    top = eligible.head(top_n)
    plot_specs = [
        ("beta_qqq_60d", "atm_30_45d_iv", "beta_vs_atm_iv.png", "Beta vs ATM 30-45 DTE IV"),
        ("iv_to_hv20", "option_liquidity_component", "iv_hv_vs_option_liquidity.png", "IV/HV vs Option Liquidity"),
        ("market_cap", "composite_score", "market_cap_vs_score.png", "Market Cap vs Composite Score"),
    ]

    generated_paths: list[Path] = []
    for x_col, y_col, filename, title in plot_specs:
        figure, axis = plt.subplots(figsize=(9, 6))
        scatter = axis.scatter(
            eligible[x_col],
            eligible[y_col],
            s=(eligible["avg_daily_dollar_volume_20d"].fillna(0.0) / 2_500_000).clip(lower=40, upper=350),
            c=eligible["composite_score"],
            cmap="viridis",
            alpha=0.75,
            edgecolor="black",
            linewidth=0.35,
        )
        for _, row in top.iterrows():
            axis.annotate(row["ticker"], (row[x_col], row[y_col]), fontsize=8, xytext=(4, 4), textcoords="offset points")
        axis.set_title(title)
        axis.set_xlabel(x_col)
        axis.set_ylabel(y_col)
        color_bar = figure.colorbar(scatter, ax=axis)
        color_bar.set_label("Composite score")
        figure.tight_layout()
        plot_path = output_dir / filename
        figure.savefig(plot_path, dpi=160)
        plt.close(figure)
        generated_paths.append(plot_path)
        LOGGER.info("Saved plot to %s", plot_path)

    return generated_paths
