# Options Volatility Scanner

This project builds a modular Python pipeline that scans US-listed optionable equities for high-beta, high-implied-volatility names that still have usable stock and options liquidity for short-premium strategies.

The design keeps external market data immutable in `data/raw/`, writes engineered features to `data/processed/`, and stores rankings plus strategy shortlists in `data/scored/`.

## Project structure

```text
options-platform/
  configs/
    example_config.yaml
    testing_mock_config.yaml
  data/
    raw/
    processed/
    scored/
  scripts/
    activate.sh
    bootstrap.sh
    venv.sh
  src/
    options_scanner/
      __init__.py
      config.py
      data_ingestion.py
      feature_engineering.py
      scoring.py
      storage.py
      visualization.py
      main.py
      providers/
        __init__.py
        base.py
        ibkr_provider.py
        mock_provider.py
        null_provider.py
        vendor_stubs.py
        yfinance_provider.py
  main.py
  requirements.txt
  README.md
```

## What it computes

- Historical volatility: 20d, 60d, 90d
- Beta vs `SPY` and `QQQ` over 60d and 120d
- ATR as a percent of price
- 20d average daily dollar volume
- Gap frequency for 3% and 5% overnight moves
- ATM front-month IV
- ATM 30-45 DTE IV
- Average IV across near-dated liquid strikes
- Put skew and call skew
- Option-chain liquidity metrics
- IV vs realized-volatility spreads
- Sellable 10-30 delta put/call counts
- Annualized premium yield proxies for puts and covered calls
- Eligibility flags for thin, wide, tiny, ETF, biotech/pharma, earnings-week, or event-risk names

## Scoring logic

The default composite score uses a weighted positive-minus-penalty framework:

```text
score =
  0.18 * beta_component
  + 0.17 * implied_vol_component
  + 0.18 * iv_vs_realized_component
  + 0.16 * option_liquidity_component
  + 0.10 * stock_liquidity_component
  + 0.09 * recurring_moves_component
  + 0.08 * tradability_component
  + 0.04 * persistent_iv_component
  - 0.12 * wide_spread_penalty
  - 0.08 * microcap_penalty
  - 0.10 * event_risk_penalty
```

Each component is percentile-ranked across the current universe, which keeps the framework readable and robust when the distribution of raw values changes.

## Quick start

1. Create the virtual environment and install dependencies:

```bash
./scripts/bootstrap.sh
```

2. Activate it in your current shell if you want an interactive workflow:

```bash
source scripts/activate.sh
```

3. Or inspect the environment without activating it:

```bash
./scripts/venv.sh info
```

4. Configure real providers in `configs/example_config.yaml`.

The checked-in example now assumes:

- `ibkr` for daily price history
- `ibkr` for current options chains
- `none` for reference metadata

5. Run the scanner with the live config:

```bash
python main.py --config configs/example_config.yaml
```

6. If you prefer not to activate the environment, run through the helper:

```bash
./scripts/venv.sh run -- python main.py --config configs/example_config.yaml
```

Outputs land under:

- `data/raw/...` for immutable ingestion snapshots
- `data/processed/features/...` for engineered features
- `data/scored/as_of=YYYY-MM-DD/...` for ranked candidates, strategy shortlists, plots, and the config snapshot used for the run

## Virtual environment helpers

The repo includes a few scripts around `python -m venv`:

- `./scripts/bootstrap.sh`: create the default `.venv` and install `requirements.txt`
- `source scripts/activate.sh`: activate the default `.venv` in your current shell
- `./scripts/venv.sh create`: create a venv
- `./scripts/venv.sh install`: install dependencies into the venv
- `./scripts/venv.sh info`: show the venv path, Python executable, and pip version
- `./scripts/venv.sh python -- ...`: run the venv Python directly
- `./scripts/venv.sh pip -- ...`: run pip inside the venv
- `./scripts/venv.sh run -- ...`: run any command with the venv on `PATH`
- `./scripts/venv.sh remove`: delete the venv

Examples:

```bash
./scripts/venv.sh create
./scripts/venv.sh install
./scripts/venv.sh pip -- list
./scripts/venv.sh python -- -V
./scripts/venv.sh run -- python main.py --config configs/example_config.yaml
./scripts/venv.sh remove
```

You can also point the scripts at a non-default environment:

```bash
./scripts/venv.sh create .venv-dev
./scripts/venv.sh install .venv-dev
source scripts/activate.sh .venv-dev
```

## Provider abstraction

The pipeline separates:

- `PriceDataProvider`
- `OptionsChainProvider`
- `ReferenceDataProvider`

Included today:

- `yfinance`: current snapshot example implementation for price/reference
- `ibkr`: current snapshot price and options-chain implementation via TWS or IB Gateway
- `none`: intentional no-op reference provider
- vendor placeholders for Polygon, Tradier, ORATS, and Alpha Vantage
- `mock`: test-only provider path enabled only when `providers.allow_mock_providers: true`

`configs/example_config.yaml` is now a live-data template, not a mock demo config.

If you want a synthetic smoke test, use:

