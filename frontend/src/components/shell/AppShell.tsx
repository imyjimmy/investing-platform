import { useEffect, useState, type ReactNode } from "react";

type AppShellProps = {
  activeIsHome: boolean;
  children: ReactNode;
  footer: ReactNode;
  onHome: () => void;
  sidebar: ReactNode;
};

export function AppShell({ activeIsHome, children, footer, onHome, sidebar }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (!sidebarOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSidebarOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sidebarOpen]);

  return (
    <div className={`app-shell grid-shell min-h-screen text-text ${sidebarOpen ? "is-sidebar-open" : ""}`}>
      <div className="shell-topbar">
        <div className="shell-topbar-inner mx-auto w-full max-w-[1880px]">
          <button
            aria-expanded={sidebarOpen}
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            className="shell-toggle"
            onClick={() => setSidebarOpen((value) => !value)}
            type="button"
          >
            <SidebarToggleIcon open={sidebarOpen} />
          </button>
          <button
            aria-label="Go to dashboard"
            aria-pressed={activeIsHome}
            className={`shell-toggle shell-home-button ${activeIsHome ? "is-active" : ""}`}
            onClick={onHome}
            type="button"
          >
            <HomeIcon />
          </button>
          <div className="shell-topbar-spacer" />
        </div>
      </div>

      <div className="mx-auto w-full max-w-[1880px]">
        <div className="shell-frame">
          <div className="shell-sidebar-wrap">
            <aside aria-label="App shell" className="shell-sidebar">
              <div className="shell-sidebar-body">
                <div className="shell-sidebar-scroll">{sidebar}</div>
                <div className="shell-sidebar-footer">{footer}</div>
              </div>
            </aside>
          </div>

          <div className="shell-stage">{children}</div>
        </div>
      </div>
    </div>
  );
}

function SidebarToggleIcon({ open }: { open: boolean }) {
  const panelX = open ? 5.15 : 7.35;
  const panelWidth = open ? 4.15 : 2.1;

  return (
    <svg aria-hidden="true" fill="none" height="24" viewBox="0 0 24 24" width="24">
      <rect height="17" rx="4.5" stroke="currentColor" strokeWidth="1.75" width="17" x="3.5" y="3.5" />
      <rect fill="currentColor" height="13.2" rx="1.2" width={panelWidth} x={panelX} y="5.4" />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="24" viewBox="0 0 24 24" width="24">
      <path
        d="M3.9 10.6 12 4.1l8.1 6.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d="M5.55 10v9h12.9v-9"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path d="M9.25 19v-5.3h5.5V19" stroke="currentColor" strokeLinejoin="round" strokeWidth="2" />
    </svg>
  );
}
