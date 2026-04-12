import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { chromium } from "playwright";

const DASHBOARD_URL = "http://127.0.0.1:5173";
const STATE_PATH = path.join(os.tmpdir(), "investing-platform-phase1-self-test.json");
const ARTIFACT_DIR = path.join(process.cwd(), "artifacts", "phase1-self-test");
const REQUIRED_TICKERS = ["AAPL", "IREN", "SPY", "TSLA"];
const RANDOM_TICKER_POOL = ["AMD", "AMZN", "COIN", "GOOGL", "META", "NFLX", "PLTR", "SMCI"];

async function main() {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1510, height: 1180 } });

  try {
    await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="chain-symbol-input"]', { timeout: 30000 });
    await ensureSidebarClosed(page);

    const tradeTicker = await pickTradeTicker();
    const screenshotBase = path.join(ARTIFACT_DIR, `${new Date().toISOString().replaceAll(":", "-")}-${tradeTicker}`);
    const inputBox = await page.locator('[data-testid="chain-symbol-input"]').boundingBox();

    const inspectedTickers = [];
    for (const ticker of REQUIRED_TICKERS) {
      inspectedTickers.push(await inspectTicker(page, ticker));
    }

    const tradeInspection = await inspectTicker(page, tradeTicker);
    const expirySwitch = await switchExpiry(page);

    const marketableBuy = await submitOrderFlow(page, {
      action: "BUY",
      buttonPrefix: "put",
      orderType: "MKT",
    });

    const restingSell = await submitOrderFlow(page, {
      action: "SELL",
      buttonPrefix: "call",
      orderType: "LMT",
      limitTransform: (referencePrice) => Math.max(referencePrice * 3, referencePrice + 2).toFixed(2),
      expectRestingOrder: true,
    });

    await page.screenshot({ path: `${screenshotBase}-final.png`, fullPage: true });

    const result = {
      sidebarClosed: (await page.locator('button[aria-label="Expand sidebar"]').count()) > 0,
      inputTopPx: inputBox?.y ?? null,
      inspectedTickers,
      tradeTicker,
      tradeInspection,
      expirySwitch,
      marketableBuy,
      restingSell,
      screenshots: [`${screenshotBase}-final.png`],
    };

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
}

async function inspectTicker(page, ticker) {
  console.log(`Inspecting ${ticker}...`);
  await loadSymbol(page, ticker);
  const rowCount = await page.locator('[data-testid^="chain-row-"]').count();
  const rowsText = await page.locator('[data-testid^="chain-row-"]').evaluateAll((nodes) =>
    nodes.slice(0, 4).map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? ""),
  );
  const hasNumericQuotes = rowsText.some((text) => /\d/.test(text));
  return {
    ticker,
    heading: ((await page.locator('[data-testid="chain-heading"]').textContent()) ?? "").trim(),
    rowCount,
    hasNumericQuotes,
  };
}

async function loadSymbol(page, ticker) {
  const input = page.locator('[data-testid="chain-symbol-input"]');
  await input.fill(ticker);
  await page.locator('[data-testid="chain-load-button"]').click();
  try {
    await page.waitForFunction(
      (expectedTicker) => {
        const heading = document.querySelector('[data-testid="chain-heading"]')?.textContent?.toUpperCase() ?? "";
        const rowCount = document.querySelectorAll('[data-testid^="chain-row-"]').length;
        return heading.includes(expectedTicker) && rowCount > 0;
      },
      ticker,
      { timeout: 65000 },
    );
  } catch (error) {
    const heading = ((await page.locator('[data-testid="chain-heading"]').textContent()) ?? "").trim();
    const rowCount = await page.locator('[data-testid^="chain-row-"]').count();
    const errorMessages = await page.locator(".text-danger").evaluateAll((nodes) =>
      nodes.map((node) => node.textContent?.replace(/\s+/g, " ").trim()).filter(Boolean),
    );
    throw new Error(
      `Timed out loading ${ticker}. Heading="${heading}" rowCount=${rowCount} errors=${JSON.stringify(errorMessages)} cause=${error}`,
    );
  }
}

async function switchExpiry(page) {
  const expiryButtons = page.locator('[data-testid^="expiry-button-"]');
  const count = await expiryButtons.count();
  if (count < 2) {
    return { switched: false, reason: "only_one_expiry" };
  }

  const targetButton = expiryButtons.nth(1);
  const targetExpiry = ((await targetButton.textContent()) ?? "").trim();
  await targetButton.click();

  const immediateRowCount = await page.locator('[data-testid^="chain-row-"]').count();
  if (immediateRowCount === 0) {
    throw new Error("Chain rows disappeared immediately after switching expiries.");
  }

  await page.waitForFunction(
    (expectedExpiry) => {
      const heading = document.querySelector('[data-testid="chain-heading"]')?.textContent ?? "";
      return heading.includes(expectedExpiry);
    },
    targetExpiry,
    { timeout: 45000 },
  );

  const finalRowCount = await page.locator('[data-testid^="chain-row-"]').count();
  return {
    switched: true,
    targetExpiry,
    immediateRowCount,
    finalRowCount,
  };
}

