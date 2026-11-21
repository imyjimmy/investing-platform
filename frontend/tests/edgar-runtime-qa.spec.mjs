import { expect, test } from "playwright/test";

test("live NVDA filing answers cite the FY2025 filing and abstain on a missing identifier", async ({ page }, testInfo) => {
  test.skip(process.env.INVESTING_PLATFORM_LIVE_SEC_QA !== "1", "Requires the local NVDA library and running inference server");
  test.setTimeout(480_000);
  await openEdgarWorkspace(page);
  await openQwenIntelligenceTab(page);
  await page.getByTestId("edgar-qwen-company-input").fill("NVDA");
  const filing = "https://www.sec.gov/Archives/edgar/data/1045810/000104581025000023/nvda-20250126.htm";

  async function ask(question) {
    await page.getByTestId("edgar-qwen-question-input").fill(question);
    const pending = page.waitForResponse(response =>
      response.request().method() === "POST" && response.url().endsWith("/edgar/intelligence/ask"), { timeout: 180_000 });
    await page.getByTestId("edgar-qwen-ask-button").click();
    const response = await pending;
    expect(response.status()).toBe(200);
    const result = await response.json();
    expect(result.question).toBe(question);
    for (const id of new Set(Array.from(result.answer.matchAll(/\[(C\d+)\]/g), match => match[1]))) {
      const card = page.getByTestId(`edgar-qwen-citation-${id}`);
      await expect(card.getByRole("link", { name: /SEC source/i })).toHaveAttribute("href", filing);
    }
    return result;
  }

  const financial = await ask("According to NVIDIA’s fiscal 2025 Form 10-K, what were total revenue and net income for the year ended January 26, 2025? Give each amount in billions of US dollars.");
  const metrics = [
    { concept: "Revenues", label: /revenue/i, value: "130497000000" },
    { concept: "NetIncomeLoss", label: /net income/i, value: "72880000000" },
  ];
  for (const metric of metrics) {
    const fact = financial.citations.find(citation => citation.xbrlConcept === `us-gaap:${metric.concept}`);
    expect(fact?.xbrlValue).toBe(metric.value);
    expect(fact.xbrlUnit).toBe("USD");
    expect(fact.xbrlPeriod).toContain("2025-01-26");
    const claim = financial.answer.split(/\n|(?<=\.)\s+/).find(line => line.includes(`[${fact.citationId}]`));
    expect(claim).toMatch(metric.label);
    const amount = claim.match(/(\d+(?:\.\d+)?)\s+billion/i)?.[1];
    expect(amount).toBeDefined();
    const places = amount.split(".")[1]?.length ?? 0;
    expect(amount).toBe((Number(metric.value) / 1e9).toFixed(places));
  }

  const risk = await ask("In its Form 10-K for the year ended January 26, 2025, what is one risk NVIDIA identifies from relying on third parties to manufacture its products?");
  expect(risk.answer).toMatch(/control|yield|delivery|quality|capacity|supply/i);
  expect(risk.citations.some(citation =>
    citation.sectionType === "risk_factors" && /manufactur|foundr/i.test(citation.snippet)
    && /control|yield|delivery|quality|capacity|supply/i.test(citation.snippet))).toBe(true);
  await testInfo.attach("manufacturing-risk-answer", {
    body: await page.getByTestId("edgar-qwen-answer").screenshot(),
    contentType: "image/png",
  });
  await testInfo.attach("verified-answer-text", {
    body: JSON.stringify([financial, risk].map(({ question, answer, citations }) => ({
      question, answer, sources: citations.map(({ citationId, snippet, secUrl }) => ({ citationId, snippet, secUrl })),
    })), null, 2),
    contentType: "application/json",
  });

  const unknown = await ask("What serial number does NVIDIA’s Form 10-K for the year ended January 26, 2025 give for the first individual Blackwell GPU it shipped?");
  expect(unknown.citations).toEqual([]);
  await expect(page.getByTestId("edgar-qwen-answer")).toContainText("I cannot answer this from the retrieved SEC filing excerpts.");
});

