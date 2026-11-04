import { expect, test } from "playwright/test";

async function mockSources(page, missingQuarter = false) {
  const metrics = (month, quarter) => ({
    totalPnl: 400, todayPnl: 4, monthlyPnl: month, quarterlyPnl: quarter,
    totalPnlPctBasis: 1000, todayPnlPctBasis: 1000, monthlyPnlPctBasis: 1000,
    quarterlyPnlPctBasis: quarter == null ? null : 2000,
    netWorth: 1400, netContributions: 1000, coverage: "complete", missingMetrics: [],
  });
  const folder = { sourceId: "test-fidelity", connectorId: "csvFolder", displayName: "Fidelity", accountKey: "primary",
    connected: true, configured: true, enabled: true, status: "ready", detail: "Test snapshot", directoryPath: "/fixtures" };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const responses = {
      "/api/connection-status": { connected: true, status: "connected", mode: "mock", accountId: "TEST", managedAccounts: ["TEST"], executionMode: "disabled", routedAccountType: "paper" },
      "/api/account/risk-summary": { account: { accountId: "TEST" }, alerts: [] },
      "/api/account/positions": { positions: [] },
      "/api/account/options-positions": { positions: [] },
      "/api/account/open-orders": { orders: [] },
      "/api/sources/ibkr/connector": { connected: true, configured: true, enabled: true, accountId: "TEST", status: "ready", flexStatus: "ready", flexNetContributions: 1000, discoveredAccounts: ["TEST"] },
      "/api/sources/ibkr/portfolio": { summary: metrics(10, 100) },
      "/api/sources/coinbase/status": { available: true, configured: true, status: "ready", detail: "Connected" },
      "/api/sources/coinbase/portfolio": { summary: metrics(20, 200), holdings: [], totalUsdValue: 1400 },
      "/api/sources/filesystem/connectors": [folder],
      "/api/sources/filesystem/sources/test-fidelity/portfolio": { summary: metrics(30, missingQuarter ? null : 300), holdings: [], holdingsCount: 0, totalValue: 1400 },
    };
    await route.fulfill({ json: responses[path] ?? {} });
  });
  await page.goto("/");
  await expect(page.getByRole("combobox", { name: "P&L period" })).toHaveCount(4);
}

function periodCards(page) {
  return page.locator(".panel-soft").filter({ has: page.getByRole("combobox", { name: "P&L period" }) });
}

test("month/quarter stays synchronized across account and all sources; switch is visual-only", async ({ page }) => {
  await mockSources(page);
  const selectors = page.getByRole("combobox", { name: "P&L period" });
  await expect(periodCards(page).nth(0)).toContainText("$60");
  await selectors.nth(2).click();
  await page.getByRole("option", { name: "Quarter", exact: true }).click();
  for (let i = 0; i < 4; i++) await expect(selectors.nth(i)).toHaveText("Quarter");
  for (const [index, amount] of ["$600", "$100", "$200", "$300"].entries()) {
    await expect(periodCards(page).nth(index)).toContainText(amount);
  }
  const toggles = page.getByRole("switch", { name: "Chart view" });
  const content = await periodCards(page).allTextContents();
  await toggles.first().click();
  await expect(toggles.first()).toHaveAttribute("aria-checked", "true");
  expect(await periodCards(page).allTextContents()).toEqual(content);
  await toggles.first().press("Space");
  await expect(toggles.first()).toHaveAttribute("aria-checked", "false");
  await expect(page.locator(".panel-soft").getByText(/Reported by|Derived from|Source breakdown/)).toHaveCount(0);
  await selectors.last().click();
  await page.getByRole("option", { name: "Month", exact: true }).click();
  await expect(periodCards(page).first()).toContainText("$60");
});

test("missing quarter history is excluded with a visible section note", async ({ page }) => {
  await mockSources(page, true);
  const selector = page.getByRole("combobox", { name: "P&L period" }).first();
  await selector.press("ArrowDown");
  await selector.press("End");
  await selector.press("Enter");
  await expect(periodCards(page).first()).toContainText("$300");
  await expect(page.getByText("Quarter PnL excludes Fidelity; period history is unavailable.")).toBeVisible();
  await expect(periodCards(page).last()).not.toContainText("$0");
  await expect(page.getByText("Quarter PnL is unavailable; opening history is missing.")).toBeVisible();
});


test("period menu supports dismissal and keyboard selection", async ({ page }) => {
  await mockSources(page);
  const selector = page.getByRole("combobox", { name: "P&L period" }).first();
  await selector.click();
  await expect(page.getByRole("option", { name: "Month", exact: true })).toHaveAttribute("aria-selected", "true");
  await selector.press("ArrowDown");
  await selector.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(selector).toHaveText("Month");
  await selector.press("Space");
  await selector.press("q");
  await selector.press("Enter");
  await expect(selector).toHaveText("Quarter");
  await selector.click();
  await page.getByRole("heading", { name: "Account Summary", exact: true }).click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await selector.click();
  await selector.press("Tab");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});
