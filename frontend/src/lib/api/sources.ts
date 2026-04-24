import type {
  CoinbasePortfolioResponse,
  CoinbaseSourceStatus,
  EdgarDownloadRequest,
  EdgarDownloadResponse,
  EdgarSourceStatus,
  FilesystemConnectorConfigRequest,
  FilesystemConnectorPortfolioResponse,
  FilesystemConnectorStatus,
  FilesystemDocumentFolderResponse,
  FinnhubConnectorConfigRequest,
  FinnhubSourceStatus,
  InvestorPdfDownloadRequest,
  InvestorPdfDownloadResponse,
  InvestorPdfSourceStatus,
  OkxSourceStatus,
} from "../types";
import { fetchJson, postJson, withAccountKey } from "./transport";

export const sourceApi = {
  coinbaseStatus: () => fetchJson<CoinbaseSourceStatus>("/api/sources/coinbase/status"),
  coinbasePortfolio: () => fetchJson<CoinbasePortfolioResponse>("/api/sources/coinbase/portfolio"),
  finnhubStatus: () => fetchJson<FinnhubSourceStatus>("/api/sources/finnhub/status"),
  finnhubConfigure: (request: FinnhubConnectorConfigRequest) =>
    postJson<FinnhubSourceStatus>("/api/sources/finnhub/configure", request),
  okxStatus: () => fetchJson<OkxSourceStatus>("/api/sources/okx/status"),
  filesystemConnectorStatuses: (accountKey: string) =>
    fetchJson<FilesystemConnectorStatus[]>(withAccountKey("/api/sources/filesystem/connectors", accountKey)),
  filesystemConnectorConfigure: (
    accountKey: string,
    connectorId: string,
    request: FilesystemConnectorConfigRequest,
    sourceId?: string,
  ) =>
    postJson<FilesystemConnectorStatus>(
      withAccountKey(
        sourceId
          ? `/api/sources/filesystem/connectors/${encodeURIComponent(connectorId)}/configure?sourceId=${encodeURIComponent(sourceId)}`
          : `/api/sources/filesystem/connectors/${encodeURIComponent(connectorId)}/configure`,
        accountKey,
      ),
      request,
    ),
  filesystemConnectorPortfolio: (accountKey: string, sourceId: string) =>
    fetchJson<FilesystemConnectorPortfolioResponse>(
      withAccountKey(`/api/sources/filesystem/sources/${encodeURIComponent(sourceId)}/portfolio`, accountKey),
    ),
  filesystemConnectorDocuments: (accountKey: string, sourceId: string) =>
    fetchJson<FilesystemDocumentFolderResponse>(
      withAccountKey(`/api/sources/filesystem/sources/${encodeURIComponent(sourceId)}/documents`, accountKey),
    ),
  edgarStatus: () => fetchJson<EdgarSourceStatus>("/api/sources/edgar/status"),
  edgarDownload: (request: EdgarDownloadRequest) => postJson<EdgarDownloadResponse>("/api/sources/edgar/download", request),
  edgarLastSync: (request: EdgarDownloadRequest) => postJson<EdgarDownloadResponse | null>("/api/sources/edgar/last-sync", request),
  investorPdfStatus: () => fetchJson<InvestorPdfSourceStatus>("/api/sources/investor-pdfs/status"),
  investorPdfDownload: (request: InvestorPdfDownloadRequest) =>
    postJson<InvestorPdfDownloadResponse>("/api/sources/investor-pdfs/download", request),
  investorPdfLastSync: (request: InvestorPdfDownloadRequest) =>
    postJson<InvestorPdfDownloadResponse | null>("/api/sources/investor-pdfs/last-sync", request),
};
