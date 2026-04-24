import type { EdgarDownloadResponse, InvestorPdfDownloadResponse } from "../../lib/types";

export type StockIntelLookupMode = "ticker" | "companyName" | "cik";

export const stockIntelLookupOptions: Array<{ label: string; value: StockIntelLookupMode }> = [
  { value: "ticker", label: "Ticker" },
  { value: "companyName", label: "Company" },
  { value: "cik", label: "CIK" },
];

type StockIntelIssuer = {
  cik: string;
  companyName: string;
  lookupMode: StockIntelLookupMode;
  ticker: string;
};

export function matchesEdgarIssuer(syncResult: EdgarDownloadResponse | undefined, issuer: StockIntelIssuer) {
  if (!syncResult) {
    return false;
  }
  if (issuer.lookupMode === "ticker") {
    return !issuer.ticker || syncResult.ticker === issuer.ticker;
  }
  if (issuer.lookupMode === "cik") {
    const normalizedSyncCik = syncResult.cik.replace(/^0+/, "");
    const normalizedInputCik = issuer.cik.replace(/^0+/, "");
    return !normalizedInputCik || normalizedSyncCik === normalizedInputCik;
  }
  if (!issuer.companyName) {
    return true;
  }
  return normalizeIssuerName(syncResult.companyName) === normalizeIssuerName(issuer.companyName);
}

export function matchesInvestorPdfIssuer(response: InvestorPdfDownloadResponse | undefined, issuer: StockIntelIssuer) {
  if (!response) {
    return false;
  }
  if (issuer.lookupMode === "ticker") {
    return response.ticker === issuer.ticker;
  }
  if (issuer.lookupMode === "companyName") {
    return response.companyName.toLowerCase() === issuer.companyName.toLowerCase();
  }
  return response.cik === issuer.cik;
}

function normalizeIssuerName(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}
