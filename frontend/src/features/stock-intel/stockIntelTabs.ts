export type StockIntelTab = "sec" | "companyPdfs";

export const stockIntelTabs: Array<{ key: StockIntelTab; label: string }> = [
  { key: "sec", label: "SEC Tool" },
  { key: "companyPdfs", label: "Company PDFs" },
];
