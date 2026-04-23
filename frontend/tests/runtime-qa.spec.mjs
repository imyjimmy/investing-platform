import { expect, test } from "playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await ensureSidebarOpen(page);
  await expect(page.getByTestId("nav-stocks-market")).toBeVisible();
});

test("stocks market filters and opens ticker workspace", async ({ page }) => {
  await openWorkspace(page, "nav-stocks-market");
  await expect(page.getByTestId("market-search-input")).toBeVisible();

  await page.getByTestId("market-preset-high-beta").click();
  await expect(page.getByTestId("market-result-row-SMCI")).toBeVisible();
  await expect(page.getByTestId("market-result-row-NVDA")).toHaveCount(0);

  await page.getByTestId("market-preset-reset").click();
  await page.getByTestId("market-search-input").fill("NVDA");
  await expect(page.getByTestId("market-result-row-NVDA")).toBeVisible();
  await expect(page.locator('[data-testid^="market-result-row-"]')).toHaveCount(1);

  await page.getByTestId("market-open-ticker-NVDA").click();
  await expect(page.getByTestId("ticker-symbol-input")).toHaveValue("NVDA");
  await expect(page.getByTestId("ticker-overview-panel")).toBeVisible();
});

test("stocks ticker loads overview and financials", async ({ page }) => {
  await openWorkspace(page, "nav-stocks-ticker");

  await page.getByTestId("ticker-symbol-input").fill("AAPL");
  await page.getByTestId("ticker-load-button").click();

  await expect(page.getByText("AAPL Overview")).toBeVisible();
  await expect(page.getByTestId("ticker-overview-panel")).toBeVisible();
  await expect(page.getByTestId("ticker-financials-panel")).toBeVisible();
  await expect(page.getByTestId("ticker-financials-table")).toBeVisible();

  await page.getByTestId("ticker-financials-tab-cash_flow").click();
  await expect(page.getByTestId("ticker-financials-table")).toBeVisible();
});

test("options chain and option tools preserve loaded symbol context", async ({ page }) => {
  await openWorkspace(page, "nav-options-chain");
  await loadChain(page, "NVDA");

  const expiryButtons = page.locator('[data-testid^="expiry-button-"]');
  const expiryCount = await expiryButtons.count();
  if (expiryCount > 1) {
    const targetExpiry = ((await expiryButtons.nth(1).textContent()) ?? "").trim();
    await expiryButtons.nth(1).click();
    await expect
      .poll(async () => (await page.getByTestId("chain-heading").textContent()) ?? "", { timeout: 45_000 })
      .toContain(targetExpiry);
    await expect(page.locator('[data-testid^="chain-row-"]').first()).toBeVisible();
  }

  await page.locator('[data-testid^="chain-row-"]').first().locator("button").first().click();
  await expect(page.getByTestId("ticket-sell-button")).toBeVisible();

  await page.getByTestId("toggle-trade-rail").click();
  await expect(page.getByTestId("ticket-sell-button")).toHaveCount(0);
  await page.getByTestId("toggle-trade-rail").click();
  await expect(page.getByTestId("ticket-sell-button")).toBeVisible();

  await openWorkspace(page, "nav-options-valuation");
  await expect(page.getByText("Valuation Models")).toBeVisible();
  await expect(page.getByTestId("chain-symbol-input")).toHaveValue("NVDA");

  await openWorkspace(page, "nav-options-scanner");
  await expect(page.getByText("Yield And Liquidity Candidates")).toBeVisible();
  await expect(page.getByTestId("chain-symbol-input")).toHaveValue("NVDA");
});

async function openWorkspace(page, testId) {
  await ensureSidebarOpen(page);
  await page.getByTestId(testId).click();
}

async function loadChain(page, symbol) {
  await page.getByTestId("chain-symbol-input").fill(symbol);
  await page.getByTestId("chain-load-button").click();

  await expect(page.getByTestId("chain-symbol-input")).toHaveValue(symbol);
  await expect
    .poll(async () => ((await page.getByTestId("chain-heading").textContent()) ?? "").toUpperCase(), { timeout: 60_000 })
    .toContain(symbol);
  await expect
    .poll(async () => await page.locator('[data-testid^="chain-row-"]').count(), { timeout: 60_000 })
    .toBeGreaterThan(0);
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
