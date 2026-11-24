export type ShellIconName =
  | "home"
  | "market"
  | "ticker"
  | "document"
  | "options"
  | "builder"
  | "grid"
  | "wave"
  | "search"
  | "crypto"
  | "settings"
  | "sidebar"
  | "chevron"
  | "account"
  | "close";

const paths: Record<ShellIconName, string> = {
  home: "m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9",
  market: "M4 19h16M5 15l5-6 4 3 6-8M15 4h5v5",
  ticker: "M4 20h16M6 16v-5m6 5V4m6 12V8",
  document: "M6 3h8l4 4v14H6V3Zm8 0v5h4M9 12h6m-6 4h6",
  options: "M3 4v16h18M5 16h6L21 6",
  builder: "M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-7 0v6",
  grid: "M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z",
  wave: "M2 12h3l3-8 4 16 4-12 3 4h3",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  crypto: "M12 2v20M8 6h7a3 3 0 0 1 0 6H8m0 0h8a3 3 0 0 1 0 6H8M9 6v12",
  settings:
    "m10 3-1 3-3-1-2 4 2 2-2 2 2 4 3-1 1 3h4l1-3 3 1 2-4-2-2 2-2-2-4-3 1-1-3h-4ZM15 11a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  sidebar:
    "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm3 0v16",
  chevron: "m8 10 4 4 4-4",
  account:
    "M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0ZM15 8H10a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H9m3-10v12",
  close: "m6 6 12 12M6 18 18 6",
};

export function ShellIcon({ name }: { name: ShellIconName }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      viewBox="0 0 24 24"
      width="20"
      height="20"
    >
      <path
        d={paths[name]}
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
