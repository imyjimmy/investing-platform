import { defineConfig } from "playwright/test";

const BACKEND_PORT = 8010;
const FRONTEND_PORT = 4173;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: FRONTEND_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    viewport: { width: 1510, height: 1180 },
    headless: true,
  },
  webServer: [
    {
      command: `bash -lc 'cd .. && PYTHONPATH=\"$PWD/src\" INVESTING_PLATFORM_DATA_MODE=mock INVESTING_PLATFORM_BACKEND_PORT=${BACKEND_PORT} INVESTING_PLATFORM_FRONTEND_PORT=${FRONTEND_PORT} ./scripts/venv.sh run .venv -- uvicorn investing_platform.main:app --host 127.0.0.1 --port ${BACKEND_PORT}'`,
      url: `${BACKEND_URL}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `bash -lc 'VITE_API_BASE_URL=${BACKEND_URL} npm run build && VITE_API_BASE_URL=${BACKEND_URL} npm run preview -- --host 127.0.0.1 --port ${FRONTEND_PORT}'`,
      url: FRONTEND_URL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
