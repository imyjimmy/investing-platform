import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type PnlPeriod = "month" | "quarter";
const PnlPeriodContext = createContext<{ period: PnlPeriod; setPeriod: (period: PnlPeriod) => void } | null>(null);

/** All source cards share the period so the account total remains comparable. */
export function PnlPeriodProvider({ children }: { children: ReactNode }) {
  const [period, setPeriod] = useState<PnlPeriod>("month");
  const value = useMemo(() => ({ period, setPeriod }), [period]);
  return <PnlPeriodContext.Provider value={value}>{children}</PnlPeriodContext.Provider>;
}

export function usePnlPeriod() {
  const context = useContext(PnlPeriodContext);
  if (!context) throw new Error("P&L cards must be inside PnlPeriodProvider");
  return context;
}

const PERIOD_OPTIONS: { value: PnlPeriod; label: string }[] = [
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
];

export function PnlPeriodControl() {
  const { period, setPeriod } = usePnlPeriod();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLSpanElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  function showOptions() {
    setActiveIndex(PERIOD_OPTIONS.findIndex((option) => option.value === period));
    setOpen(true);
  }

  function choose(index: number) {
    setPeriod(PERIOD_OPTIONS[index].value);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "Escape") {
      if (open) event.stopPropagation();
      setOpen(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(activeIndex);
      else showOptions();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) showOptions();
      else setActiveIndex((index) => (index + 1) % PERIOD_OPTIONS.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(event.key === "Home" ? 0 : PERIOD_OPTIONS.length - 1);
    } else if (event.key.toLowerCase() === "m" || event.key.toLowerCase() === "q") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex(event.key.toLowerCase() === "m" ? 0 : 1);
    }
  }

  return (
    <span className="pnl-period-heading" ref={rootRef}>
      <span className="pnl-period-anchor">
        <button
          type="button"
          role="combobox"
          aria-label="P&L period"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={listId}
          aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined}
          className="pnl-period-word"
          onClick={() => open ? setOpen(false) : showOptions()}
          onKeyDown={handleKeyDown}
          onBlur={() => setOpen(false)}
        >
          <span>{period === "month" ? "Month" : "Quarter"}</span>
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
        {open ? (
          <span id={listId} role="listbox" aria-label="P&L period" className="pnl-period-menu">
            {PERIOD_OPTIONS.map((option, index) => (
              <span
                id={`${listId}-${index}`}
                key={option.value}
                role="option"
                aria-selected={period === option.value}
                className={`pnl-period-option${activeIndex === index ? " is-active" : ""}`}
                onPointerMove={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(index)}
              >
                <span>{option.label}</span>
                {period === option.value ? (
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="m5 12 4 4L19 6" />
                  </svg>
                ) : null}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      <span>PNL</span>
    </span>
  );
}

/** Deliberately visual-only until chart content is available. */
export function PnlViewToggle() {
  const [chart, setChart] = useState(false);
  return (
    <button
      type="button"
      className="pnl-view-switch"
      role="switch"
      aria-label="Chart view"
      aria-checked={chart}
      title="View preview — card content stays the same"
      onClick={() => setChart((value) => !value)}
    >
      <span className="pnl-view-icon" aria-hidden="true">
        <span className="pnl-summary-lines"><span /><span /><span /></span>
      </span>
      <span className="pnl-view-icon" aria-hidden="true">
        <svg width="20" height="18" viewBox="0 0 28 22" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 2.5V19H26" strokeWidth="1.65375" opacity="0.65" />
          <path d="M6 14L11 9L16 13L24 5" strokeWidth="1.65375" />
        </svg>
      </span>
    </button>
  );
}
