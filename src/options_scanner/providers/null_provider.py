"""Minimal providers for optional data layers."""

from __future__ import annotations

from datetime import date
from typing import Sequence

import pandas as pd

from .base import ReferenceDataProvider


class NullReferenceDataProvider(ReferenceDataProvider):
    """Reference provider that intentionally returns no metadata."""

    name = "none"

    def get_reference_data(self, tickers: Sequence[str], as_of_date: date) -> pd.DataFrame:
        return pd.DataFrame({"ticker": [ticker.upper() for ticker in tickers]})
