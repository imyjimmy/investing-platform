# Dashboard Information Architecture Spec

## Status

Proposed architecture spec for the workstation shell, dashboard navigation, and ownership boundaries.

This document exists to prevent "label reshuffles" that look like a re-org but preserve the old mental model underneath.

## Why This Spec Exists

The current app mashes together four different concepts:

- `Accounts`: portfolios and execution contexts
- `Tools`: market-perception workspaces
- `Connectors`: data and execution plumbing
- `Settings`: configuration surfaces

That mixing causes recurring UI failures:

- account identity appears inside market lookup controls
- tool surfaces inherit account context when they should not
- connectors show up as first-class destinations instead of implementation details
- global data sources and account-bound connections are treated as the same thing

This spec defines the ownership boundaries the app must follow.

## Product Principles

1. The shell must describe what the user is looking at, not expose internal plumbing.
2. A tool must not inherit account context unless it actually needs account data.
3. Market data source, execution route, and portfolio overlay are separate concepts and must stay separate in the UI and state model.
4. Account-bound connectors belong to the account that uses them.
5. Global data sources belong to global settings, not to an account dashboard.
6. `Connectors` must stop being a first-class navigation concept.

## Core Domain Model

### Accounts

An `Account` is a portfolio and execution context.

Examples:

- `Primary`
- `Personal`

Accounts own:

- balances
- buying power
- positions
- open orders
- realized and unrealized P/L
- execution defaults
- account-bound connectors
- account-specific risk settings

Accounts do not own:

- the options chain itself
- a stock lookup surface
- EDGAR as a product-wide research source
- a global universe browser

### Tools

A `Tool` is a market-perception workspace.

Examples:

- `Ticker`
- options-specific stock tools such as `Chain`, `Builder`, or `Volatility`
- crypto-specific tools such as `Market` or `Leverage`

Tools exist to help the user perceive and analyze the market.

That includes:

- asset-class workspaces such as stocks and crypto
- specialized lenses inside an asset class, such as stock options tooling
- contextual research and event surfaces that appear inside an asset workspace

Tools may consume market data, but they are not accounts.

Tools can optionally use three independent contexts:

- `Data source`
- `Execution route`
- `Overlay account`

### Connectors

A `Connector` is plumbing that either feeds data into the product or routes execution out of it.

There are two connector classes.

#### Account-Bound Connectors

These belong to one account and are managed from that account's settings.

Examples:

- `IBKR Primary`
- `IBKR Personal`
- `Coinbase account`
- future bank / brokerage / wallet connections

#### Global Data Sources

These are product-wide data sources and are managed from global settings.

Examples:

- `EDGAR`
- `Investor PDFs`
- earnings-event database
- research datasets
- future market-universe feeds

### Settings

There are only two settings scopes:

- `Global settings`
- `Per-account settings`

There is no standalone connector workspace in the primary nav.

## Hard Invariants

These are not suggestions.

1. The shell exposes `Dashboard` through the top chrome and market tools through the sidebar; the sidebar itself may not be a connector directory.
2. `Dashboard` is account-centric.
3. Market tools are tool-centric and grouped by asset type.
4. Account-bound connectors are visible from per-account settings only.
5. Global data sources are visible from the sidebar gear only.
6. A tool may show `Data source`, `Execution route`, and `Overlay account`, but it may not silently inherit the selected dashboard account.
7. A market lookup control row may not contain account identity or connector metadata.
8. Account identity belongs in the account header or account settings, not in a symbol-input row.
9. The options chain is a tool, not an account panel.
10. `Coinbase` is not a top-level connector destination; it is either an account-bound connector or a crypto tool data source depending on what is being shown.
11. Configuration UI is hidden behind the owning gear or settings entry point. Main pages do not inline settings panels.
12. A dashboard account page may show account facts, but it may not show connector settings, connector lists, or connector configuration controls unless the account gear has been opened.
13. A primary sidebar destination must always open a tool or the dashboard shell. It may not open directly into per-account balances, per-account holdings, or per-account connector output.

## Top-Level Navigation Model

