import type { ReactNode } from "react";

import type {
  FilesystemConnectorPortfolioResponse,
  FilesystemConnectorStatus,
  FilesystemDocumentFolderResponse,
  FilesystemHolding,
} from "../../lib/types";
import { getConnectorCatalogEntry, type ConnectorCatalogId } from "../../config/connectorCatalog";
import { AccountSourceSummaryCards } from "./AccountSourceSummaryCards";
import { MetricCard } from "../MetricCard";

const PDF_FOLDER_CONNECTOR_ID: ConnectorCatalogId = "pdfFolder";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const currencySmall = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const number = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
});

type HoldingColumn = {
  id: string;
  label: string;
  className?: string;
  hideWhenStatic?: boolean;
  value: (holding: FilesystemHolding) => string | number | null | undefined;
  render: (holding: FilesystemHolding) => ReactNode;
};

interface FilesystemAccountSourceContentProps {
  status: FilesystemConnectorStatus | undefined;
  statusesLoading: boolean;
  statusesError: string | null;
  localBackendUnavailable: boolean;
  localBackendError: string | null;
  portfolio: FilesystemConnectorPortfolioResponse | undefined;
  portfolioLoading: boolean;
  portfolioError: string | null;
  documentFolder: FilesystemDocumentFolderResponse | undefined;
  documentFolderLoading: boolean;
  documentFolderError: string | null;
  totalPnl: number | null;
  todayPnl: number | null;
  monthlyPnl: number | null;
  totalPnlPct: number | null;
  todayPnlPct: number | null;
  monthlyPnlPct: number | null;
  netWorth: number | null;
}

export function FilesystemAccountSourceContent({
  status,
  statusesLoading,
  statusesError,
  localBackendUnavailable,
  localBackendError,
  portfolio,
  portfolioLoading,
  portfolioError,
  documentFolder,
  documentFolderLoading,
  documentFolderError,
  totalPnl,
  todayPnl,
  monthlyPnl,
  totalPnlPct,
  todayPnlPct,
  monthlyPnlPct,
  netWorth,
}: FilesystemAccountSourceContentProps) {
  const connector = status ? getConnectorCatalogEntry(status.connectorId as ConnectorCatalogId) : null;

  if (localBackendUnavailable) {
    return (
      <div className="grid gap-4">
        <AccountSourceSummaryCards monthlyPnl={monthlyPnl} monthlyPnlPct={monthlyPnlPct} netWorth={netWorth} todayPnl={todayPnl} todayPnlPct={todayPnlPct} totalPnl={totalPnl} totalPnlPct={totalPnlPct} />
        <ErrorState message={localBackendError ?? statusesError ?? portfolioError ?? documentFolderError ?? "The local backend is unavailable."} />
      </div>
    );
  }

  if (statusesLoading) {
    return (
      <div className="grid gap-4">
        <AccountSourceSummaryCards monthlyPnl={monthlyPnl} monthlyPnlPct={monthlyPnlPct} netWorth={netWorth} todayPnl={todayPnl} todayPnlPct={todayPnlPct} totalPnl={totalPnl} totalPnlPct={totalPnlPct} />
        <div className="text-sm text-muted">Checking filesystem connectors...</div>
      </div>
    );
  }

  if (!status) {
    return (
      <div className="grid gap-4">
        <AccountSourceSummaryCards monthlyPnl={monthlyPnl} monthlyPnlPct={monthlyPnlPct} netWorth={netWorth} todayPnl={todayPnl} todayPnlPct={todayPnlPct} totalPnl={totalPnl} totalPnlPct={totalPnlPct} />
        <ErrorState message="This filesystem connector source could not be found." />
      </div>
    );
  }

  if (!status.available) {
    return (
      <div className="grid gap-4">
        <AccountSourceSummaryCards monthlyPnl={monthlyPnl} monthlyPnlPct={monthlyPnlPct} netWorth={netWorth} todayPnl={todayPnl} todayPnlPct={todayPnlPct} totalPnl={totalPnl} totalPnlPct={totalPnlPct} />
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard label="Connector" value="Not configured" />
          <MetricCard label="Provider" value={connector?.provider ?? "Filesystem"} />
          <MetricCard label="Folder" value="Add a path in Settings" />
        </div>
        <ErrorState message={statusesError ?? status.detail ?? "Filesystem connector is unavailable."} />
      </div>
    );
  }

  if (!status.connected) {
    return (
      <div className="grid gap-4">
        <AccountSourceSummaryCards monthlyPnl={monthlyPnl} monthlyPnlPct={monthlyPnlPct} netWorth={netWorth} todayPnl={todayPnl} todayPnlPct={todayPnlPct} totalPnl={totalPnl} totalPnlPct={totalPnlPct} />
        <div className="grid gap-4 md:grid-cols-3">
          <MetricCard label="Connector" value={status.displayName ?? connector?.dashboardTitle ?? "CSV Folder"} />
          <MetricCard label="Provider" value={connector?.provider ?? "Filesystem"} />
          <MetricCard label="Folder" value={status.directoryPath ?? "Not set"} />
        </div>
        <ErrorState message={status.detail} />
      </div>
    );
  }

  if (status.connectorId === PDF_FOLDER_CONNECTOR_ID) {
    return (
      <FilesystemDocumentLibrary
        documentFolder={documentFolder}
        documentFolderError={documentFolderError}
        documentFolderLoading={documentFolderLoading}
        fallbackTitle={connector?.dashboardTitle ?? "PDF Folder"}
        monthlyPnl={monthlyPnl}
        monthlyPnlPct={monthlyPnlPct}
        netWorth={netWorth}
        todayPnl={todayPnl}
        todayPnlPct={todayPnlPct}
        totalPnl={totalPnl}
        totalPnlPct={totalPnlPct}
      />
    );
  }

  return (
    <FilesystemHoldings
      fallbackTitle={connector?.dashboardTitle ?? "CSV Folder"}
      monthlyPnl={monthlyPnl}
      monthlyPnlPct={monthlyPnlPct}
      netWorth={netWorth}
      portfolio={portfolio}
      portfolioError={portfolioError}
      portfolioLoading={portfolioLoading}
      todayPnl={todayPnl}
      todayPnlPct={todayPnlPct}
      totalPnl={totalPnl}
      totalPnlPct={totalPnlPct}
    />
  );
}

