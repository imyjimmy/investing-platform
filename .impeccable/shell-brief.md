# Investing workspace shell

Mode: Operate. Scope: the app shell and shared workspace chrome.

## Direction contract

THESIS: Match the user's supplied desktop app reference with direct, familiar navigation around the existing investing workflows.

OWN-WORLD: Charcoal navigation, near-black workspace, system UI type, muted monochrome outline icons, compact rows, subtle separators, and rounded hover/selected states. Financial colors keep their existing semantic meaning.

STORY: Choose an account or investing tool, switch between grouped tools, and resize or collapse the left panel to give the analysis room. The right order-entry panel retains its existing interactions.

FIRST VIEWPORT: A 52px icon rail sits beside a 256px navigation panel. A 48px integrated macOS title bar places the sidebar toggle beside the real traffic-light window controls and hides the visible window title. Below it, the sidebar starts with Dashboard and a secondary search icon on one line, followed by account shortcuts and grouped tools. The main workspace starts below the title bar with its existing attached tabs and scrolls independently. The sidebar-to-content edge is straight; there is no back/forward toolbar or repeated account label. Settings remain anchored at the bottom.

FORM: The reference screenshot supplied by the user fixes the visual system and composition; no alternative visual direction is being selected. Build directly from that reference.

SIGNATURE INTERACTION: Left sidebar slides closed while the rail stays available; the navigation separator supports pointer and keyboard resizing, and the left panel remembers its width. Narrow screens use a dismissible navigation drawer.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

User correction: Crypto stays within the expandable sidebar and has no dedicated icon-rail button. Main-content switching preserves raised, attached tabs with rounded upper corners, as shown in the supplied Van Aken / Personal reference.

User correction: Omit Recents and stop recording recent workspaces.