### Sidebar Contents

The primary sidebar should be grouped first by `asset type`.

The source of truth for the sidebar taxonomy is:

- [sidebar-asset-taxonomy-spec.md](./sidebar-asset-taxonomy-spec.md)

The sidebar is for tools.

Meaning:

- things you use to perceive the market
- things you use to inspect data
- things you use to research a symbol, universe, sector, or event set

It is not for:

- account plumbing
- broker plumbing
- connector plumbing
- per-account holdings views
- per-account balances views

The sidebar gear should open:

- global settings
- global data sources
- app preferences
- cache and infrastructure preferences
- shared defaults

The sidebar should not contain:

- `Interactive Brokers`
- `Coinbase`
- `EDGAR` as a connector tile
- `Investor PDFs` as a connector tile
- any generic `Connectors` destination
- account-scoped settings panels
- inline connector configuration

### Sidebar Allowlist

Allowed in the primary sidebar:

- asset-grouped tool destinations
- primary tool destinations
- the sidebar gear

Allowed as small sidebar metadata:

- active-state highlighting
- unread or error badges
- collapse and expand controls

Not allowed in the primary sidebar:

- connector cards
- broker account cards
- Coinbase tiles
- a duplicate `Dashboard` row when the top chrome already owns the dashboard-home action
- EDGAR connection tiles
- account settings links
- account-specific route controls
- settings forms
- generic plumbing destinations
- per-account balances destinations
- per-account holdings destinations
- pages whose primary content is one account's connector output

### Dashboard

`Dashboard` is the portfolio home. It should support multiple account tabs.

Initial tabs:

- `Primary`
- `Personal`

Possible later tab:

- `Combined`

Each dashboard tab may show:

- balances
- liquidity
- positions
- working orders
- P/L
- exposure and risk summaries
- account-specific overlays and summaries

Each dashboard tab has a gear that opens settings for that account only.

The dashboard is the only primary shell surface that may open directly into per-account balances, holdings, and account-owned exposure views.

### Dashboard Account Page Allowlist

Allowed on the main account page:

- account title and account identity
- live or paper status pill
- routed account fact display
- balances and liquidity
- positions
- working orders
- P/L
- exposure summaries
- portfolio overlays
- account-level alerts

Allowed only as passive account facts in the header:

- routed broker name
- routed account id
- route mode such as `Live trading` or `Paper trading`
- terse connector-health summary if it is strictly informational

Not allowed on the main account page:

- connector settings
- connector cards
- connector configuration forms
- connector management copy
- global data source controls
- tool-specific lookup controls such as ticker input or options expiry selectors
- anything whose purpose is "change account settings"

If the user can configure it, it belongs behind the account gear.

### Tool Workspaces

Each tool is independent from the dashboard tabs.

Initial tool workspaces:

- stock-market tools such as `Market`
- stock tools such as `Ticker`
- stock-options tools or an `Options` subdomain
- crypto tools such as `Market` and `Leverage`

## View Ownership

### Dashboard View

Purpose:

- portfolio state
- execution-state visibility
- account health

Owns:

- selected dashboard account tab
- per-account settings access
- account summaries and overlays

Must not own:

- options chain lookup workflow
- general ticker lookup workflow
- market-wide research workflows
- connector settings panels
- global data source settings

### Gear Boundary

The gear icon is a hard boundary between `viewing the account` and `configuring the account`.

That means:

- the main account page is for portfolio state
- the account gear is for account configuration

The main account page may summarize route state in one compact, passive way, but it may not expand into a settings surface.

Examples of allowed passive account facts:

- `IBKR routed`
- `Acct U12345678`
- `Live trading`

Examples of forbidden settings leakage on the main account page:

- connector status cards with setup copy
- "Account Settings" sections embedded in the page
- editable route defaults
- connector action buttons
- configuration panels duplicated outside the gear

### Per-Account Settings

Purpose:

- configure the account as an execution and portfolio container

Owns:

- account-bound connectors
- route defaults
- permissions
- risk defaults
- account-specific preferences

Initial examples:

#### Primary settings