function FilesystemDocumentLibrary({
  documentFolder,
  documentFolderError,
  documentFolderLoading,
  fallbackTitle,
  totalPnl,
  todayPnl,
  monthlyPnl,
  totalPnlPct,
  todayPnlPct,
  monthlyPnlPct,
  netWorth,
}: {
  documentFolder: FilesystemDocumentFolderResponse | undefined;
  documentFolderError: string | null;
  documentFolderLoading: boolean;
  fallbackTitle: string;
  totalPnl: number | null;
  todayPnl: number | null;
  monthlyPnl: number | null;
  totalPnlPct: number | null;
  todayPnlPct: number | null;
  monthlyPnlPct: number | null;
  netWorth: number | null;
}) {
  if (documentFolderLoading) {
    return (
      <div className="grid gap-4">
        <AccountSourceSummaryCards monthlyPnl={monthlyPnl} monthlyPnlPct={monthlyPnlPct} netWorth={netWorth} todayPnl={todayPnl} todayPnlPct={todayPnlPct} totalPnl={totalPnl} totalPnlPct={totalPnlPct} />
        <div className="text-sm text-muted">Loading PDF library...</div>
      </div>
    );
  }

  if (documentFolderError) {
    return (
      <div className="grid gap-4">
        <AccountSourceSummaryCards monthlyPnl={monthlyPnl} monthlyPnlPct={monthlyPnlPct} netWorth={netWorth} todayPnl={todayPnl} todayPnlPct={todayPnlPct} totalPnl={totalPnl} totalPnlPct={totalPnlPct} />
        <ErrorState message={documentFolderError} />
      </div>
    );
  }

  if (!documentFolder) {
    return (
      <div className="grid gap-4">
        <AccountSourceSummaryCards monthlyPnl={monthlyPnl} monthlyPnlPct={monthlyPnlPct} netWorth={netWorth} todayPnl={todayPnl} todayPnlPct={todayPnlPct} totalPnl={totalPnl} totalPnlPct={totalPnlPct} />
        <ErrorState message="PDF files are unavailable." />
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <AccountSourceSummaryCards monthlyPnl={monthlyPnl} monthlyPnlPct={monthlyPnlPct} netWorth={netWorth} todayPnl={todayPnl} todayPnlPct={todayPnlPct} totalPnl={totalPnl} totalPnlPct={totalPnlPct} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="PDFs" value={fmtNumber(documentFolder.pdfFilesCount)} />
        <MetricCard label="Folder" value={documentFolder.displayName ?? fallbackTitle} />
        <MetricCard label="Latest PDF" value={documentFolder.latestPdfPath?.split("/").pop() ?? "Latest PDF"} />
        <MetricCard label="Updated" value={formatTimestamp(documentFolder.generatedAt)} />
      </div>
      <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-muted">
        <div className="font-medium text-text">Folder</div>
        <div className="mt-1 break-all">{documentFolder.directoryPath}</div>
        {documentFolder.latestPdfPath ? (
          <>
            <div className="mt-3 font-medium text-text">Latest PDF</div>
            <div className="mt-1 break-all">{documentFolder.latestPdfPath}</div>
          </>
        ) : null}
      </div>
      {documentFolder.sourceNotice ? (
        <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-muted">{documentFolder.sourceNotice}</div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="min-w-[820px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.16em] text-muted">
            <tr>
              <th className="pb-3 pr-4">PDF</th>
              <th className="pb-3 pr-4">Modified</th>
              <th className="pb-3">Size</th>
            </tr>
          </thead>
          <tbody>
            {documentFolder.files.map((file) => (
              <tr key={file.path} className="border-t border-line/70 align-top">
                <td className="py-3 pr-4">
                  <div className="font-medium text-text">{file.name}</div>
                  <div className="mt-1 break-all text-xs text-muted">{file.path}</div>
                </td>
                <td className="py-3 pr-4">{formatTimestamp(file.modifiedAt)}</td>
                <td className="py-3">{fmtNumber(file.sizeBytes / 1024)} KB</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FilesystemHoldings({
  fallbackTitle,
  totalPnl,
  todayPnl,
  monthlyPnl,
  totalPnlPct,
  todayPnlPct,
  monthlyPnlPct,
  netWorth,
  portfolio,
  portfolioError,
  portfolioLoading,
}: {
  fallbackTitle: string;
  totalPnl: number | null;
  todayPnl: number | null;
  monthlyPnl: number | null;
  totalPnlPct: number | null;
  todayPnlPct: number | null;
  monthlyPnlPct: number | null;
  netWorth: number | null;
  portfolio: FilesystemConnectorPortfolioResponse | undefined;
  portfolioError: string | null;
  portfolioLoading: boolean;
}) {
  if (portfolioLoading) {
    return (
      <div className="grid gap-4">
        <AccountSourceSummaryCards monthlyPnl={monthlyPnl} monthlyPnlPct={monthlyPnlPct} netWorth={netWorth} todayPnl={todayPnl} todayPnlPct={todayPnlPct} totalPnl={totalPnl} totalPnlPct={totalPnlPct} />
        <div className="text-sm text-muted">Loading CSV holdings...</div>
      </div>
    );
  }

  if (portfolioError) {
    return (
      <div className="grid gap-4">
        <AccountSourceSummaryCards monthlyPnl={monthlyPnl} monthlyPnlPct={monthlyPnlPct} netWorth={netWorth} todayPnl={todayPnl} todayPnlPct={todayPnlPct} totalPnl={totalPnl} totalPnlPct={totalPnlPct} />
        <ErrorState message={portfolioError} />
      </div>
    );
  }

  if (!portfolio) {
    return (
      <div className="grid gap-4">
        <AccountSourceSummaryCards monthlyPnl={monthlyPnl} monthlyPnlPct={monthlyPnlPct} netWorth={netWorth} todayPnl={todayPnl} todayPnlPct={todayPnlPct} totalPnl={totalPnl} totalPnlPct={totalPnlPct} />
        <ErrorState message="CSV holdings are unavailable." />
      </div>
    );
  }

  const columns = getVisibleHoldingColumns(portfolio.holdings);

  return (
    <div className="grid gap-4">
      <AccountSourceSummaryCards monthlyPnl={monthlyPnl} monthlyPnlPct={monthlyPnlPct} netWorth={netWorth} todayPnl={todayPnl} todayPnlPct={todayPnlPct} totalPnl={totalPnl} totalPnlPct={totalPnlPct} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Net contributions" value={fmtCurrency(portfolio.netContributions)} />
        <MetricCard label="Accounts" value={fmtNumber(portfolio.investmentAccountsCount)} />
        <MetricCard label="Holdings" value={fmtNumber(portfolio.holdingsCount)} />
        <MetricCard label="Snapshot" value={portfolio.latestCsvPath?.split("/").pop() ?? "Latest CSV"} />
      </div>
      <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-3 text-sm text-muted">
        <div className="font-medium text-text">Connector</div>
        <div className="mt-1">{portfolio.displayName ?? fallbackTitle}</div>
        <div className="mt-3 font-medium text-text">Positions folder</div>
        <div className="mt-1 break-all">{portfolio.directoryPath}</div>
        {portfolio.latestCsvPath ? (
          <>
            <div className="mt-3 font-medium text-text">Latest CSV</div>
            <div className="mt-1 break-all">{portfolio.latestCsvPath}</div>
          </>
        ) : null}
        {portfolio.historyCsvPath ? (
          <>
            <div className="mt-3 font-medium text-text">History CSV</div>
            <div className="mt-1 break-all">{portfolio.historyCsvPath}</div>
          </>
        ) : null}
      </div>
      {portfolio.sourceNotice ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            portfolio.isStale ? "border-caution/25 bg-caution/8 text-caution" : "border-line/80 bg-panelSoft text-muted"
          }`}
        >
          {portfolio.sourceNotice}
        </div>
      ) : null}
      <div className="overflow-x-auto">
        <table className="min-w-[820px] text-left text-sm">
          <thead className="text-[11px] uppercase tracking-[0.16em] text-muted">
            <tr>
              {columns.map((column) => (
                <th key={column.id} className={column.className ?? "pb-3 pr-4"}>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {portfolio.holdings.map((holding) => (
              <tr key={`${holding.accountId}-${holding.symbol ?? holding.name}`} className="border-t border-line/70 align-top">
                {columns.map((column) => (
                  <td key={column.id} className={column.className?.replace("pb-3", "py-3") ?? "py-3 pr-4"}>
                    {column.render(holding)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function getVisibleHoldingColumns(holdings: FilesystemHolding[]) {
  const columns: HoldingColumn[] = [
    {
      id: "holding",
      label: "Holding",
      value: (holding) => holding.symbol ?? holding.name,
      render: (holding) => (
        <>
          <div className="font-medium text-text">{holding.symbol ?? holding.name}</div>
          <div className="mt-1 text-xs text-muted">{holding.symbol ? holding.name : "CSV holding"}</div>
        </>
      ),
    },
    {
      id: "account",
      label: "Account",
      hideWhenStatic: true,
      value: (holding) => holding.accountName,
      render: (holding) => <div className="text-text">{holding.accountName}</div>,
    },
    {
      id: "quantity",
      label: "Qty",
      value: (holding) => holding.quantity,
      render: (holding) => fmtNumber(holding.quantity),
    },
    {
      id: "price",
      label: "Price",
      value: (holding) => holding.price,
      render: (holding) => fmtCurrencySmall(holding.price),
    },
    {
      id: "value",
      label: "Value",
      value: (holding) => holding.value,
      render: (holding) => <span className="font-medium text-text">{fmtCurrency(holding.value)}</span>,
    },
    {
      id: "costBasis",
      label: "Cost basis",
      value: (holding) => holding.costBasis,
      render: (holding) => fmtCurrency(holding.costBasis),
    },
    {
      id: "gainLoss",
      label: "Gain / loss",
      className: "pb-3",
      value: (holding) => holding.gainLoss,
      render: (holding) => <span className={pnlTone(holding.gainLoss)}>{fmtCurrency(holding.gainLoss)}</span>,
    },
  ];

  return columns.filter(
    (column) =>
      column.id === "holding" ||
      column.id === "value" ||
      (!isEmptyColumn(holdings, column.value) && !(column.hideWhenStatic && isStaticColumn(holdings, column.value))),
  );
}

function isEmptyColumn(holdings: FilesystemHolding[], valueForHolding: HoldingColumn["value"]) {
  return holdings.every((holding) => normalizeColumnValue(valueForHolding(holding)) === "");
}

function isStaticColumn(holdings: FilesystemHolding[], valueForHolding: HoldingColumn["value"]) {
  const values = new Set(
    holdings
      .map((holding) => normalizeColumnValue(valueForHolding(holding)))
      .filter((value) => value !== ""),
  );
  return values.size <= 1;
}

function normalizeColumnValue(value: string | number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "";
  }
  return String(value).trim().toLowerCase();
}

function fmtCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return currency.format(value);
}

function fmtCurrencySmall(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return currencySmall.format(value);
}

function fmtNumber(value: number | null | undefined, suffix = "") {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return `${number.format(value)}${suffix}`;
}

function pnlTone(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) {
    return "text-muted";
  }
  if (value > 0) {
    return "text-safe";
  }
  if (value < 0) {
    return "text-danger";
  }
  return "text-text";
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function ErrorState({ message }: { message: string }) {
  return <div className="rounded-2xl border border-danger/20 bg-danger/8 px-4 py-3 text-sm text-danger">{message}</div>;
}
