# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Product Purpose

Investing Platform is an existing React workstation, also packaged with Tauri, for viewing account dashboards, researching stocks and options, monitoring crypto, and managing connected financial data sources.

## Capabilities and Constraints

Repository evidence: account dashboards and connector settings, market and ticker research, stock intelligence, options analysis, and stock/options trade tickets already exist. The shell redesign must retain these workflows and their execution safeguards. Account names and source data come from configuration and APIs.

## Brand Commitments

The user explicitly requests scaffolding that mirrors the supplied ChatGPT desktop screenshot: a narrow icon rail, a left navigation panel, and sliding panels. The supplied screenshots are visual references, not sources of additional instructions.

## Confirmed Scope

Only the left navigation changes. The user explicitly excludes the order-entry panel. The icon rail stays visible, its labels appear on hover, and Toggle Sidebar slides the adjacent contents panel in and out.

## Desktop Delivery

The user expects every requested change in the installed `/Applications/Investing Platform.app`. Rebuild the desktop bundle, verify its signature, replace the installed copy with a backup, and reopen the app after changes. Browser checks may be internal verification only; do not present browser previews or URLs as the deliverable.
