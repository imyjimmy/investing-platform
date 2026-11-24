---
name: Investing Platform
description: Familiar desktop navigation around an investing workspace.
colors:
  shell: "#181818"
  sidebar: "#242424"
  panel: "#202020"
  panel-soft: "#262626"
  line: "#383838"
  text: "#ededed"
  muted: "#a4a4a4"
  accent: "#dedede"
  safe: "#3bc48d"
  caution: "#f7c85b"
  danger: "#ef6b62"
  nav-text: "#d1d1d1"
  nav-hover: "#2f2f2f"
  nav-active: "#353535"
  rail-active: "#363636"
  control-fill: "#303030"
  control-line: "#555"
  control-hover: "#2f2f2f"
  control-active: "#353535"
  tooltip: "#eee"
  white: "#fff"
typography:
  headline:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: "2.25rem"
    letterSpacing: "0"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
  label:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 400
  tooltip:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.3
  mono:
    fontFamily: '"JetBrains Mono", "SFMono-Regular", monospace'
rounded:
  tooltip: "6px"
  control: "7px"
  input: "8px"
  rail: "10px"
  tab: "8px 8px 0 0"
  card: "16px"
spacing:
  row-gap: "2px"
  icon-gap: "8px"
  row-inset: "10px"
  compact: "12px"
  standard: "16px"
  group-gap: "20px"
  workspace: "24px"
components:
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    size: "34px"
  rail-button:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.rail}"
    size: "40px"
  rail-button-active:
    backgroundColor: "{colors.rail-active}"
    textColor: "{colors.white}"
    rounded: "{rounded.rail}"
    size: "40px"
  nav-row:
    backgroundColor: "transparent"
    textColor: "{colors.nav-text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "7px 10px"
    width: "100%"
  nav-row-hover:
    backgroundColor: "{colors.nav-hover}"
    textColor: "{colors.white}"
  nav-row-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "{colors.white}"
  search:
    backgroundColor: "{colors.control-fill}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.input}"
    padding: "0 0 0 9px"
  workspace-tab:
    backgroundColor: "{colors.panel-soft}"
    textColor: "{colors.muted}"
    rounded: "{rounded.tab}"
    padding: "0 14px"
    height: "40px"
  workspace-tab-active:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
  metric-card:
    backgroundColor: "{colors.panel-soft}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "{spacing.standard}"
  rail-tooltip:
    backgroundColor: "{colors.tooltip}"
    textColor: "{colors.shell}"
    typography: "{typography.tooltip}"
    rounded: "{rounded.tooltip}"
    padding: "7px 10px"
---

# Design System: Investing Platform

## Overview

The user's ChatGPT desktop reference fixes the shell's visual direction: charcoal navigation, a near-black workspace, system typography, and restrained outline icons. Compact controls and tonal selection states keep the investing content prominent.

This record extracts the implemented system from `frontend/src/index.css`, `frontend/tailwind.config.ts`, and `frontend/src/components/shell/`. Existing financial colors retain their meaning. The left navigation behavior is defined in `.impeccable/shell-brief.md`; the right order-entry panel retains its existing interactions.

**Key Characteristics:**

- Persistent icon navigation with hover and keyboard-focus titles.
- Compact rows, quiet separators, and rounded control states.
- Flat workspace surfaces with independent scrolling.
- Financial status colors distinct from neutral navigation states.

## Colors

The palette uses charcoal surface layers and silver text; semantic financial colors remain visible within that neutral frame.

### Primary

- **Silver accent** (`accent`): the existing shared highlight token.
- **Financial status** (`safe`, `caution`, `danger`): preserve existing positive, caution, and negative meanings; account icons also use `safe`.

### Neutral

- **Workspace charcoal** (`shell`), **navigation charcoal** (`sidebar`), and **panel layers** (`panel`, `panel-soft`) separate the work area from navigation and data containers.
- **Primary text** (`text`), **muted text** (`muted`), and **navigation text** (`nav-text`) establish hierarchy without decorative accents.
- **Dividers** (`line`) and **control borders** (`control-line`) delineate containers and search.
- **Navigation hover and selection** (`nav-hover`, `nav-active`, `rail-active`) brighten the surface and use `white` text.
- **Control fill** (`control-fill`) fills search. Workspace tabs use `panel-soft`, with `panel` for the selected tab. **Tooltip light** (`tooltip`) inverts the rail label against the dark shell.
- **Control states** (`control-hover`, `control-active`) provide shared neutral hover and active fills for navigation and menus. Floating menus and chart tooltips use `panel-soft`, `line`, `text`, and `muted`; avoid hardcoded colors from older themes.

## Typography

The native system stack is the body and heading face. JetBrains Mono, with SFMono-Regular and monospace fallbacks, remains available for existing numeric and code-like content. There is no separate display typeface.

The frontmatter's `headline` role is the workspace title. Navigation uses `body`, while group headings and search use `label`. The macOS title bar hides its visible window title, retaining the app identity in system menus and the Dock. Sidebar text identifies actions and destinations rather than repeating branding. Tooltips use a slightly heavier label. Existing workspace descriptions use 14px type with 20px line-height. Keep the existing uppercase, tracked financial labels within their data components.

## Layout

The viewport shell is a three-column grid: a persistent 52px icon rail, a left navigation panel, and a flexible workspace. On macOS, a 48px integrated title bar contains the real traffic-light window controls and the sidebar toggle at x=88px. Its empty area supports native window dragging and double-click behavior. Navigation begins below it with Dashboard and a secondary search icon on one line. The main workspace starts directly below the title bar, with a straight sidebar boundary and existing attached tabs; there is no history toolbar. Web builds retain their ordinary sidebar toggle and full-height workspace. The navigation defaults to 256px and resizes from 220px to 380px; collapsed navigation occupies zero width while the rail stays visible.

