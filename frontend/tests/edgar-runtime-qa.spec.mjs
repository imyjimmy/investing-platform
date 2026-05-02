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
    await expect(page.getByRole("tab", { name: "Qwen Intelligence", exact: true })).toBeVisible();
    await expect(page.getByTestId("edgar-workspace")).toBeVisible();
    await expect(page.getByTestId("edgar-qwen-workspace")).toBeHidden();
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

  test("lets a ticker question start bounded Qwen setup before a workspace exists", async ({ page }) => {
    const harness = await installEdgarRoutes(page, {
      initialWorkspace: null,
      onAsk: (request) => buildQuestionResponse({
        request,
        answer: "Risk factors include competition, supply constraints, and product demand volatility [C1].",
        citationSnippet: "Risk factors include competition, supply constraints, and product demand volatility.",
      }),
    });

    await openEdgarWorkspace(page);
    await openQwenIntelligenceTab(page);

    await expect(page.getByTestId("edgar-qwen-workspace")).toBeVisible();
    await expect(page.getByText("No local EDGAR workspace exists yet for this ticker.", { exact: false })).toBeVisible();
    await page.getByTestId("edgar-qwen-question-input").fill("what are the risk factors for NVDA");
    await expect(page.getByTestId("edgar-qwen-ask-button")).toBeEnabled();
    await page.getByTestId("edgar-qwen-ask-button").click();

    await expect.poll(() => harness.askRequests.length, { timeout: 15_000 }).toBe(1);
    expect(harness.askRequests[0]).toMatchObject({
      ticker: "NVDA",
      question: "what are the risk factors for NVDA",
    });
    await expect(page.getByTestId("edgar-qwen-answer")).toContainText("Risk factors include competition");
    await expect(page.getByTestId("edgar-qwen-citation-C1")).toContainText("Risk factors include competition");
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

  test("builds a Qwen index, asks a filing question, and renders citations", async ({ page }) => {
    const readyWorkspace = buildWorkspace({
      ticker: "AAPL",
      companyName: "Apple Inc.",
      cik: "0000320193",
      intelligenceState: {
        status: "ready",
        questionAnsweringEnabled: true,
        detail: "EDGAR intelligence artifacts are present.",
        lastIndexedAt: "2026-04-27T20:15:00Z",
        indexedFilings: 3,
        jobId: null,
        polledVia: null,
      },
    });

    const harness = await installEdgarRoutes(page, {
      initialWorkspace: readyWorkspace,
      initialIntelligenceStatus: buildIntelligenceStatus({
        workspace: readyWorkspace,
        readyForAsk: true,
        indexStatus: "ready",
        indexedChunks: 42,
      }),
      onIndex: (request) => buildIndexResponse({ request, indexedChunks: 42 }),
      onAsk: (request) => buildQuestionResponse({
        request,
        answer: "Revenue grew because services and product demand improved [C1].",
        citationSnippet: "Revenue grew because services and product demand improved during the fiscal year.",
      }),
    });

    await openEdgarWorkspace(page);
    await page.getByTestId("edgar-company-input").fill("AAPL");
    await expectWorkspaceDetails(page, {
      ticker: "AAPL",
      cik: "0000320193",
      stockPath: "/tmp/research-root/stocks/AAPL",
      matchedFilings: "34",
      cachedFilings: "34",
      newAccessions: "0",
    });

    await openQwenIntelligenceTab(page);
    await page.getByTestId("edgar-qwen-company-input").fill("AAPL");
    await expect(page.getByTestId("edgar-qwen-workspace")).toBeVisible();
    await expect(page.getByTestId("edgar-qwen-status")).toContainText("ready");

    await page.getByTestId("edgar-qwen-index-button").click();
    await expect.poll(() => harness.indexRequests.length, { timeout: 15_000 }).toBe(1);
    expect(harness.indexRequests[0]).toMatchObject({ ticker: "AAPL", includeExhibits: false });
    await expect(page.getByText("Index request completed.", { exact: true })).toBeVisible();

    await page.getByTestId("edgar-qwen-question-input").fill("What changed in revenue?");
    await page.getByTestId("edgar-qwen-ask-button").click();

    await expect.poll(() => harness.askRequests.length, { timeout: 15_000 }).toBe(1);
    expect(harness.askRequests[0]).toMatchObject({ ticker: "AAPL", question: "What changed in revenue?" });
    await expect(page.getByTestId("edgar-qwen-answer")).toContainText("Revenue grew because services and product demand improved");
    await expect(page.getByTestId("edgar-qwen-answer")).toContainText("[C1]");
    await expect(page.getByTestId("edgar-qwen-citation-C1")).toContainText("Revenue grew because services and product demand improved");
    await expect(page.getByTestId("edgar-qwen-citation-C1")).toContainText("10-K");
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
  const intelligenceStatusRequests = [];
  const indexRequests = [];
  const askRequests = [];
  let currentWorkspace = options.initialWorkspace ?? null;
  let currentIntelligenceStatus =
    options.initialIntelligenceStatus ?? buildIntelligenceStatus({ workspace: currentWorkspace, readyForAsk: false, indexStatus: "missing" });

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

  await page.route("**/api/sources/edgar/intelligence/status**", async (route) => {
    const url = new URL(route.request().url());
    intelligenceStatusRequests.push({
      ticker: url.searchParams.get("ticker"),
      outputDir: url.searchParams.get("outputDir"),
      jobId: url.searchParams.get("jobId"),
    });
    await fulfillJson(route, currentIntelligenceStatus);
  });

  await page.route("**/api/sources/edgar/sync", async (route) => {
    const request = route.request().postDataJSON();
    syncRequests.push(request);

    const next = options.onSync ? options.onSync(request, currentWorkspace) : null;
    if (next?.workspace) {
      currentWorkspace = next.workspace;
      currentIntelligenceStatus = buildIntelligenceStatus({ workspace: currentWorkspace, readyForAsk: false, indexStatus: "missing" });
    }

    await fulfillJson(route, next?.response ?? buildSyncResponse({
      issuerQuery: request?.issuerQuery ?? currentWorkspace?.ticker ?? "NVDA",
      workspace: currentWorkspace,
    }));
  });

  await page.route("**/api/sources/edgar/intelligence/index", async (route) => {
    const request = route.request().postDataJSON();
    indexRequests.push(request);
    const response = options.onIndex ? options.onIndex(request, currentWorkspace) : buildIndexResponse({ request });
    currentIntelligenceStatus = buildIntelligenceStatus({
      workspace: currentWorkspace,
      readyForAsk: response.indexState.status === "ready",
      indexStatus: response.indexState.status,
      indexedChunks: response.indexState.indexedChunks,
    });
    await fulfillJson(route, response);
  });

  await page.route("**/api/sources/edgar/intelligence/ask", async (route) => {
    const request = route.request().postDataJSON();
    askRequests.push(request);
    await fulfillJson(route, options.onAsk ? options.onAsk(request, currentWorkspace) : buildQuestionResponse({ request }));
  });

  return {
    syncRequests,
    workspaceRequests,
    intelligenceStatusRequests,
    indexRequests,
    askRequests,
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

function buildIntelligenceStatus({ workspace, readyForAsk = false, indexStatus = "missing", indexedChunks = 0 } = {}) {
  const ticker = workspace?.ticker ?? "NVDA";
  const outputDir = workspace?.workspace?.outputDir ?? null;
  return {
    ticker,
    outputDir,
    workspaceRoot: workspace?.stockPath ? workspace.stockPath.replace(`/stocks/${ticker}`, "") : "/tmp/research-root",
    generatedAt: "2026-04-27T20:25:00Z",
    readyForAsk,
    modelState: {
      status: "ready",
      provider: "omlx",
      baseUrl: "http://127.0.0.1:8001/v1",
      chatModel: "Qwen3.6-35B-A3B-4bit",
      embeddingModel: "nomicai-modernbert-embed-base-4bit",
      rerankerModel: "Qwen3-Reranker-0.6B-mxfp8",
      lastCheckedAt: "2026-04-27T20:25:00Z",
      message: null,
    },
    freshnessState: {
      status: workspace?.metadataState?.status ?? "unknown",
      liveCheckStatus: workspace?.metadataState?.status === "fresh" ? "succeeded" : "skipped",
      lastMetadataRefreshAt: workspace?.metadataState?.lastRefreshedAt ?? null,
      lastLiveCheckAt: workspace?.metadataState?.lastLiveCheckedAt ?? null,
      message: workspace?.metadataState?.message ?? null,
    },
    indexState: {
      status: indexStatus,
      indexVersion: "edgar-intelligence-index-v1",
      corpusVersion: "primary-documents-v1",
      chunkingVersion: "edgar-chunking-v1",
      embeddingModel: "nomicai-modernbert-embed-base-4bit",
      eligibleAccessions: readyForAsk ? 3 : 0,
      indexedAccessions: readyForAsk ? 3 : 0,
      indexedChunks,
      staleAccessions: [],
      lastIndexedAt: readyForAsk ? "2026-04-27T20:15:00Z" : null,
      limitations: readyForAsk ? [] : ["No EDGAR intelligence index has been built for this workspace."],
    },
    job: {
      jobId: null,
      kind: "none",
      status: "idle",
      startedAt: null,
      updatedAt: "2026-04-27T20:25:00Z",
      completedAt: null,
      progress: {
        documentsTotal: 0,
        documentsCompleted: 0,
        chunksTotal: 0,
        chunksCompleted: 0,
      },
      message: null,
    },
    limitations: readyForAsk ? [] : ["No EDGAR intelligence index has been built for this workspace."],
  };
}

function buildIndexResponse({ request, indexedChunks = 12 }) {
  return {
    ticker: request?.ticker ?? "NVDA",
    outputDir: request?.outputDir ?? null,
    status: "completed",
    mode: "inline",
    jobId: "job-index-1",
    pollSelector: {
      ticker: request?.ticker ?? "NVDA",
      outputDir: request?.outputDir ?? null,
      jobId: "job-index-1",
    },
    indexState: {
      status: "ready",
      indexVersion: "edgar-intelligence-index-v1",
      corpusVersion: "primary-documents-v1",
      chunkingVersion: "edgar-chunking-v1",
      embeddingModel: "nomicai-modernbert-embed-base-4bit",
      eligibleAccessions: 3,
      indexedAccessions: 3,
      indexedChunks,
      staleAccessions: [],
      lastIndexedAt: "2026-04-27T20:30:00Z",
      limitations: [],
    },
    job: {
      jobId: "job-index-1",
      kind: "index",
      status: "completed",
      startedAt: "2026-04-27T20:29:30Z",
      updatedAt: "2026-04-27T20:30:00Z",
      completedAt: "2026-04-27T20:30:00Z",
      progress: {
        documentsTotal: 3,
        documentsCompleted: 3,
        chunksTotal: indexedChunks,
        chunksCompleted: indexedChunks,
      },
      message: "EDGAR intelligence index built.",
    },
    message: "Index request completed.",
  };
}

function buildQuestionResponse({ request, answer = "The filing evidence is insufficient.", citationSnippet = "Revenue grew during the fiscal year." }) {
  return {
    ticker: request?.ticker ?? "NVDA",
    outputDir: request?.outputDir ?? null,
    question: request?.question ?? "What changed?",
    answer,
    confidence: "medium",
    generatedAt: "2026-04-27T20:31:00Z",
    model: {
      provider: "omlx",
      chatModel: "Qwen3.6-35B-A3B-4bit",
      embeddingModel: "nomicai-modernbert-embed-base-4bit",
      rerankerModel: "Qwen3-Reranker-0.6B-mxfp8",
    },
    freshnessState: {
      status: "fresh",
      liveCheckStatus: "succeeded",
      lastMetadataRefreshAt: "2026-04-27T20:20:00Z",
      lastLiveCheckAt: "2026-04-27T20:20:00Z",
      message: null,
    },
    maintenanceState: {
      status: "completed",
      newAccessionsDiscovered: 0,
      filingBodiesDownloaded: 0,
      documentsIndexed: 0,
      chunksEmbedded: 0,
      elapsedMs: 900,
      jobId: null,
      limitations: [],
    },
    retrievalState: {
      chunksRetrieved: 4,
      chunksUsed: 2,
      eligibleAccessionsSearched: 3,
      indexVersion: "edgar-intelligence-index-v1",
    },
    citations: [
      {
        citationId: "C1",
        ticker: request?.ticker ?? "NVDA",
        accessionNumber: "0000320193-26-000001",
        form: "10-K",
        filingDate: "2026-01-30",
        documentName: "a10-k2025.htm",
        section: "Primary Document",
        chunkId: "0000320193-26-000001:primary:0001",
        textRange: {
          startChar: 0,
          endChar: citationSnippet.length,
        },
        snippet: citationSnippet,
        sourcePath: "/tmp/research-root/stocks/AAPL/2026-01-30_10-K_000032019326000001/primary/a10-k2025.htm",
        secUrl: "https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/a10-k2025.htm",
      },
    ],
    limitations: [],
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

async function openQwenIntelligenceTab(page) {
  await page.getByRole("tab", { name: "Qwen Intelligence", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Qwen Intelligence", exact: true })).toHaveAttribute("aria-selected", "true");
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
