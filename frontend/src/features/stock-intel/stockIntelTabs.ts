export type StockIntelTab = "sec" | "qwen" | "companyPdfs";

export const stockIntelTabs: Array<{ key: StockIntelTab; label: string }> = [
  { key: "sec", label: "SEC filings" },
  { key: "companyPdfs", label: "Company PDFs" },
  { key: "qwen", label: "Ask filings" },
];