Navigation and workspace scroll independently. The workspace inner frame centers at a maximum width of 1680px. Outer stage padding is 8px 28px 48px; at viewport widths up to 1100px it becomes 8px 16px 40px, and at 760px or below it becomes 8px 8px 32px. Shared inner content padding adapts separately through the workspace CSS variables.

At 760px or below, navigation becomes a dismissible drawer beside the rail, starting at the top edge beside the persistent toggle. Its width is the smaller of 290px and the viewport width minus 68px. The underlying rail and workspace become inert while it is open. Navigation rows grow from a minimum height of 36px to 42px. Account summaries respond to workspace container width: four columns normally, two at 1050px or below, and one at 540px or below.

## Elevation & Depth

The shell uses tonal layering and fine dividers for depth. Untabbed workspace frames are transparent, borderless, square, and shadowless. Attached workspace tabs connect to a filled panel with a 1px divider-colored border and 16px corners. Tabs have a subtle top highlight; the active tab shares the panel fill and has no bottom border. Metric cards retain their filled surface and border. Rail tooltips use a small shadow (`0 4px 12px #0003`); the narrow-screen drawer uses a dark backdrop. The configured panel shadow is available in Tailwind but is not applied to the shell. Avoid adding elevation to ordinary navigation rows.

## Shapes

Controls use the modest curves recorded in `rounded`: icon buttons and navigation rows share the control radius; attached tabs have 8px upper corners and square lower corners; search uses the input radius; rail controls and the drawer's outer corners use the rail radius. Metric cards retain the larger card radius. The sidebar-to-workspace boundary is straight. Attached content panels retain their rounded corners. Outline icons use rounded stroke caps and joins, with a 1.65px stroke on a 24-unit view box. The Options icon is a call-payoff shape: a horizontal segment followed by a straight rising diagonal at the strike, with simple chart axes.

## Components

- **Icon buttons:** transparent, muted controls for search and sidebar toggle. The title-bar toggle uses a 16px icon centered within its 34px click target, aligned with the native window controls. Hover adds a translucent white surface and white icon; disabled controls use 0.3 opacity. Global keyboard focus uses a visible outline.
- **Icon rail:** persistent primary destinations with 40px targets and 22px icons. Hover and selected states share the rail fill. Selected destinations expose `aria-current`. Crypto remains in the expandable navigation, without its own rail icon. Settings stay at the bottom. Titles appear after a 180ms delay on hover or keyboard focus; they are hidden at the drawer breakpoint.
- **Navigation rows:** compact, left-aligned labels with 18px icons and ellipsis for long names. Hover and current states use their distinct neutral fills. Group headings collapse their contents and remember that preference; search temporarily expands matching groups.
- **Search:** an icon beside Dashboard opens workspace search, also available through Cmd/Ctrl+K. Opening search replaces that navigation header in place with a bordered, filled field, a 36px input, search icon, and close control. Focus outlines the whole field. Search filters the configured accounts and workspace names, including an explicit empty result message.
- **Workspace tabs:** preserve the user's raised, attached tab reference. Tabs are 40px tall, at least 180px wide, spaced 6px apart, with rounded upper corners and square lower corners. A 1px outline and subtle top highlight provide depth. The selected tab shares the content-panel background and overlaps its top border by 1px. Tab strips scroll horizontally on narrow screens. Focus stays inside the tab so it is not clipped; disabled tabs use 0.5 opacity.
- **Metric cards:** soft panel fill, a single divider-colored border, and standard padding. The compact uppercase label sits above a semibold value; existing tone variants color financial values.
- **Period menu:** retain the compact uppercase trigger within the metric heading, but use ordinary title-case 13px/20px text inside the popup. The menu uses the shared charcoal surface and active-control fill, 36px rows, and a checkmark for the selected period. Hover and keyboard navigation share the same active treatment. Each card retains its own period selection.
- **Chart overlays:** use the same neutral surface, divider, and text tokens as menus. The beta chart uses silver for magnitude; financial gain/loss and warning colors retain their semantic meanings elsewhere.
- **Left panel:** Toggle Sidebar or Cmd/Ctrl+B slides the navigation panel while retaining the rail. Cmd/Ctrl+K opens search. Desktop width and open state persist. Its separator supports pointer dragging, 16px arrow-key steps, Home/End limits, and double-click reset. Narrow-screen selection, backdrop click, and Escape dismiss the drawer; keyboard focus is contained while open and returns to the toggle on dismissal.

The sidebar slides over 220ms with `cubic-bezier(0.16, 1, 0.3, 1)`; ordinary color and opacity states use 140ms easing. Resizing suppresses the grid transition. Reduced-motion preferences disable shell transitions and animation. These timings, focus treatments, and responsive conditions live in the sidecar extensions rather than the frontmatter token schema.

## Do's and Don'ts

### Do:

- Do preserve the supplied ChatGPT desktop reference when extending the shell.
- Do keep the icon rail visible when the left navigation panel collapses.
- Do preserve financial color meanings, accessible labels, and visible keyboard focus.
- Do use the existing system type, compact spacing, and neutral state fills for shared navigation.

### Don't:

- Don't extend left-panel interaction changes to the right order-entry panel.
- Don't use financial status colors as decorative navigation accents.
- Don't flatten attached workspace tabs into pills or separate the active tab from its panel.
- Don't rely on hover titles as the only accessible names for icon controls.
