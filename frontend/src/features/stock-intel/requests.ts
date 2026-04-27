import type { EdgarDownloadRequest, InvestorPdfDownloadRequest } from "../../lib/types";

import type { StockIntelLookupMode } from "./issuer";

type EdgarDownloadMode = NonNullable<EdgarDownloadRequest["downloadMode"]>;

export function parseEdgarFormTypes(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]+/)
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean),
    ),
  );
}

export function buildEdgarDownloadRequest({
  cik,
  companyName,
  downloadMode,
  endDate,
  formTypes,
  includeExhibits,
  lookupMode,
  outputDir,
  resume,
  startDate,
  ticker,
}: {
  cik: string;
  companyName: string;
  downloadMode: EdgarDownloadMode;
  endDate: string;
  formTypes: string[];
  includeExhibits: boolean;
  lookupMode: StockIntelLookupMode;
  outputDir: string;
  resume: boolean;
  startDate: string;
  ticker: string;
}): EdgarDownloadRequest {
  const request: EdgarDownloadRequest = {
    downloadMode,
    includeExhibits,
    resume,
  };

  if (lookupMode === "ticker" && ticker) {
    request.ticker = ticker;
  }
  if (lookupMode === "companyName" && companyName) {
    request.companyName = companyName;
  }
  if (lookupMode === "cik" && cik) {
    request.cik = cik;
  }
  if (formTypes.length > 0) {
    request.formTypes = formTypes;
  }
  if (startDate) {
    request.startDate = startDate;
  }
  if (endDate) {
    request.endDate = endDate;
  }
  if (outputDir) {
    request.outputDir = outputDir;
  }
  return request;
}

export function buildInvestorPdfDownloadRequest({
  cik,
  companyName,
  endDate,
  includeAnnualReports,
  includeCompanyReports,
  includeEarningsDecks,
  includeInvestorPresentations,
  includeSecExhibits,
  forceRefresh,
  lookbackYears,
  lookupMode,
  outputDir,
  resume,
  seedUrl,
  startDate,
  ticker,
}: {
  cik: string;
  companyName: string;
  endDate?: string;
  includeAnnualReports: boolean;
  includeCompanyReports: boolean;
  includeEarningsDecks: boolean;
  includeInvestorPresentations: boolean;
  includeSecExhibits: boolean;
  forceRefresh: boolean;
  lookbackYears: number;
  lookupMode: StockIntelLookupMode;
  outputDir?: string;
  resume: boolean;
  seedUrl?: string;
  startDate?: string;
  ticker: string;
}): InvestorPdfDownloadRequest {
  const request: InvestorPdfDownloadRequest = {
    includeAnnualReports,
    includeCompanyReports,
    includeEarningsDecks,
    includeInvestorPresentations,
    includeSecExhibits,
    forceRefresh,
    lookbackYears,
    resume,
  };

  if (lookupMode === "ticker" && ticker) {
    request.ticker = ticker;
  }
  if (lookupMode === "companyName" && companyName) {
    request.companyName = companyName;
  }
  if (lookupMode === "cik" && cik) {
    request.cik = cik;
  }
  if (startDate) {
    request.startDate = startDate;
  }
  if (endDate) {
    request.endDate = endDate;
  }
  if (outputDir) {
    request.outputDir = outputDir;
  }
  if (seedUrl) {
    request.seedUrl = seedUrl;
  }
  return request;
}

export function isStockFolderTemplate(value: string) {
  const normalized = value.trim().replace(/\/+$/, "");
  return normalized.endsWith("/stocks/[ticker]");
}

export function deriveOutputRootFromStockTemplate(template: string, fallback: string | undefined) {
  const normalized = template.trim().replace(/\/+$/, "");
  if (normalized.endsWith("/stocks/[ticker]")) {
    return normalized.slice(0, -"/stocks/[ticker]".length) || "/";
  }
  return fallback;
}

export function materializeStockFolder(template: string, ticker: string) {
  return template.replaceAll("[ticker]", ticker);
}