async function submitOrderFlow(page, { action, buttonPrefix, orderType, limitTransform, expectRestingOrder = false }) {
  const firstButton = page.locator(`[data-testid^="load-${buttonPrefix}-"]`).first();
  await firstButton.click();

  if (action === "BUY") {
    await page.locator('[data-testid="ticket-buy-button"]').click();
  } else {
    await page.locator('[data-testid="ticket-sell-button"]').click();
  }

  await page.locator('[data-testid="ticket-order-type-select"]').selectOption(orderType);

  if (orderType === "LMT" && limitTransform) {
    const limitInput = page.locator('[data-testid="ticket-limit-price-input"]');
    const currentValue = Number((await limitInput.inputValue()) || "0");
    const nextValue = limitTransform(Number.isFinite(currentValue) && currentValue > 0 ? currentValue : 0.25);
    await limitInput.fill(nextValue);
  }

  await page.locator('[data-testid="preview-order-button"]').click();
  await waitForSubmitReady(page);
  await page.locator('[data-testid="submit-order-button"]').click();
  await page.waitForSelector('[data-testid="submit-banner"]', { timeout: 30000 });

  const submitBanner = ((await page.locator('[data-testid="submit-banner"]').textContent()) ?? "").trim();
  const orderIdMatch = submitBanner.match(/Order\s+(\d+)/i);
  const orderId = orderIdMatch?.[1] ?? null;
  const statusMatch = submitBanner.match(/status\s+([A-Za-z]+)/i);
  const status = statusMatch?.[1] ?? "UNKNOWN";

  let openOrderStatus = null;
  let cancelResult = null;

  if (orderId) {
    const openOrder = page.locator(`[data-testid="open-order-${orderId}"]`);
    if (await openOrder.count()) {
      openOrderStatus = ((await openOrder.textContent()) ?? "").replace(/\s+/g, " ").trim();
    } else {
      await page.waitForTimeout(1500);
      if (await openOrder.count()) {
        openOrderStatus = ((await openOrder.textContent()) ?? "").replace(/\s+/g, " ").trim();
      }
    }

    if (openOrderStatus) {
      await page.locator(`[data-testid="cancel-order-${orderId}"]`).click();
      await page.waitForSelector('[data-testid="cancel-banner"]', { timeout: 30000 });
      cancelResult = ((await page.locator('[data-testid="cancel-banner"]').textContent()) ?? "").trim();
      if (expectRestingOrder) {
        await page.waitForFunction(
          (expectedOrderId) => !document.querySelector(`[data-testid="open-order-${expectedOrderId}"]`),
          orderId,
          { timeout: 30000 },
        );
      }
    } else if (expectRestingOrder) {
      throw new Error(`Expected order ${orderId} to rest in the working-orders panel, but it never appeared.`);
    }
  }

  return {
    action,
    orderType,
    orderId,
    status,
    openOrderStatus,
    cancelResult,
  };
}

async function waitForSubmitReady(page) {
  try {
    await page.waitForFunction(
      () => {
        const submitButton = document.querySelector('[data-testid="submit-order-button"]');
        return submitButton instanceof HTMLButtonElement && !submitButton.disabled;
      },
      undefined,
      { timeout: 45000 },
    );
  } catch (error) {
    const previewText = await page.locator("body").textContent();
    const submitDisabled = await page.locator('[data-testid="submit-order-button"]').isDisabled();
    throw new Error(
      `Preview never enabled submit. submitDisabled=${submitDisabled} bodySnippet=${JSON.stringify((previewText ?? "").slice(0, 900))} cause=${error}`,
    );
  }
}

async function ensureSidebarClosed(page) {
  const toggle = page.locator('button[aria-label="Collapse sidebar"], button[aria-label="Expand sidebar"]').first();
  if (!(await toggle.count())) {
    return;
  }
  const expanded = await toggle.getAttribute("aria-expanded");
  if (expanded === "true") {
    await toggle.click();
  }
}

async function pickTradeTicker() {
  let lastTicker = null;
  try {
    const raw = await fs.readFile(STATE_PATH, "utf8");
    lastTicker = JSON.parse(raw).lastTicker ?? null;
  } catch {
    lastTicker = null;
  }

  const choices = RANDOM_TICKER_POOL.filter((ticker) => ticker !== lastTicker);
  const ticker = choices[Math.floor(Math.random() * choices.length)];
  await fs.writeFile(STATE_PATH, JSON.stringify({ lastTicker: ticker }), "utf8");
  return ticker;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
