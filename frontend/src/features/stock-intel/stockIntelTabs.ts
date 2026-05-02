export type StockIntelTab = "sec" | "qwen" | "companyPdfs";

export const stockIntelTabs: Array<{ key: StockIntelTab; label: string }> = [
  { key: "sec", label: "SEC Tool" },
  { key: "companyPdfs", label: "Company PDFs" },
  { key: "qwen", label: "Qwen Intelligence" },
];
