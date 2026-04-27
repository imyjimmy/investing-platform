import { expect, test } from "playwright/test";

test.describe("stock intel EDGAR workspace", () => {
  test("syncs a new EDGAR workspace and renders deterministic readiness state", async ({ page }) => {
    const appleWorkspace = buildWorkspace({
      ticker: "AAPL",
      companyName: "Apple Inc.",
      cik: "0000320193",
      stockPath: "/tmp/research-root/stocks/AAPL",
      edgarPath: "/tmp/research-root/stocks/AAPL/.edgar",
      exportsJsonPath: "/tmp/research-root/stocks/AAPL/.edgar/exports/matched-filings.json",
      exportsCsvPath: "/tmp/research-root/stocks/AAPL/.edgar/exports/matched-filings.csv",
      manifestPath: "/tmp/research-root/stocks/AAPL/.edgar/manifests/download-manifest.json",
      lastSyncedAt: "2026-04-27T20:00:00Z",
      metadataState: {
        status: "fresh",
        lastRefreshedAt: "2026-04-27T19:58:00Z",
        lastLiveCheckedAt: "2026-04-27T19:58:00Z",
        newAccessions: 2,
        message: null,
      },
      bodyCacheState: {
        status: "updated",
        lastRefreshedAt: "2026-04-27T20:00:00Z",
        matchedFilings: 36,
        cachedFilings: 36,
        downloadedFilings: 2,
        skippedFilings: 34,
        failedFilings: 0,
        message: "Recent filing bodies were refreshed locally.",
      },
    });

    const harness = await installEdgarRoutes(page, {
      initialWorkspace: null,
      onSync: (request) => ({
        response: buildSyncResponse({
          issuerQuery: request?.issuerQuery ?? "AAPL",
          workspace: appleWorkspace,
        }),
        workspace: appleWorkspace,
      }),
    });

    await openEdgarWorkspace(page);

    await expect(page.getByRole("tab", { name: "SEC Tool", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("edgar-workspace")).toBeVisible();
    await expect(page.getByTestId("edgar-source-status")).toContainText("Ready");
    await expect(page.getByTestId("edgar-company-input")).toHaveValue("NVDA");
    await expect(page.getByTestId("edgar-workspace-empty")).toBeVisible();

    await page.getByTestId("edgar-company-input").fill("AAPL");
    await page.getByTestId("edgar-sync-button").click();

    await expect.poll(() => harness.syncRequests.length, { timeout: 15_000 }).toBe(1);
    expect(harness.syncRequests[0]).toMatchObject({ issuerQuery: "AAPL" });

    await expect(page.getByTestId("edgar-sync-button")).toContainText("Refresh filings");
    await expect(page.getByTestId("edgar-state-metadata")).toContainText("fresh");
    await expect(page.getByTestId("edgar-state-body-cache")).toContainText("updated");
    await expect(page.getByTestId("edgar-state-intelligence")).toContainText("unavailable");

    await expectWorkspaceDetails(page, {
      ticker: "AAPL",
      cik: "0000320193",
      stockPath: "/tmp/research-root/stocks/AAPL",
      matchedFilings: "36",
      cachedFilings: "36",
      newAccessions: "2",
    });

    expect(harness.workspaceRequests.some((request) => request?.ticker === "AAPL")).toBeTruthy();
  });

  test("refreshes an existing EDGAR workspace and updates local readiness stats", async ({ page }) => {
    const existingWorkspace = buildWorkspace({
      ticker: "NVDA",
      companyName: "NVIDIA Corporation",
      cik: "0001045810",
      lastSyncedAt: "2026-04-26T19:45:00Z",
      metadataState: {
        status: "fresh",
        lastRefreshedAt: "2026-04-26T19:43:00Z",
        lastLiveCheckedAt: "2026-04-26T19:43:00Z",
        newAccessions: 0,
        message: "No new accessions were discovered on the last refresh.",
      },
      bodyCacheState: {
        status: "ready",
        lastRefreshedAt: "2026-04-26T19:45:00Z",
        matchedFilings: 34,
        cachedFilings: 34,
        downloadedFilings: 0,
        skippedFilings: 34,
        failedFilings: 0,
        message: "Filing bodies are already current in the local workspace.",
      },
    });

    const refreshedWorkspace = buildWorkspace({
      ...existingWorkspace,
      lastSyncedAt: "2026-04-27T20:12:00Z",
      metadataState: {
        status: "fresh",
        lastRefreshedAt: "2026-04-27T20:10:00Z",
        lastLiveCheckedAt: "2026-04-27T20:10:00Z",
        newAccessions: 1,
        message: null,
      },
      bodyCacheState: {
        status: "updated",
        lastRefreshedAt: "2026-04-27T20:12:00Z",
        matchedFilings: 35,
        cachedFilings: 35,
        downloadedFilings: 1,
        skippedFilings: 34,
        failedFilings: 0,
        message: "One newly discovered filing body was cached locally.",
      },
    });

    const harness = await installEdgarRoutes(page, {
      initialWorkspace: existingWorkspace,
      onSync: (request) => ({
        response: buildSyncResponse({
          issuerQuery: request?.issuerQuery ?? "NVDA",
          workspace: refreshedWorkspace,
        }),
        workspace: refreshedWorkspace,
      }),
    });

    await openEdgarWorkspace(page);

    await expect(page.getByTestId("edgar-sync-button")).toContainText("Refresh filings");
    await expect(page.getByTestId("edgar-state-metadata")).toContainText("No new accessions were discovered on the last refresh.");
    await expect(page.getByTestId("edgar-state-body-cache")).toContainText("Filing bodies are already current in the local workspace.");
    await expectWorkspaceDetails(page, {
      ticker: "NVDA",
      cik: "0001045810",
      stockPath: "/tmp/research-root/stocks/NVDA",
      matchedFilings: "34",
      cachedFilings: "34",
      newAccessions: "0",
    });

    await expect.poll(() => harness.workspaceRequests.length > 0, { timeout: 15_000 }).toBeTruthy();
    const workspaceRequestsBeforeRefresh = harness.workspaceRequests.length;

    await page.getByTestId("edgar-sync-button").click();

    await expect.poll(() => harness.syncRequests.length, { timeout: 15_000 }).toBe(1);
    expect(harness.syncRequests[0]).toMatchObject({ issuerQuery: "NVDA" });
    await expect.poll(() => harness.workspaceRequests.length > workspaceRequestsBeforeRefresh, { timeout: 15_000 }).toBeTruthy();

    await expect(page.getByTestId("edgar-state-metadata")).toContainText("1 new accessions discovered.");
    await expect(page.getByTestId("edgar-state-body-cache")).toContainText("One newly discovered filing body was cached locally.");
    await expectWorkspaceDetails(page, {
      ticker: "NVDA",
      cik: "0001045810",
      stockPath: "/tmp/research-root/stocks/NVDA",
      matchedFilings: "35",
      cachedFilings: "35",
      newAccessions: "1",
    });
  });

  test("surfaces stale and degraded EDGAR state, then recovers after refresh", async ({ page }) => {
    const staleWorkspace = buildWorkspace({
      ticker: "NVDA",
      companyName: "NVIDIA Corporation",
      cik: "0001045810",
      lastSyncedAt: "2026-04-24T17:10:00Z",
      metadataState: {
        status: "stale",
        lastRefreshedAt: "2026-04-24T17:05:00Z",
        lastLiveCheckedAt: "2026-04-24T17:05:00Z",
        newAccessions: 0,
        message: "Live refresh is overdue; cached metadata may be missing newer filings.",
      },
      bodyCacheState: {
        status: "degraded",
        lastRefreshedAt: "2026-04-24T17:10:00Z",
        matchedFilings: 34,
        cachedFilings: 34,
        downloadedFilings: 0,
        skippedFilings: 34,
        failedFilings: 1,
        message: "The last body refresh failed, so the workspace is serving the previous successful cache.",
      },
      intelligenceState: {
        status: "not-ready",
        questionAnsweringEnabled: false,
        detail: "Local filing Q&A needs a fresh index build before answers can run.",
        lastIndexedAt: null,
        indexedFilings: 0,
        jobId: null,
        polledVia: null,
      },
    });

    const recoveredWorkspace = buildWorkspace({
      ...staleWorkspace,
      lastSyncedAt: "2026-04-27T20:20:00Z",
      metadataState: {
        status: "fresh",
        lastRefreshedAt: "2026-04-27T20:18:00Z",
        lastLiveCheckedAt: "2026-04-27T20:18:00Z",
        newAccessions: 2,
        message: null,
      },
      bodyCacheState: {
        status: "updated",
        lastRefreshedAt: "2026-04-27T20:20:00Z",
        matchedFilings: 36,
        cachedFilings: 36,
        downloadedFilings: 2,
        skippedFilings: 34,
        failedFilings: 0,
        message: "Recent filing bodies were refreshed locally.",
      },
    });

    const harness = await installEdgarRoutes(page, {
      sourceStatus: {
        ...defaultEdgarStatus(),
        status: "degraded",
      },
      initialWorkspace: staleWorkspace,
      onSync: (request) => ({
        response: buildSyncResponse({
          issuerQuery: request?.issuerQuery ?? "NVDA",
          workspace: recoveredWorkspace,
        }),
        workspace: recoveredWorkspace,
      }),
    });

    await openEdgarWorkspace(page);

    await expect(page.getByTestId("edgar-sync-button")).toContainText("Refresh filings");
    await expect(page.getByTestId("edgar-state-metadata")).toContainText("stale");
    await expect(page.getByTestId("edgar-state-metadata")).toContainText("Live refresh is overdue; cached metadata may be missing newer filings.");
    await expect(page.getByTestId("edgar-state-body-cache")).toContainText("degraded");
    await expect(page.getByTestId("edgar-state-body-cache")).toContainText("The last body refresh failed, so the workspace is serving the previous successful cache.");
    await expect(page.getByTestId("edgar-state-intelligence")).toContainText("not-ready");
    await expect(page.getByTestId("edgar-state-intelligence")).toContainText("Local filing Q&A needs a fresh index build before answers can run.");
    await expectWorkspaceDetails(page, {
      ticker: "NVDA",
      cik: "0001045810",
      stockPath: "/tmp/research-root/stocks/NVDA",
      matchedFilings: "34",
      cachedFilings: "34",
      newAccessions: "0",
    });

    await page.getByTestId("edgar-sync-button").click();

    await expect.poll(() => harness.syncRequests.length, { timeout: 15_000 }).toBe(1);
    expect(harness.syncRequests[0]).toMatchObject({ issuerQuery: "NVDA" });

    await expect(page.getByTestId("edgar-state-metadata")).toContainText("fresh");
    await expect(page.getByTestId("edgar-state-body-cache")).toContainText("updated");
    await expect(page.getByTestId("edgar-state-body-cache")).toContainText("Recent filing bodies were refreshed locally.");
    await expectWorkspaceDetails(page, {
      ticker: "NVDA",
      cik: "0001045810",
      stockPath: "/tmp/research-root/stocks/NVDA",
      matchedFilings: "36",
      cachedFilings: "36",
      newAccessions: "2",
    });
  });
});

async function installEdgarRoutes(page, options = {}) {
  const syncRequests = [];
  const workspaceRequests = [];
  let currentWorkspace = options.initialWorkspace ?? null;

  await page.route("**/api/sources/edgar/status", async (route) => {
    await fulfillJson(route, options.sourceStatus ?? defaultEdgarStatus());
  });

  await page.route("**/api/sources/investor-pdfs/status", async (route) => {
    await fulfillJson(route, defaultInvestorPdfStatus());
  });

  await page.route("**/api/sources/edgar/workspace", async (route) => {
    const request = route.request().postDataJSON();
    workspaceRequests.push(request);

    if (!currentWorkspace || request?.ticker !== currentWorkspace.ticker) {
      await fulfillJson(route, null);
      return;
    }

    await fulfillJson(route, currentWorkspace);
  });

  await page.route("**/api/sources/edgar/sync", async (route) => {
    const request = route.request().postDataJSON();
    syncRequests.push(request);

    const next = options.onSync ? options.onSync(request, currentWorkspace) : null;
    if (next?.workspace) {
      currentWorkspace = next.workspace;
    }

    await fulfillJson(route, next?.response ?? buildSyncResponse({
      issuerQuery: request?.issuerQuery ?? currentWorkspace?.ticker ?? "NVDA",
      workspace: currentWorkspace,
    }));
  });

  return {
    syncRequests,
    workspaceRequests,
    currentWorkspace: () => currentWorkspace,
  };
}

function defaultEdgarStatus() {
  return {
    available: true,
    status: "ready",
    researchRootPath: "/tmp/research-root",
    stocksRootPath: "/tmp/research-root/stocks",
    edgarUserAgent: "Investing Platform tests@example.com",
    maxRequestsPerSecond: 5,
    timeoutSeconds: 30,
  };
}

function defaultInvestorPdfStatus() {
  return {
    available: true,
    status: "ready",
    researchRootPath: "/tmp/research-root",
    stocksRootPath: "/tmp/research-root/stocks",
    pdfFolderName: "investor-pdfs",
    timeoutSeconds: 30,
    browserProvider: "disabled",
    browserRenderingEnabled: false,
    browserTimeoutSeconds: null,
  };
}

function buildWorkspace(overrides) {
  const ticker = overrides.ticker ?? "NVDA";
  const companyName = overrides.companyName ?? "NVIDIA Corporation";
  const cik = overrides.cik ?? "0001045810";
  const stockPath = overrides.stockPath ?? `/tmp/research-root/stocks/${ticker}`;
  const edgarPath = overrides.edgarPath ?? `${stockPath}/.edgar`;

  return {
    ticker,
    companyName,
    cik,
    workspace: overrides.workspace ?? {
      ticker,
      outputDir: null,
    },
    stockPath,
    edgarPath,
    exportsJsonPath: overrides.exportsJsonPath ?? `${edgarPath}/exports/matched-filings.json`,
    exportsCsvPath: overrides.exportsCsvPath ?? `${edgarPath}/exports/matched-filings.csv`,
    manifestPath: overrides.manifestPath ?? `${edgarPath}/manifests/download-manifest.json`,
    lastSyncedAt: overrides.lastSyncedAt ?? "2026-04-27T20:00:00Z",
    metadataState: overrides.metadataState ?? {
      status: "fresh",
      lastRefreshedAt: "2026-04-27T19:58:00Z",
      lastLiveCheckedAt: "2026-04-27T19:58:00Z",
      newAccessions: 0,
      message: null,
    },
    bodyCacheState: overrides.bodyCacheState ?? {
      status: "ready",
      lastRefreshedAt: "2026-04-27T20:00:00Z",
      matchedFilings: 34,
      cachedFilings: 34,
      downloadedFilings: 0,
      skippedFilings: 34,
      failedFilings: 0,
      message: "Filing bodies are already current in the local workspace.",
    },
    intelligenceState: overrides.intelligenceState ?? {
      status: "unavailable",
      questionAnsweringEnabled: false,
      detail: "Local filing Q&A will be enabled after the EDGAR intelligence layer is implemented.",
      lastIndexedAt: null,
      indexedFilings: 0,
      jobId: null,
      polledVia: null,
    },
  };
}

function buildSyncResponse({ issuerQuery, workspace }) {
  return {
    issuerQuery,
    resolvedTicker: workspace.ticker,
    resolvedCompanyName: workspace.companyName,
    resolvedCik: workspace.cik,
    workspace: workspace.workspace,
    metadataState: workspace.metadataState,
    bodyCacheState: workspace.bodyCacheState,
    intelligenceState: workspace.intelligenceState,
  };
}

async function expectWorkspaceDetails(page, details) {
  await expect(page.getByTestId("edgar-workspace-details")).toBeVisible();
  await expect(page.getByTestId("edgar-stat-matched-filings")).toContainText(details.matchedFilings);
  await expect(page.getByTestId("edgar-stat-cached-filings")).toContainText(details.cachedFilings);
  await expect(page.getByTestId("edgar-stat-new-accessions")).toContainText(details.newAccessions);
  await expect(page.getByText(`Ticker ${details.ticker} · CIK ${details.cik}`, { exact: true })).toBeVisible();
  await expect(page.getByTestId("edgar-workspace-details").getByText(details.stockPath, { exact: true })).toBeVisible();
}

async function fulfillJson(route, payload) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

async function openEdgarWorkspace(page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await ensureSidebarOpen(page);
  await openWorkspace(page, "nav-stocks-intel");
}

async function openWorkspace(page, testId) {
  await ensureSidebarOpen(page);
  await page.getByTestId(testId).click();
}

async function ensureSidebarOpen(page) {
  const toggle = page.getByRole("button", { name: /sidebar/i });
  await expect(toggle).toBeVisible();
  const expanded = await toggle.getAttribute("aria-expanded");
  if (expanded !== "true") {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
  }
}
