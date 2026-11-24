import { expect, test } from "playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const reviewDir = path.resolve(process.cwd(), "../.impeccable/review");
const sidebarToggle = (page) =>
  page.getByRole("button", { name: /^(Expand|Collapse) sidebar$/ });

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Account Summary", exact: true }),
  ).toBeVisible();
});

test("icon labels appear on hover and focus; rail remains usable with the sidebar closed", async ({
  page,
}) => {
  const rail = page.getByRole("navigation", {
    name: "Primary navigation",
    exact: true,
  });
  const stocks = rail.getByRole("button", { name: "Stocks", exact: true });
  const tooltip = stocks.locator(".shell-rail-tooltip");
  await expect(tooltip).toBeHidden();
  await stocks.hover();
  await expect(tooltip).toBeVisible();
  await page.mouse.move(800, 400);
  await expect(tooltip).toBeHidden();
  await stocks.focus();
  await expect(tooltip).toBeVisible();
  const initialX = (await page.locator("main").boundingBox()).x;
  await sidebarToggle(page).click();
  await expect(sidebarToggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("navigation", { name: "Investing workspaces" }),
  ).toHaveCount(0);
  await expect
    .poll(async () => (await page.locator("main").boundingBox()).x)
    .toBeLessThan(initialX);
  await stocks.click();
  await expect(page.getByTestId("market-search-input")).toBeVisible();
  await page.reload();
  await expect(sidebarToggle(page)).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Control+b");
  await expect(sidebarToggle(page)).toHaveAttribute("aria-expanded", "true");
});

test("navigation resizes with pointer and keyboard and remembers width", async ({
  page,
}) => {
  const separator = page.getByRole("separator", { name: "Resize navigation" });
  const box = await separator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + 120, { steps: 8 });
  await page.mouse.up();
  await expect(separator).toHaveAttribute("aria-valuenow", "316");
  await page.reload();
  await expect(separator).toHaveAttribute("aria-valuenow", "316");
  await separator.press("ArrowLeft");
  await expect(separator).toHaveAttribute("aria-valuenow", "300");
  await separator.press("End");
  await expect(separator).toHaveAttribute("aria-valuenow", "380");
  await separator.dblclick();
  await expect(separator).toHaveAttribute("aria-valuenow", "256");
});

test("search reveals collapsed sections, supports empty results, and navigates", async ({
  page,
}) => {
  const group = page.getByTestId("shell-group-options");
  await group.getByRole("button", { name: "Options", exact: true }).click();
  await expect(page.getByTestId("nav-options-scanner")).toHaveCount(0);
  await page.keyboard.press("Control+k");
  const input = page.getByRole("textbox", { name: "Search workspaces" });
  await expect(input).toBeFocused();
  await input.fill("scanner");
  await expect(page.getByTestId("nav-options-scanner")).toBeVisible();
  await input.fill("no-such-workspace");
  await expect(page.getByText(/No workspaces found/)).toBeVisible();
  await input.fill("ticker");
  await page.getByTestId("nav-stocks-ticker").click();
  await expect(page.getByTestId("ticker-symbol-input")).toBeVisible();
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(page.getByTestId("nav-stocks-ticker")).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("tabs share the macOS title bar and stay clear of window controls when navigation collapses", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.isTauri = true;
    Object.defineProperty(navigator, "platform", { value: "MacIntel" });
  });
  await page.reload();
  const toggle = sidebarToggle(page);
  const titlebar = page.locator(".shell-topbar");
  await expect(titlebar).toHaveAttribute("data-tauri-drag-region", "true");
  const toggleBox = await toggle.boundingBox();
  expect(toggleBox.x).toBeGreaterThanOrEqual(88);
  expect(toggleBox.y + toggleBox.height).toBeLessThanOrEqual(48);
  const tabs = page.getByRole("tablist", { name: "Dashboard accounts" });
  expect((await tabs.boundingBox()).y).toBe(8);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect((await toggle.boundingBox()).x).toBe(toggleBox.x);
  expect((await tabs.boundingBox()).y).toBe(8);
  const secondTab = tabs.getByRole("tab").nth(1);
  await secondTab.click();
  await expect(secondTab).toHaveAttribute("aria-selected", "true");
  expect((await tabs.boundingBox()).x).toBeGreaterThanOrEqual(toggleBox.x + toggleBox.width + 8);
  await toggle.click();
  const searchButton = page.getByRole("button", {
    name: "Search workspaces",
    exact: true,
  });
  await expect(searchButton).toHaveText("");
  await searchButton.click();
  const searchInput = page.getByRole("textbox", { name: "Search workspaces" });
  await expect(searchInput).toBeFocused();
  await searchInput.press("Escape");
  await expect(searchButton).toBeFocused();
  await page.getByTestId("nav-stocks-intel").click();
  const intelTabs = page.getByRole("tablist", { name: "Stock Intel tools" });
  await expect(intelTabs).toBeVisible();
  expect((await intelTabs.boundingBox()).y).toBe(8);
  await toggle.click();
  await intelTabs.getByRole("tab").last().click();
  await expect(intelTabs.getByRole("tab").last()).toHaveAttribute("aria-selected", "true");
  expect((await intelTabs.boundingBox()).x).toBeGreaterThanOrEqual(toggleBox.x + toggleBox.width + 8);
});

