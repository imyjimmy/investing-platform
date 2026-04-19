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
3. The second organizing level is `tool`, `lens`, or a labeled sub-domain within that asset type.
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

- `Market`
- `Ticker`
- stock-specific options tools grouped under an `Options` subsection label

### Market

`Market` is the stock-market workspace.

It owns:

- market-wide screens
- universe browsing
- ranking and sorting workflows
- breadth and regime context
- cross-symbol factors such as beta, volatility, relative strength, and volume leadership

It should answer questions like:

- what is happening across the market right now?
- which stocks are the highest-beta names?
- which symbols are leading on volatility, momentum, or volume?
- which names should I inspect next in `Ticker` or `Options`?

It is not a single-symbol page.

### Ticker

`Ticker` is the general stock workspace.

It owns:

- one symbol at a time
- quote and company context
- chart or price context
- earnings context
- filings context
- research context

It does not need separate sibling sidebar items for those subcontexts.
It should receive symbols from `Market`, watchlists, search, or direct navigation.

### Options

`Options` is a stock-specific sub-domain, not a separate asset class.

If options remains simple, it can be represented as a single stock tool.

If options grows into a major product area, then `Stocks` should contain:

- stock-general tools first
- a visual subsection label such as `Options`
- multiple options-specific tools listed below that label

That means `Options` may be:

- one tool at first
- then later a labeled stock subdomain with several tools

without needing to become a new top-level asset type.

It owns:

- options chains
- Greeks
- contract selection
- strategy design
- volatility views
- trade ticketing

Likely options tools over time:

- `Chain`
- `Builder`
- `Structures`
- `Volatility`
- `Scanner`

It may also surface earnings-aware options context when relevant, but `Earnings` still does not become a sibling sidebar tool.

## Crypto

Tools under `Crypto`:

- `Market`
- `Leverage`

### Market

`Market` is the general crypto workspace.

It should start narrow and useful:

- BTC price
- ETH price
- major-move context
- crypto-market context that is independent of account holdings

It does not open directly into Coinbase account balances.

### Leverage

`Leverage` is the first distinctly crypto-native analysis tool.

It should help answer:

- how much leverage is in the system?
- where is leverage concentrated?
- is the move spot-led or derivatives-led?
- where is crowding or forced-unwind risk likely building?

Likely metrics:

- open interest
- perp funding
- basis
- long/short crowding
- liquidation-risk context

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
6. `Stocks` may contain labeled subsections such as `Options`.
7. `Options` is not a new top-level asset type.
8. `Earnings` is not a sidebar destination.
9. `Filings` is not a sidebar destination.
10. `Research` is not a standalone top-level stock sibling if it is really part of the stock-research flow.
11. A sidebar destination must not open directly into per-account balances, holdings, or connector output.
12. New asset groups require a dedicated workflow, not just a new idea.

## Immediate Target Sidebar

The intended sidebar shape right now is:

```text
Home button in top chrome -> Dashboard

Stocks
  Market
  Ticker
  --- Options ---
  Chain
  Builder (later)
  Structures (later)
  Volatility (later)
  Scanner (later)

Crypto
  Market
  Leverage

Global Settings (footer gear)
```

## Acceptance Criteria

The sidebar is correct only if:

- there is no `Dashboard` row in the sidebar
- the visible market destinations fall under `Stocks` or `Crypto`
- `Earnings` is absent from the sidebar
- `Filings` is absent from the sidebar
- `Research` is absent as a separate top-level stock sibling unless it has become the singular stock research surface
- the `Stocks` group may use an `Options` subsection label without making `Options` a new top-level asset type
- `Crypto` tools do not open directly into Coinbase balances
- `Ticker` and the options tools feel like stock tools rather than uncategorized app pages
- `Market` feels like the stock-universe workspace rather than a crypto-only concept
- `Market` and `Leverage` make `Crypto` feel like a real asset category rather than a placeholder