```bash
python main.py --config configs/testing_mock_config.yaml
```

## Real data requirements

For a real run, the pipeline expects three data sources:

1. Price history endpoint
   - Daily OHLCV bars for each ticker in the universe plus `SPY` and `QQQ`
   - Needed fields: `ticker`, `date`, `open`, `high`, `low`, `close`, `volume`
2. Options chain snapshot endpoint
   - Point-in-time chain rows for each ticker on the `as_of_date`
   - Needed fields: `ticker`, `as_of_date`, `expiration`, `dte`, `option_type`, `strike`, `bid`, `ask`, `mid` or `mark`, `volume`, `open_interest`, `implied_vol`, `delta`, `underlying_price`
3. Reference metadata endpoint
   - Helpful but less critical than options
   - Needed fields: `ticker`, `sector`, `industry`, `market_cap`, `shares_outstanding`, plus optional flags like ETF, ADR, next earnings date, or event-risk flags
   - This layer is optional in the current repo because you can use the `none` reference provider

## Options provider guidance

If your goal is a real options-selling scanner, these are the realistic choices:

1. `ORATS`
   - Best fit if you want historical options analytics, IV history, and later backtests without building your own snapshot warehouse first.
   - Most research-friendly option data choice in this project design.
2. `Polygon`
   - Strong fit for stock history and decent fit for current options snapshots if you want one market-data vendor for most of the pipeline.
   - Better than `yfinance` for automation, but you still need to verify the exact options coverage and historical depth you want.
3. `Tradier`
   - Good retail-friendly current chain source.
   - Better for live screening than long-horizon research.
4. `IBKR`
   - Useful if you already trade through IBKR and want brokerage-adjacent live chain data.
   - Less attractive as the primary research backbone for historical option-chain backtesting.

## IBKR specifically

Yes, `IBKR` can be the live options source, but I would frame it as:

- Good for current chain retrieval when you already run TWS or IB Gateway
- Good for brokerage integration and execution-adjacent workflows
- Not my first choice for historical option research or stable large-universe batch collection

The current implementation uses the official TWS/Gateway socket API and does this:

- resolves the stock contract
- requests option expirations and strikes via `reqSecDefOptParams`
- snapshots a bounded option set inside configurable DTE and moneyness limits
- collects bid, ask, mark or mid, volume, open interest, implied volatility, delta, and underlying price when IBKR supplies them

That bounded live-collection behavior is intentional. Pulling the full chain for a very large universe through IBKR is not a great fit.

For IBKR, the pipeline would expect you to provide connection details such as:

- `IBKR_HOST`
- `IBKR_PORT`
- `IBKR_CLIENT_ID`
- `IBKR_ACCOUNT_ID`
- a configured TWS or IB Gateway session with API access enabled

In the checked-in config template, those are referenced like `${IBKR_HOST:-127.0.0.1}` and `${IBKR_PORT:-7497}` and will be resolved from the environment at runtime.

Typical local setup:

```bash
export IBKR_HOST=127.0.0.1
export IBKR_PORT=7497
export IBKR_CLIENT_ID=7
export IBKR_ACCOUNT_ID=YOUR_ACCOUNT_ID
python main.py --config configs/example_config.yaml
```

Important limits:

- this adapter is for current snapshots, not historical option-chain replay
- it depends on TWS or IB Gateway being up and reachable
- it works best on a targeted universe, not a full-R3000 all-at-once pull
- the checked-in live template now uses IBKR for prices and options, with `reference_provider: none`

## Backtest support

- Every run is parameterized by `as_of_date`
- Features use only trailing data available on or before that date
- Raw options snapshots are stored separately, so IV rank/percentile can later be derived from historical scanner runs without mutating the raw layer
- Rankings are saved per snapshot date for later analysis

## How to tune for a premium-harvesting workflow

- Increase `filters.min_daily_dollar_volume` if fills are more important than idea generation
- Raise `filters.min_option_open_interest` and lower `filters.max_option_spread_pct` for stricter execution quality
- Increase `scoring.iv_vs_realized` if you care more about IV richness than raw beta
- Increase `scoring.tradability` if you specifically want repeated 10-30 delta short-premium opportunities
- Turn off `exclude_earnings_week` only if you deliberately want event-driven premium
- Keep `exclude_binary_event_names` on unless you explicitly want biotech/FDA-style binary risk

## Suggestions for validation

1. Run the scanner over several historical snapshot dates and check whether names that scored well also showed sustained premium richness and acceptable option execution.
2. Compare the top-ranked list with a known high-IV working set such as `IREN`, `CIFR`, `MARA`, `RIOT`, `CLSK`, and a few liquid non-crypto names like `TSLA` or `PLTR`.
3. Review fills manually: high score should still correspond to real bid/ask quality, usable open interest, and enough strike density around 10-30 delta.
4. Track realized short-put or covered-call outcomes by decile of scanner score to see whether the weighted model is actually separating tradable premium from noisy junk.
5. Audit excluded names separately. If too many good candidates are filtered out, loosen thresholds before changing the scoring formula.
