# Sidebar Asset Taxonomy Spec

## Status

Proposed spec for how the primary sidebar is subdivided.

This document is narrower than the broader dashboard IA spec. It exists to lock down one thing:

- the sidebar is organized first by `asset type`
- tools live inside an asset type
- account views and connector plumbing do not belong there

## Why This Spec Exists

The sidebar got noisy because it mixed together:

- shell destinations
- market tools
- research surfaces
- account-adjacent views
- connector plumbing

That makes the app feel arbitrary.

The user-facing mental model should be simpler:

- what asset am I looking at?
- what lens or tool am I using on that asset?

For now, the asset split is:

- `Stocks`
- `Crypto`

## Product Principles

1. The primary sidebar is for market navigation, not account plumbing.
2. The first organizing level in the sidebar is `asset type`.
3. The second organizing level is `tool` or `lens`.
4. `Dashboard` is shell chrome, not an asset type.
5. `Global Settings` is shell chrome, not an asset type.
6. A sidebar destination must never open directly into per-account balances or holdings.
7. Context such as `earnings`, `filings`, and `research` should appear after the user enters an asset workspace, not as parallel sidebar clutter.

## Shell-Level Items Outside The Asset Taxonomy

These are allowed, but they are not part of the asset grouping itself.

### Top Bar

- `Home`
  - returns to `Dashboard`
  - this is the only primary dashboard-home control

### Sidebar Footer

- `Global Settings`
  - opens app-wide settings and shared data-source settings

Not allowed:

- a duplicate `Dashboard` row in the sidebar
- broker destinations
- account destinations
- connector destinations

## Top-Level Sidebar Structure

The primary sidebar should have exactly two top-level asset groups for now:

## Stocks

Tools under `Stocks`:

- `Ticker`
- `Options`

### Ticker

`Ticker` is the general stock workspace.

It owns:

- quote and company context
- chart or price context
- earnings context
- filings context
- research context

It does not need separate sibling sidebar items for those subcontexts.

### Options

`Options` is a stock-specific lens, not a separate asset class.

It owns:

- options chains
- Greeks
- contract selection
- strategy design
- volatility views
- trade ticketing

It may also surface earnings-aware options context when relevant, but `Earnings` still does not become a sibling sidebar tool.

## Crypto

Tools under `Crypto`:

- `Crypto`

For now this tool should stay intentionally narrow.

It owns:

- BTC price
- ETH price
- crypto-market context that is independent of account holdings

It does not open directly into Coinbase account balances.

If crypto tooling later grows, that growth should happen inside the `Crypto` asset group rather than by adding random uncategorized sidebar items.

## Explicit Non-Tools

These should not be first-class sidebar destinations.

### Earnings

`Earnings` is contextual stock analysis.

It belongs inside:

- `Stocks > Ticker`
- optionally `Stocks > Options` when the current trade setup depends on earnings timing

It does not belong as a top-level sidebar item.

### Filings

`Filings` is research context for stocks.

It belongs inside:

- `Stocks > Ticker`
- or inside a unified stock research surface

It does not belong as a top-level sidebar item.

### Research

`Research` is also stock context.

It should not compete with `Filings` as a parallel sidebar destination when both are really part of the same research workflow.

The preferred direction is:

- one stock research surface inside `Ticker`
- or one research region inside the stock workspace

### Connectors

`IBKR`, `Coinbase`, `EDGAR`, and similar sources are implementation details.

They may appear:

- in per-account settings
- in global settings
- as source labels inside a tool

They may not appear:

- as first-class sidebar destinations

## Future Asset Types

Potential future top-level asset groups:

- `Treasuries` or `Rates`
- `Commodities`
- `FX`

But a new asset type should only be added if all three are true:

1. it has at least one dedicated tool that is meaningfully different from existing stock or crypto tools
2. it has a distinct data model and user workflow
3. it would reduce confusion rather than add menu surface area

So the answer to "are commodities or treasuries next?" is:

- maybe
- but not by default
- they earn a top-level group only when the product has real workflows for them

## Hard Rules

1. The sidebar is grouped by asset type first.
2. `Stocks` and `Crypto` are the only asset groups for now.
3. `Dashboard` is not a sidebar row.
4. `Home` in the top bar is the dashboard return path.
5. `Global Settings` lives in the sidebar footer.
6. `Earnings` is not a sidebar destination.
7. `Filings` is not a sidebar destination.
8. `Research` is not a standalone top-level sibling if it is really part of the stock-research flow.
9. A sidebar destination must not open directly into per-account balances, holdings, or connector output.
10. New asset groups require a dedicated workflow, not just a new idea.

## Immediate Target Sidebar

The intended sidebar shape right now is:

```text
Home button in top chrome -> Dashboard

Stocks
  Ticker
  Options

Crypto
  Crypto

Global Settings (footer gear)
```

## Acceptance Criteria

The sidebar is correct only if:

- there is no `Dashboard` row in the sidebar
- the visible market destinations fall under `Stocks` or `Crypto`
- `Earnings` is absent from the sidebar
- `Filings` is absent from the sidebar
- `Research` is absent as a separate top-level stock sibling unless it has become the singular stock research surface
- `Crypto` does not open directly into Coinbase balances
- `Ticker` and `Options` feel like stock tools rather than uncategorized app pages