test("account tabs use the top space and preserve account context across workspaces", async ({
  page,
}) => {
  const accounts = page
    .getByTestId("shell-group-accounts")
    .locator(".shell-nav-row");
  const secondName = await accounts.nth(1).innerText();
  await accounts.nth(1).click();
  await expect(
    page.getByRole("heading", { level: 1, name: secondName, exact: true }),
  ).toBeVisible();
  const tabs = page.getByRole("tablist", { name: "Dashboard accounts" });
  expect((await tabs.boundingBox()).y).toBeLessThan(48);
  await expect(
    page.getByRole("button", { name: "Go back", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Go forward", exact: true }),
  ).toHaveCount(0);
  await tabs.getByRole("tab").first().click();
  await expect(tabs.getByRole("tab").first()).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await tabs.getByRole("tab", { name: secondName, exact: true }).click();
  await page.getByTestId("nav-stocks-ticker").click();
  await expect(page.getByTestId("ticker-symbol-input")).toBeVisible();
  await page.getByRole("button", { name: "Go to dashboard" }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: secondName, exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 650 });
  await page.locator(".shell-sidebar-scroll").evaluate((element) => {
    element.scrollTop = 300;
  });
  expect(
    await page.locator("main").evaluate((element) => element.scrollTop),
  ).toBe(0);
  await expect(
    page.getByRole("button", { name: "Global Settings", exact: true }),
  ).toBeVisible();
});

test("mobile drawer dismisses, traps focus, and closes after navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sidebarToggle(page)).toHaveAttribute("aria-expanded", "false");
  await sidebarToggle(page).click();
  await expect(
    page.getByRole("dialog", { name: "Workspace navigation" }),
  ).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("inert", "");
  await page
    .getByRole("button", { name: "Global Settings", exact: true })
    .focus();
  await page.keyboard.press("Tab");
  await expect(sidebarToggle(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sidebarToggle(page)).toHaveAttribute("aria-expanded", "false");
  await sidebarToggle(page).click();
  await page
    .locator(".shell-drawer-backdrop")
    .click({ position: { x: 330, y: 200 } });
  await expect(sidebarToggle(page)).toHaveAttribute("aria-expanded", "false");
  await sidebarToggle(page).click();
  await page.getByTestId("nav-stocks-ticker").click();
  await expect(sidebarToggle(page)).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("ticker-symbol-input")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("capture shell at desktop, collapsed, compact desktop, and mobile sizes", async ({
  page,
}) => {
  await mkdir(reviewDir, { recursive: true });
  await page.waitForLoadState("networkidle");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.screenshot({
    path: path.join(reviewDir, "desktop.png"),
    fullPage: true,
  });
  await sidebarToggle(page).click();
  await page.getByRole("button", { name: "Stocks", exact: true }).hover();
  await expect(
    page.locator('.shell-rail-button[aria-label="Stocks"] .shell-rail-tooltip'),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(reviewDir, "collapsed.png"),
    fullPage: true,
  });
  await sidebarToggle(page).click();
  await page.mouse.move(800, 30);
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.screenshot({
    path: path.join(reviewDir, "compact-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: path.join(reviewDir, "mobile.png"),
    fullPage: true,
  });
  await sidebarToggle(page).click();
  await page.screenshot({
    path: path.join(reviewDir, "mobile-drawer.png"),
    fullPage: true,
  });
});
