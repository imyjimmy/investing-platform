export function TradeRailToggleIcon({ open }: { open: boolean }) {
  const panelWidth = open ? 4.2 : 2.05;
  const panelX = 17.7 - panelWidth;

  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
      <rect height="17" rx="4.5" stroke="currentColor" strokeWidth="1.75" width="17" x="3.5" y="3.5" />
      <rect fill="currentColor" height="13.2" rx="1.2" width={panelWidth} x={panelX} y="5.4" />
    </svg>
  );
}