test("live NVDA guidance comparison cites the outlook in two SEC earnings exhibits", async ({ page }, testInfo) => {
  test.skip(process.env.INVESTING_PLATFORM_LIVE_SEC_QA !== "1", "Requires the local NVDA library and running inference server");
  test.setTimeout(300_000);
  await openEdgarWorkspace(page);
  await openQwenIntelligenceTab(page);
  await page.getByTestId("edgar-qwen-company-input").fill("NVDA");
  await page.getByTestId("edgar-qwen-question-input").fill("did NVDA raise guidance?");
  await expect(page.getByTestId("edgar-qwen-source-status")).toHaveText("Ready");
  const pending = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/edgar/intelligence/ask"), {timeout: 240_000});
  await page.getByTestId("edgar-qwen-ask-button").click();
  const response = await pending;
  expect(response.status()).toBe(200);
  const {answer, citations} = await response.json();
  expect(new Set(citations.map(c => c.accessionNumber)).size).toBe(2);
  for (const citation of citations) {
    expect(citation.secUrl).toMatch(/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1045810\//);
    expect(citation.secUrl).toContain(citation.accessionNumber.replaceAll("-", ""));
    expect(citation.snippet).toMatch(/revenue/i);
    expect(answer).toContain(`[${citation.citationId}]`);
    await expect(page.getByTestId(`edgar-qwen-citation-${citation.citationId}`).getByRole("link")).toHaveAttribute("href", citation.secUrl);
  }
  await testInfo.attach("guidance-sources", {body: JSON.stringify({answer, citations}, null, 2), contentType: "application/json"});
  await testInfo.attach("guidance-screen", {body: await page.screenshot(), contentType: "image/png"});
});

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

    await expect(page.getByRole("tab", { name: "SEC filings", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tab", { name: "Ask filings", exact: true })).toBeVisible();
    await expect(page.getByTestId("edgar-workspace")).toBeVisible();
    await expect(page.getByTestId("edgar-qwen-workspace")).toBeHidden();
    await expect(page.getByTestId("edgar-source-status")).toContainText("Connected");
    await expect(page.getByTestId("edgar-company-input")).toHaveValue("NVDA");
    await expect(page.getByTestId("edgar-sync-button")).toContainText("Sync company filings");
    await expect(page.getByTestId("edgar-watchlist-refresh-inline-button")).toContainText("Refresh 2 symbols");
    await expect(page.getByTestId("edgar-workspace-empty")).toBeVisible();

    await expect(page.getByTestId("edgar-warm-button")).toBeHidden();
    await page.getByTestId("edgar-advanced-toggle").click();
    await page.getByTestId("edgar-warm-button").click();
    await expect.poll(() => harness.warmRequests.length, { timeout: 15_000 }).toBe(1);
    expect(harness.warmRequests[0]).toMatchObject({ mode: "metadata-only", maxIssuers: 10 });
    await expect(page.getByText("Checked 2 companies.", { exact: true })).toBeVisible();

    await page.getByTestId("edgar-watchlist-input").fill("IREN");
    await page.getByTestId("edgar-watchlist-add-button").click();
    await expect.poll(() => harness.watchlistUpdates.length, { timeout: 15_000 }).toBe(1);
    expect(harness.watchlistUpdates[0]).toEqual(["NVDA", "AAPL", "IREN"]);
    await expect(page.getByTestId("edgar-watchlist-chip-IREN")).toBeVisible();

    await page.getByTestId("edgar-watchlist-remove-NVDA").click();
    await expect.poll(() => harness.watchlistUpdates.length, { timeout: 15_000 }).toBe(2);
    expect(harness.watchlistUpdates[1]).toEqual(["AAPL", "IREN"]);

    await page.getByTestId("edgar-watchlist-refresh-inline-button").click();
    await expect.poll(() => harness.warmRequests.length, { timeout: 15_000 }).toBe(2);
    expect(harness.warmRequests[1]).toMatchObject({
      issuerQueries: ["AAPL", "IREN"],
      mode: "body-cache",
      maxFilingBodiesPerIssuer: 2,
      includeWatchlist: false,
      includeRecentIssuers: false,
      includeAskedIssuers: false,
    });

    await page.getByTestId("edgar-company-input").fill("AAPL");
    await page.getByTestId("edgar-sync-button").click();

    await expect.poll(() => harness.syncRequests.length, { timeout: 15_000 }).toBe(1);
    expect(harness.syncRequests[0]).toMatchObject({ issuerQuery: "AAPL" });

    await expect(page.getByTestId("edgar-sync-button")).toContainText("Refresh AAPL filings");
    await expect(page.getByTestId("edgar-sync-success-message")).toContainText(
      "AAPL has 36 filings saved locally. 2 downloaded",
    );

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

  test("allows SEC and Qwen company inputs to remain empty after clearing the default ticker", async ({ page }) => {
    await installEdgarRoutes(page, {
      initialWorkspace: null,
    });

    await openEdgarWorkspace(page);

    const secCompanyInput = page.getByTestId("edgar-company-input");
    await expect(secCompanyInput).toHaveValue("NVDA");
    await secCompanyInput.fill("");
    await expect(secCompanyInput).toHaveValue("");
    await expect(page.getByTestId("edgar-sync-button")).toBeDisabled();
    await expect(page.getByTestId("edgar-workspace-empty")).toBeVisible();

    await openQwenIntelligenceTab(page);

    const qwenCompanyInput = page.getByTestId("edgar-qwen-company-input");
    await expect(qwenCompanyInput).toHaveValue("NVDA");
    await qwenCompanyInput.fill("");
    await expect(qwenCompanyInput).toHaveValue("");
    await expect(page.getByText("Choose a ticker", { exact: true })).toBeVisible();
  });

  test("keeps Ask disabled when the filings are ready but the model is offline", async ({ page }) => {
    const health = buildIntelligenceStatus({ readyForAsk: false, indexStatus: "ready" });
    health.modelState.status = "unavailable";
    health.modelState.message = "Connection refused on 127.0.0.1";
    const harness = await installEdgarRoutes(page, {initialIntelligenceStatus: health});
    await openEdgarWorkspace(page);
    await openQwenIntelligenceTab(page);
    await page.getByTestId("edgar-qwen-question-input").fill("did NVDA raise guidance?");
    await expect(page.getByTestId("edgar-qwen-source-status")).toHaveText("Local AI offline");
    await expect(page.getByTestId("edgar-qwen-ask-button")).toBeDisabled();
    await expect(page.getByText(/127\.0\.0\.1/)).toBeHidden();
    expect(harness.askRequests).toHaveLength(0);
  });

  test("keeps advanced EDGAR sync overrides behind disclosure", async ({ page }) => {
    const advancedWorkspace = buildWorkspace({
      ticker: "AAPL",
      companyName: "Apple Inc.",
      cik: "0000320193",
      workspace: {
        ticker: "AAPL",
        outputDir: "/tmp/custom-research",
      },
      stockPath: "/tmp/custom-research/stocks/AAPL",
      edgarPath: "/tmp/custom-research/stocks/AAPL/.edgar",
    });

    const harness = await installEdgarRoutes(page, {
      initialWorkspace: null,
      onSync: (request) => ({
        response: buildSyncResponse({
          issuerQuery: request?.issuerQuery ?? "AAPL",
          workspace: advancedWorkspace,
        }),
        workspace: advancedWorkspace,
      }),
    });

    await openEdgarWorkspace(page);

    await expect(page.getByTestId("edgar-force-refresh-checkbox")).toBeHidden();
    await page.getByTestId("edgar-advanced-toggle").click();
    await page.getByTestId("edgar-company-input").fill("AAPL");
    await page.getByTestId("edgar-output-dir-input").fill("/tmp/custom-research");
    await page.getByTestId("edgar-start-date-input").fill("2025-10-01");
    await page.getByTestId("edgar-end-date-input").fill("2025-10-31");
    await page.getByTestId("edgar-form-types-input").fill("10-k, 8-k/a 10-q");
    await page.getByTestId("edgar-force-refresh-checkbox").check();
    await page.getByTestId("edgar-include-exhibits-checkbox").check();
    await page.getByTestId("edgar-sync-button").click();

    await expect.poll(() => harness.syncRequests.length, { timeout: 15_000 }).toBe(1);
    expect(harness.syncRequests[0]).toMatchObject({
      issuerQuery: "AAPL",
      outputDir: "/tmp/custom-research",
      forceRefresh: true,
      startDate: "2025-10-01",
      endDate: "2025-10-31",
      formTypes: ["10-K", "8-K/A", "10-Q"],
      includeExhibits: true,
    });
  });

  test("prepares a new local filing library before enabling questions", async ({ page }) => {
    const harness = await installEdgarRoutes(page, {
      initialWorkspace: null,
      onSync: () => ({workspace: buildWorkspace({ticker: "NVDA"})}),
      onAsk: (request) => buildQuestionResponse({
        request,
        answer: "Risk factors include competition, supply constraints, and product demand volatility [C1].",
        citationSnippet: "Risk factors include competition, supply constraints, and product demand volatility.",
      }),
    });

    await openEdgarWorkspace(page);
    await openQwenIntelligenceTab(page);

    await expect(page.getByTestId("edgar-qwen-workspace")).toBeVisible();
    await page.getByTestId("edgar-qwen-question-input").fill("what are the risk factors for NVDA");
    await expect(page.getByTestId("edgar-qwen-ask-button")).toBeDisabled();
    await page.getByTestId("edgar-qwen-index-button").click();
    await expect(page.getByTestId("edgar-qwen-source-status")).toHaveText("Ready");
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

    await expect(page.getByTestId("edgar-sync-button")).toContainText("Refresh NVDA filings");
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

    await expect(page.getByTestId("edgar-sync-success-message")).toContainText(
      "NVDA has 35 filings saved locally. 1 downloaded",
    );
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
        readyForAsk: false,
        indexStatus: "missing",
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
    await expect(page.getByTestId("edgar-qwen-source-status")).toHaveText("Prepare filings");

    await page.getByTestId("edgar-qwen-index-button").click();
    await expect.poll(() => harness.indexRequests.length, { timeout: 15_000 }).toBe(1);
    expect(harness.indexRequests[0]).toMatchObject({ ticker: "AAPL" });
    await expect(page.getByTestId("edgar-qwen-source-status")).toHaveText("Ready");

    await page.getByTestId("edgar-qwen-question-input").fill("What changed in revenue?");
    await page.getByTestId("edgar-qwen-ask-button").click();

    await expect.poll(() => harness.askRequests.length, { timeout: 15_000 }).toBe(1);
    expect(harness.askRequests[0]).toMatchObject({ ticker: "AAPL", question: "What changed in revenue?" });
    await expect(page.getByTestId("edgar-qwen-answer")).toContainText("Revenue grew because services and product demand improved");
    await expect(page.getByTestId("edgar-qwen-answer")).toContainText("[C1]");
    await expect(page.getByTestId("edgar-qwen-citation-C1")).toContainText("Revenue grew because services and product demand improved");
    await expect(page.getByTestId("edgar-qwen-citation-C1")).toContainText("10-K");
  });

  test("keeps an in-flight filing question and its answer across tabs and workspaces", async ({ page }) => {
    const question = "What changed in revenue?";
    const workspace = buildWorkspace({ ticker: "AAPL", companyName: "Apple Inc.", cik: "0000320193" });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const harness = await installEdgarRoutes(page, {
      initialWorkspace: workspace,
      initialIntelligenceStatus: buildIntelligenceStatus({ workspace, readyForAsk: true, indexStatus: "ready" }),
      onAsk: async request => {
        await gate;
        return buildQuestionResponse({ request, answer: "Revenue grew [C1]." });
      },
    });
    await openEdgarWorkspace(page);
    await openQwenIntelligenceTab(page);
    await page.getByTestId("edgar-qwen-company-input").fill("AAPL");
    await page.getByTestId("edgar-qwen-question-input").fill(question);
    await page.getByTestId("edgar-qwen-ask-button").click();
    await expect.poll(() => harness.askRequests.length).toBe(1);
    await page.getByRole("tab", { name: "SEC filings", exact: true }).click();
    await openQwenIntelligenceTab(page);
    await expect(page.getByTestId("edgar-qwen-ask-button")).toBeDisabled();
    await expect(page.getByTestId("edgar-qwen-answer")).toContainText("Reading the filings");

    await openWorkspace(page, "nav-stocks-market");
    await expect(page.getByTestId("edgar-qwen-workspace")).toBeHidden();
    const delivered = page.waitForResponse(r => r.url().endsWith("/edgar/intelligence/ask"));
    release();
    await delivered;
    await openWorkspace(page, "nav-stocks-intel");
    await expect(page.getByRole("tab", { name: "Ask filings" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("edgar-qwen-company-input")).toHaveValue("AAPL");
    await expect(page.getByTestId("edgar-qwen-question-input")).toHaveValue(question);
    await expect(page.getByTestId("edgar-qwen-answer")).toContainText("Revenue grew [C1]");
    await expect(page.getByTestId("edgar-qwen-citation-C1").getByRole("link")).toHaveAttribute("href", /sec\.gov\/Archives\//);
    expect(harness.askRequests).toHaveLength(1);
  });

  test("surfaces Qwen index lifecycle state and job progress", async ({ page }) => {
    const workspace = buildWorkspace({
      ticker: "AAPL",
      companyName: "Apple Inc.",
      cik: "0000320193",
      intelligenceState: {
        status: "not-ready",
        questionAnsweringEnabled: false,
        detail: "The filing index is stale.",
        lastIndexedAt: "2026-04-27T20:15:00Z",
        indexedFilings: 2,
        jobId: "job-index-2",
        polledVia: null,
      },
    });

    await installEdgarRoutes(page, {
      initialWorkspace: workspace,
      initialIntelligenceStatus: buildIntelligenceStatus({
        workspace,
        indexStatus: "stale",
        indexedChunks: 18,
        limitations: ["The filing index is missing 1 selected accession from the current EDGAR workspace."],
        job: {
          jobId: "job-index-2",
          kind: "index",
          status: "indexing",
          startedAt: "2026-04-27T20:20:00Z",
          updatedAt: "2026-04-27T20:21:00Z",
          completedAt: null,
          progress: {
            documentsTotal: 5,
            documentsCompleted: 2,
            chunksTotal: 100,
            chunksCompleted: 40,
          },
          message: "Index build in progress.",
        },
      }),
    });

    await openEdgarWorkspace(page);
    await openQwenIntelligenceTab(page);

    await expect(page.getByTestId("edgar-qwen-source-status")).toHaveText("Preparing filings");
    await expect(page.getByTestId("edgar-qwen-ask-button")).toBeDisabled();
    await expect(page.getByText(/missing 1 selected accession/)).toBeHidden();
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

    await expect(page.getByTestId("edgar-sync-button")).toContainText("Refresh NVDA filings");
    await expect(page.getByText("Refresh to check for newer filings.")).toBeVisible();
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

    await expect(page.getByTestId("edgar-sync-success-message")).toContainText(
      "NVDA has 36 filings saved locally. 2 downloaded",
    );
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
  const warmRequests = [];
  const workspaceRequests = [];
  const intelligenceStatusRequests = [];
  const indexRequests = [];
  const askRequests = [];
  const watchlistUpdates = [];
  let currentWorkspace = options.initialWorkspace ?? null;
  let currentWatchlist = options.initialWatchlist ?? ["NVDA", "AAPL"];
  let currentIntelligenceStatus =
    options.initialIntelligenceStatus ?? buildIntelligenceStatus({ workspace: currentWorkspace, readyForAsk: false, indexStatus: "missing" });

  await page.route("**/api/sources/edgar/status", async (route) => {
    await fulfillJson(route, options.sourceStatus ?? defaultEdgarStatus());
  });

  await page.route("**/api/sources/investor-pdfs/status", async (route) => {
    await fulfillJson(route, defaultInvestorPdfStatus());
  });

  await page.route("**/api/account/watchlist", async (route) => {
    if (route.request().method() === "POST") {
      const request = route.request().postDataJSON();
      currentWatchlist = request?.symbols ?? [];
      watchlistUpdates.push(currentWatchlist);
    }
    await fulfillJson(route, buildWatchlistResponse(currentWatchlist));
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

  await page.route("**/api/sources/edgar/warm", async (route) => {
    const request = route.request().postDataJSON();
    warmRequests.push(request);
    await fulfillJson(route, options.onWarm ? options.onWarm(request) : buildWarmResponse({ request }));
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
    await fulfillJson(route, options.onAsk ? await options.onAsk(request, currentWorkspace) : buildQuestionResponse({ request }));
  });

  return {
    syncRequests,
    warmRequests,
    workspaceRequests,
    intelligenceStatusRequests,
    indexRequests,
    askRequests,
    watchlistUpdates,
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

function buildWarmResponse({ request } = {}) {
  const issuerQueries = request?.issuerQueries?.length ? request.issuerQueries : ["NVDA", "AAPL"];
  return {
    mode: request?.mode ?? "metadata-only",
    requestedIssuers: issuerQueries.length,
    warmedIssuers: issuerQueries.length,
    failedIssuers: 0,
    results: issuerQueries.map((issuerQuery) => ({
      issuerQuery,
      ticker: issuerQuery.toUpperCase(),
      status: "warmed",
      metadataStatus: "fresh",
      bodyCacheStatus: request?.mode === "body-cache" ? "updated" : null,
      intelligenceStatus: null,
      message: "Metadata warmed.",
    })),
    generatedAt: "2026-04-27T20:05:00Z",
  };
}

function buildWatchlistResponse(symbols) {
  return {
    symbols,
    statePath: "/tmp/research-root/.app/watchlist.json",
    updatedAt: "2026-04-27T20:05:00Z",
  };
}

function buildIntelligenceStatus({ workspace, readyForAsk = false, indexStatus = "missing", indexedChunks = 0, job, limitations } = {}) {
  const ticker = workspace?.ticker ?? "NVDA";
  const outputDir = workspace?.workspace?.outputDir ?? null;
  const readinessLimitations = limitations ?? (readyForAsk ? [] : ["No EDGAR intelligence index has been built for this workspace."]);
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
      limitations: readinessLimitations,
    },
    job: job ?? {
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
    limitations: readinessLimitations,
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
  const summary = page.getByTestId("edgar-workspace-details");
  await expect(summary).toContainText(details.ticker);
  await expect(summary).toContainText(`${details.cachedFilings} filings saved locally`);
  await expect(summary).not.toContainText(details.stockPath);
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
  await page.getByRole("tab", { name: "Ask filings", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Ask filings", exact: true })).toHaveAttribute("aria-selected", "true");
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