- IBKR route for Primary
- Coinbase connector used by Primary
- future custodian / bank / wallet connectors when those are account-bound

#### Personal settings

- IBKR route for Personal
- future personal-only broker or bank connections

Per-account settings must not contain:

- EDGAR
- Investor PDFs
- global cache settings
- product-wide data source toggles

Per-account settings are the only place where account-bound connector management is allowed.

### Global Settings

Purpose:

- configure the product, not a portfolio

Owns:

- app theme and shell behavior
- workspace defaults
- global data source configuration
- EDGAR settings
- Investor PDFs settings
- research root
- cache and infra controls

Global settings must not contain:

- account-specific route defaults
- account-specific balances or holdings
- account-only connectors

Global settings are the only place where global data-source management is allowed.

### Market Tool

Purpose:

- inspect the stock market as a universe rather than one symbol
- rank, screen, and sort names before drilling into a ticker or chain

Default state:

- no account required

Optional contexts:

- data source
- overlay account

Examples:

- beta rankings
- volatility leaders
- unusual volume
- breadth and regime views

### Ticker Tool

Purpose:

- inspect an underlying without needing an account
- serve as the single-symbol stock workspace

Default state:

- no account required

Optional contexts:

- data source
- overlay account

### Options Tool

Purpose:

- inspect chains
- load contracts
- build tickets and structures
- preview and submit orders

Default state:

- account-agnostic market inspection

This tool may begin as one entry point, but the long-term model allows multiple options-specific tools or sub-tools inside the stock domain.

Optional contexts:

- `Data source`
- `Execution route`
- `Overlay account`

Rules:

- loading a ticker or expiration does not require an account
- overlaying held positions requires an account
- submitting an order requires an execution route
- the tool header may show route and source context, but the chain itself remains tool-centric

### Crypto Tool

Purpose:

- inspect crypto markets without requiring account balances as the default view

Likely crypto tool families:

- `Market`
- `Leverage`

Rules:

- the crypto sidebar group is `Crypto`, not `Coinbase`
- opening a crypto tool from the sidebar must land in a neutral crypto workspace, not a per-account balances page
- if the screen shows Coinbase balances for one account, that is an account-aware crypto state layered on top of a neutral tool
- Coinbase as a connector still belongs in per-account settings
- the existence of a crypto tool does not justify a top-level Coinbase connector workspace

### Stock Research Context

Purpose:

- expose filings, earnings, and research inside stock-oriented workspaces

Rules:

- EDGAR and Investor PDFs remain global data sources and/or supporting research surfaces
- `Earnings`, `Filings`, and `Research` do not need to be parallel top-level sidebar destinations
- they may appear inside `Ticker`
- they may appear inside a unified stock research surface

## Context Model For Tools

Every tool can independently express up to three contexts.

### Data Source

Answers:

- where market or research data comes from

Examples:

- `IBKR Personal`
- `IBKR Primary`
- `EDGAR`
- future absorbed earnings DB

### Execution Route

Answers:

- where an order will go if the user submits one

Examples:

- `U12345678 · Live trading`
- `DU... · Paper trading`

### Overlay Account

Answers:

- which account's positions, orders, or exposures are drawn on top of the tool

Examples:

- `None`
- `Primary`
- `Personal`

These three contexts must never be collapsed into one ambiguous pill.

## Initial Screen Inventory

### Sidebar

- top chrome `Home` control for `Dashboard`
- `Stocks`
  - `Market`
  - `Ticker`
  - options-specific tools or an `Options` subsection
- `Crypto`
  - crypto-specific tools such as `Market` and `Leverage`
- gear button for `Global settings`

### Dashboard

- account tab strip
- account header
- account metrics
- positions
- orders
- overlays
- per-account gear

### Per-Account Settings Sheet / Panel

- account-bound connector list
- route defaults
- risk defaults
- account preferences

### Global Settings Sheet / Panel

- app preferences
- global data source configuration
- EDGAR settings
- Investor PDFs settings
- research-root settings

### Options Tool

