# Options Workstation Plan

## Current State

The current `Options` section is a proof of concept, not a usable workstation.

Existing backend and research code provide useful building blocks, but the product is not done until the core workflow actually works from the dashboard.

## Immediate Success Criteria

The first milestone is not polish. It is basic usability.

The `Options` section must satisfy all of these:

1. You can load any optionable ticker from IBKR.
2. You can inspect a real live chain with expirations, calls, puts, quotes, and Greeks.
3. You can buy or sell any option contract from that chain and have it route through the IBKR paper account.
4. You can confirm the order as accepted, working, or filled from the dashboard.
5. You can query a stock universe for names such as high beta or high volatility from inside the dashboard.

Anything short of that is not usable.

## Product Direction

The `Options` section should become a full workstation that replaces the old `options-scanner` workflow inside this application.

It should support six jobs:

1. Load live IBKR options chains by ticker and expiration.
2. Design and preview single-leg and multi-leg trades.
3. Execute paper options trades end-to-end.
4. Analyze volatility across stocks like a volatility desk.
5. Study earnings behavior and backtest strategy behavior around events.
6. Run scanner and ranking workflows for multiple strategies, with earnings calendars as one module.

## Data And System Principles

- IBKR is the source of truth for live chain data, Greeks, positions, preview, submit, and cancel.
- Earnings databases and cached event data are supporting context, not the primary live options source.
- Existing scanner and analytics code should be absorbed into this repo until the dashboard can do everything operationally useful that the old tools did.
- The workstation must stay strategy-extensible. Earnings long calendars are one module, not the whole product.

## Phase 1: Make Options Actually Work

Rebuild the `Options` section around a chain-first trading workflow.

### Scope

- Make ticker lookup work for any optionable ticker IBKR supports.
- Make expiration switching reliable.
- Show a real chain with calls, puts, strike, bid, ask, mark, IV, delta, theta, and other Greeks when IBKR provides them.
- Make contract selection populate a real ticket.
- Make preview work for single-leg options orders.
- Make submit work for both `BUY` and `SELL`.
- Make the order actually route to IBKR paper and show up in the dashboard with live status.
- Make cancel work for resting paper orders.
- Keep positions and commitments secondary until this workflow is solid.

### Hard Gate

This phase is not done until all of these are true:

- Load multiple tickers such as `AAPL`, `IREN`, `SPY`, and `TSLA`.
- Inspect a real chain for each.
- Submit a paper options order from the chain.
- Confirm that the order is accepted by IBKR paper and appears as working or filled in the dashboard.
- Confirm cancel works for resting paper orders.

## Phase 2: Stock Discovery And Universe Query

Surface universe-level discovery inside the dashboard.

### Scope

- Add stock and options candidate filters for:
  - beta
  - historical volatility
  - implied volatility
  - IV rank and IV percentile
  - IV versus realized volatility
  - option liquidity
  - earnings proximity
- Expose candidate browsing for workflows like:
  - high beta names
  - high volatility names
  - liquid premium-selling names
  - earnings-adjacent names

## Phase 3: Trade Design Workstation

Add a real structure builder for designing trades before placement.

### Scope

- Support single-leg and multi-leg structures.
- Allow legs to be added and removed directly from the live chain.
- Group held positions by structure and thesis:
  - bullish
  - bearish
  - neutral
- Let held positions load back into the builder for analysis or adjustment.

### Analytics In The Builder

- debit or credit
- net Greeks
- buying power or margin impact
- risk summary
- payoff curve at expiration
- volatility sensitivity

## Phase 4: Subsume `options-scanner`

Move old scanner functionality into this app until the dashboard becomes the canonical home for options workflows.

### Scope

- absorb watchlists and universes
- absorb earnings database access
- absorb scanner metrics and ranking logic
- absorb candidate discovery workflows
- keep the design strategy-extensible

The goal is not to "integrate with" `options-scanner`. The goal is for the dashboard to replace it.

## Phase 5: Volatility Lab

Add desk-style volatility analysis across tickers.

### Scope

- IV term structure
- skew
- IV versus realized volatility
- VRP-style views
- historical IV context
- stock and options volume trends
- cross-ticker comparison

This is where the volatility analytics become a first-class workflow instead of just backend calculations.

## Phase 6: Earnings And Event Lab

Add event-focused analysis around earnings and related catalysts.

### Scope

- upcoming earnings events
- implied move versus realized move
- IV crush behavior
- gap statistics
- historical earnings behavior
- strategy behavior around earnings windows

Use IBKR first where possible and fall back to absorbed earnings-event data when IBKR does not provide enough context.

## Phase 7: Backtests And Sizing

Add research and sizing tools inside the dashboard.

### Scope

- strategy backtests
- expectancy
- drawdown
- win rate
- return distribution
- Kelly sizing
- fractional Kelly sizing
- Monte Carlo or path simulations when needed for position-sizing sanity checks

## Definition Of Done

The `Options` section is not done until all of these are true:

1. You can load any optionable ticker from IBKR.
2. You can inspect a real live chain.
3. You can buy or sell an option from that chain and have it route through IBKR paper.
4. You can confirm the order as working or filled from the dashboard.
5. You can query a stock universe for high beta or high volatility names from inside the dashboard.
6. You can do everything operationally useful that `options-scanner` used to do without leaving the `Options` section.
7. You can model trades before placement with payoff, Greeks, margin impact, and volatility sensitivity.
8. You can analyze volatility across stocks and around earnings events from inside the same workstation.

## Execution Order

1. Chain loading and real paper execution.
2. Universe query and stock filtering.
3. Structure builder.
4. Scanner subsumption.
5. Volatility lab.
6. Earnings and event lab.
7. Backtests and sizing.
