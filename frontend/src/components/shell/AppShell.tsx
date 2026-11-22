import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  AppSidebarNavigation,
  type AppSidebarProps,
  type WorkspaceSurface,
} from "./AppSidebarNavigation";
import { ShellIcon, type ShellIconName } from "./ShellIcon";
import { PanelResizeHandle } from "./PanelResizeHandle";
import {
  isBoolean,
  isPanelWidth,
  useShellPreference,
} from "./useShellPreferences";

type Props = Omit<AppSidebarProps, "search"> & {
  children: ReactNode;
};

const railItems: {
  key: WorkspaceSurface;
  label: string;
  icon: ShellIconName;
}[] = [
  { key: "dashboard", label: "Go to dashboard", icon: "home" },
  { key: "market", label: "Stocks", icon: "market" },
  { key: "options", label: "Options", icon: "options" },
  { key: "stockIntel", label: "Stock intelligence", icon: "document" },
];

export function AppShell({ children, ...navigation }: Props) {
  const [desktopOpen, setDesktopOpen] = useShellPreference(
    "investing.shell.sidebar.v1",
    true,
    isBoolean,
  );
  const [sidebarWidth, setSidebarWidth] = useShellPreference(
    "investing.shell.width.v1",
    256,
    isPanelWidth,
  );
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 760px)").matches,
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const sidebarOpen = narrow ? mobileOpen : desktopOpen;
  const activeRailKey = navigation.activeWorkspace.startsWith("options")
    ? "options"
    : navigation.activeWorkspace === "ticker"
      ? "market"
      : navigation.activeWorkspace;
  function setOpen(open: boolean) {
    if (narrow) setMobileOpen(open);
    else setDesktopOpen(open);
  }
  function closeDrawer() {
    setMobileOpen(false);
    toggleRef.current?.focus();
  }
  function openSearch() {
    setOpen(true);
    setSearchOpen(true);
  }
  function selectWorkspace(workspace: WorkspaceSurface) {
    navigation.onSelectWorkspace(workspace);
    if (narrow) closeDrawer();
  }
  function selectAccount(key: string) {
    navigation.onSelectAccount(key);
    if (narrow) closeDrawer();
  }

  useEffect(() => {
    const media = window.matchMedia("(max-width: 760px)");
    const update = () => {
      setNarrow(media.matches);
      setMobileOpen(false);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (searchOpen && sidebarOpen) searchRef.current?.focus();
  }, [searchOpen, sidebarOpen]);
  useEffect(() => {
    stageRef.current?.scrollTo({ top: 0 });
  }, [navigation.activeWorkspace, navigation.selectedAccountKey]);
  useEffect(() => {
    if (narrow && sidebarOpen && !searchOpen)
      sidebarRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [narrow, sidebarOpen, searchOpen]);
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setOpen(!sidebarOpen);
        toggleRef.current?.focus();
      }
      if (command && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearch();
        searchRef.current?.focus();
      }
      if (
        event.key === "Escape" &&
        (narrow ||
          sidebarRef.current?.contains(document.activeElement) ||
          document.activeElement === toggleRef.current)
      ) {
        if (searchOpen) {
          setSearchOpen(false);
          setSearch("");
          sidebarRef.current
            ?.querySelector<HTMLButtonElement>("[data-search-trigger]")
            ?.focus();
        } else if (sidebarOpen) {
          setOpen(false);
          toggleRef.current?.focus();
        }
      }
      if (event.key === "Tab" && narrow && sidebarOpen) {
        const controls = [
          toggleRef.current,
          ...Array.from(
            sidebarRef.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input, [tabindex="0"]',
            ) ?? [],
          ),
        ].filter(Boolean) as HTMLElement[];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  return (
    <div
      className={`app-shell ${sidebarOpen ? "is-sidebar-open" : ""}`}
      style={{ "--sidebar-open-width": `${sidebarWidth}px` } as CSSProperties}
    >
      <a href="#workspace-content" className="shell-skip-link">
        Skip to workspace
      </a>
      <div className="shell-topbar">
        <button
          ref={toggleRef}
          aria-controls="app-sidebar"
          aria-expanded={sidebarOpen}
          aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          className="shell-icon-button"
          onClick={() => setOpen(!sidebarOpen)}
          title="Toggle sidebar (⌘/Ctrl B)"
          type="button"
        >
          <ShellIcon name="sidebar" />
        </button>
      </div>
      <nav
        aria-label="Primary navigation"
        className="shell-icon-rail"
        {...(narrow && sidebarOpen ? { inert: "" } : {})}
      >
        {railItems.map((item) => (
          <button
            key={item.key}
            className={`shell-rail-button ${activeRailKey === item.key ? "is-active" : ""}`}
            aria-current={activeRailKey === item.key ? "page" : undefined}
            aria-label={item.label}
            onClick={() => selectWorkspace(item.key)}
            type="button"
          >
            <ShellIcon name={item.icon} />
            <span className="shell-rail-tooltip" aria-hidden="true">
              {item.label === "Go to dashboard" ? "Dashboard" : item.label}
            </span>
          </button>
        ))}
        <div className="shell-rail-spacer" />
        <button
          className={`shell-rail-button ${navigation.activeWorkspace === "globalSettings" ? "is-active" : ""}`}
          aria-label="Settings"
          aria-current={activeRailKey === "globalSettings" ? "page" : undefined}
          onClick={() => selectWorkspace("globalSettings")}
          type="button"
        >
          <ShellIcon name="settings" />
          <span className="shell-rail-tooltip" aria-hidden="true">
            Settings
          </span>
        </button>
      </nav>
      {narrow && sidebarOpen ? (
        <div
          className="shell-drawer-backdrop"
          onClick={closeDrawer}
          aria-hidden="true"
        />
      ) : null}
      <div
        className="shell-sidebar-wrap"
        {...(!sidebarOpen ? { inert: "" } : {})}
      >
        <aside
          id="app-sidebar"
          ref={sidebarRef}
          className="shell-sidebar"
          aria-label="Workspace navigation"
          role={narrow && sidebarOpen ? "dialog" : undefined}
          aria-modal={narrow && sidebarOpen ? true : undefined}
          aria-hidden={!sidebarOpen}
        >
          <div className="shell-sidebar-tools">
            {!searchOpen ? (
              <button
                className="shell-sidebar-home"
                aria-current={
                  navigation.activeWorkspace === "dashboard"
                    ? "page"
                    : undefined
                }
                onClick={() => selectWorkspace("dashboard")}
                type="button"
              >
                Dashboard
              </button>
            ) : null}
            <div
              className={searchOpen ? "shell-search" : "shell-sidebar-actions"}
            >
              <button
                data-search-trigger
                aria-label="Search workspaces"
                className="shell-icon-button"
                onClick={openSearch}
                title="Search workspaces (⌘/Ctrl K)"
                type="button"
              >
                <ShellIcon name="search" />
              </button>
              {searchOpen ? (
                <>
                  <input
                    ref={searchRef}
                    aria-label="Search workspaces"
                    placeholder="Search workspaces…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                  <button
                    aria-label="Close search"
                    className="shell-icon-button"
                    onClick={() => {
                      setSearchOpen(false);
                      setSearch("");
                      sidebarRef.current
                        ?.querySelector<HTMLButtonElement>(
                          "[data-search-trigger]",
                        )
                        ?.focus();
                    }}
                    type="button"
                  >
                    <ShellIcon name="close" />
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <div className="shell-sidebar-scroll">
            <AppSidebarNavigation
              {...navigation}
              onSelectWorkspace={selectWorkspace}
              onSelectAccount={selectAccount}
              search={search}
            />
          </div>
          <div className="shell-sidebar-footer">
            <button
              className={`shell-nav-row ${navigation.activeWorkspace === "globalSettings" ? "is-active" : ""}`}
              onClick={() => selectWorkspace("globalSettings")}
              type="button"
            >
              <ShellIcon name="settings" />
              <span>Global Settings</span>
            </button>
          </div>
        </aside>
        {sidebarOpen && !narrow ? (
          <PanelResizeHandle
            label="Resize navigation"
            controls="app-sidebar"
            width={sidebarWidth}
            min={220}
            max={380}
            defaultWidth={256}
            onResize={setSidebarWidth}
          />
        ) : null}
      </div>
      <main
        id="workspace-content"
        tabIndex={-1}
        ref={stageRef}
        className="shell-stage"
        {...(narrow && sidebarOpen ? { inert: "" } : {})}
      >
        {children}
      </main>
    </div>
  );
}