- tool header
- data source context
- execution route context
- overlay account context
- ticker lookup
- expiration selection
- chain table
- ticket / builder
- overlays and working orders as optional secondary panels

## Mapping From Current App To Target App

### Current Concepts To Remove

- sidebar connector destinations such as `Interactive Brokers` and `Coinbase`
- generic `Connectors` as a first-class shell idea
- account metadata inside the ticker input row
- options workflow embedded directly under the account dashboard

### Current Concepts To Reclassify

- `EDGAR`:
  - as stock research context and/or supporting research surface
  - as a global data source inside global settings
- `Investor PDFs`:
  - as stock research context and/or supporting research surface
  - as a global data source inside global settings
- `Coinbase`:
  - as an account-bound connector in account settings
  - as a data source usable by crypto tools
- `Interactive Brokers`:
  - as an account-bound connector in account settings
  - as a market data source and execution route used by tools

## Visual And Layout Rules

1. Section headers describe the surface, not the implementation.
2. Connection and account pills live in the header region that owns them, not in lookup controls.
3. The lookup row is reserved for symbol and workflow controls.
4. Tool context badges must be compact and secondary to the main job of the tool.
5. Dashboard tabs must feel like portfolio tabs, not like generic workspaces.
6. A tool header may show context, but must not bury the primary input path.
7. Settings must not leak out of the gear boundary into the main page just because there is spare space.
8. If a surface has a gear for settings, the default page should not also render those same settings inline.

## State Model

### Global Shell State

- `activePrimaryView`
- `globalSettingsOpen`
- `sidebarOpen`

### Dashboard State

- `selectedDashboardAccount`
- `accountSettingsOpenForAccount`

### Tool State

Each tool owns its own state.

The `Options` tool, for example, owns:

- selected ticker
- selected expiration
- selected chain display columns
- selected contract or builder legs
- selected data source
- selected execution route
- selected overlay account

It must not silently borrow `selectedDashboardAccount`.

## Acceptance Criteria

### Architecture Acceptance

This spec is implemented correctly only when all of the following are true:

1. The sidebar contains tools, not connectors.
2. Dashboard supports multiple account tabs.
3. Per-account settings expose only account-bound connectors and account-owned defaults.
4. Global settings expose only product-wide settings and global data sources.
5. The options chain is reachable as a tool without entering an account dashboard.
6. A ticker lookup row contains symbol controls, not account identity pills.
7. `Data source`, `Execution route`, and `Overlay account` can be represented separately in a tool when needed.
8. The main account page contains no connector settings UI.
9. Account-bound connector management is reachable only through that account's gear.
10. Global data-source management is reachable only through the sidebar gear.
11. No primary sidebar destination opens directly into per-account balances or per-account holdings.

### Phase 1 Alignment

This IA exists to support the options workstation plan, not distract from it.

The shell work is successful only if it makes these workflows clearer:

- load any optionable ticker
- inspect a real chain
- change expirations reliably
- load a contract into a ticket
- preview and submit a routed order
- confirm order state in the correct account context

If a shell change makes that harder to find, it violates this spec.

## Implementation Order

Implement this spec in narrow slices.

### Slice 1: Sidebar And Shell

- remove connector-first nav
- install asset-grouped tool nav
- move global data sources behind sidebar gear

### Slice 2: Dashboard Tabs

- make `Dashboard` truly multi-account
- add per-account gear ownership

### Slice 3: Per-Account Settings

- move account-bound connectors under account settings
- remove connector duplication from the shell

### Slice 4: Neutral Tool Workspaces

- move `Options` out of the dashboard
- separate tool context from account identity
- do the same for `Ticker` and `Crypto`

### Slice 5: Context Controls

- add explicit `Data source`
- add explicit `Execution route`
- add explicit `Overlay account`

Each slice must be launched and inspected in the running Tauri app before the next slice begins.

## Non-Goals

This spec does not yet define:

- final visual styling for each tool
- backtest UX
- exact stock-research workflows inside `Ticker`
- exact crypto leverage metrics
- final combined-account aggregation rules

Those are separate product specs that must still obey the ownership rules in this document.
