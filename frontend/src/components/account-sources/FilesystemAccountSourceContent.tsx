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
      <FilesystemPortfolioSourceDetails fallbackTitle={fallbackTitle} portfolio={portfolio} />
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

function FilesystemPortfolioSourceDetails({
  fallbackTitle,
  portfolio,
}: {
  fallbackTitle: string;
  portfolio: FilesystemConnectorPortfolioResponse;
}) {
  const latestSnapshotName = portfolio.latestCsvPath?.split("/").pop() ?? "Latest CSV";
  const snapshotDateRange = sharpeDateRange(portfolio);

  return (
    <div className="rounded-2xl border border-line/80 bg-panelSoft px-4 py-4 text-sm text-muted">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.22em] text-muted">Source snapshot</div>
          <div className="mt-2 font-medium text-text">{portfolio.displayName ?? fallbackTitle}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <SourceDetailPill label={pluralize(portfolio.investmentAccountsCount, "account")} />
            <SourceDetailPill label={pluralize(portfolio.holdingsCount, "holding")} />
            <SourceDetailPill label={latestSnapshotName} title={latestSnapshotName} truncate />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:min-w-[420px]">
          <CompactSourceMetric label="Net contributions" value={fmtCurrency(portfolio.netContributions)} />
          <CompactSourceMetric
            detail={snapshotDateRange ? `${fmtNumber(portfolio.sharpeObservations)} daily returns, ${snapshotDateRange}` : sharpeMetricHint(portfolio)}
            label="Sharpe"
            tone={sharpeMetricTone(portfolio.annualizedSharpeRatio)}
            value={fmtNumber(portfolio.annualizedSharpeRatio)}
          />
        </div>
      </div>
      <div className="mt-4 grid gap-3 border-t border-line/70 pt-4 lg:grid-cols-2">
        <SourcePathDetail label="Positions folder" value={portfolio.directoryPath} />
        {portfolio.latestCsvPath ? <SourcePathDetail label="Latest CSV" value={portfolio.latestCsvPath} /> : null}
        {portfolio.historyCsvPath ? <SourcePathDetail label="History CSV" value={portfolio.historyCsvPath} /> : null}
      </div>
    </div>
  );
}

function SourceDetailPill({ label, title, truncate = false }: { label: string; title?: string; truncate?: boolean }) {
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border border-line/80 bg-black/10 px-3 py-1 text-xs font-medium text-text ${
        truncate ? "sm:max-w-[280px]" : ""
      }`}
      title={title}
    >
      <span className={truncate ? "truncate" : ""}>{label}</span>
    </span>
  );
}

function CompactSourceMetric({
  detail,
  label,
  tone = "neutral",
  value,
}: {
  detail?: string;
  label: string;
  tone?: "neutral" | "safe" | "caution" | "danger";
  value: string;
}) {
  const toneClasses = {
    neutral: "text-text",
    safe: "text-safe",
    caution: "text-caution",
    danger: "text-danger",
  };

  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClasses[tone]}`}>{value}</div>
      {detail ? <div className="mt-1 text-xs leading-5 text-muted">{detail}</div> : null}
    </div>
  );
}

function SourcePathDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</div>
      <div className="mt-1 truncate text-xs text-muted" title={value}>
        {value}
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

function pluralize(count: number, noun: string) {
  return `${fmtNumber(count)} ${count === 1 ? noun : `${noun}s`}`;
}

function sharpeMetricHint(portfolio: FilesystemConnectorPortfolioResponse) {
  if (portfolio.sharpeObservations < 2) {
    return "Needs at least 2 daily return observations.";
  }
  const range =
    portfolio.sharpePeriodStart && portfolio.sharpePeriodEnd
      ? ` from ${portfolio.sharpePeriodStart} to ${portfolio.sharpePeriodEnd}`
      : "";
  return `${fmtNumber(portfolio.sharpeObservations)} flow-adjusted daily returns${range}.`;
}

function sharpeDateRange(portfolio: FilesystemConnectorPortfolioResponse) {
  if (!portfolio.sharpePeriodStart || !portfolio.sharpePeriodEnd || portfolio.sharpeObservations < 2) {
    return null;
  }
  return `${fmtSourceDate(portfolio.sharpePeriodStart)} to ${fmtSourceDate(portfolio.sharpePeriodEnd)}`;
}

function fmtSourceDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return parsed.toLocaleDateString([], { month: "short", day: "numeric" });
}

function sharpeMetricTone(value: number | null | undefined): "neutral" | "safe" | "caution" | "danger" {
  if (value == null || Number.isNaN(value)) {
    return "neutral";
  }
  if (value < 0) {
    return "danger";
  }
  if (value < 1) {
    return "caution";
  }
  return "safe";
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
