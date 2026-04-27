export const queryKeys = {
  account: {
    connectionStatus: ["connection-status"] as const,
    riskSummary: (accountId?: string) => ["risk-summary", accountId] as const,
    positions: (accountId?: string) => ["positions", accountId] as const,
    optionPositions: (accountId?: string) => ["option-positions", accountId] as const,
    openOrders: (accountId?: string) => ["open-orders", accountId] as const,
  },
  market: {
    cryptoMajors: ["crypto-majors"] as const,
    tickerOverview: (symbol?: string) => (symbol ? (["ticker-overview", symbol] as const) : (["ticker-overview"] as const)),
    tickerFinancials: (symbol?: string) => (symbol ? (["ticker-financials", symbol] as const) : (["ticker-financials"] as const)),
    optionChain: (symbol: string, expiry?: string) => ["chain", symbol, expiry] as const,
    universe: ["market-universe"] as const,
  },
  sources: {
    coinbaseStatus: ["coinbase-status"] as const,
    coinbasePortfolio: ["coinbase-portfolio"] as const,
    okxStatus: ["okx-status"] as const,
    finnhubStatus: ["finnhub-status"] as const,
    filesystemConnectorStatuses: (accountKey: string) => ["filesystem-connector-statuses", accountKey] as const,
    filesystemConnectorPortfolio: (accountKey: string, sourceId?: string) =>
      sourceId
        ? (["filesystem-connector-portfolio", accountKey, sourceId] as const)
        : (["filesystem-connector-portfolio", accountKey] as const),
    filesystemConnectorDocuments: (accountKey: string, sourceId?: string) =>
      sourceId
        ? (["filesystem-connector-documents", accountKey, sourceId] as const)
        : (["filesystem-connector-documents", accountKey] as const),
    edgarStatus: ["edgar-status"] as const,
    edgarWorkspace: (request: unknown) => ["edgar-workspace", request] as const,
    edgarLastSync: (request: unknown) => ["edgar-last-sync", request] as const,
    investorPdfStatus: ["investor-pdf-status"] as const,
    investorPdfLastSync: (request: unknown) => ["investor-pdfs-last-sync", request] as const,
  },
};
