import { defineConfig, devices } from "@playwright/test";

// Browser checks for the marketing site, run against the production build
// (`next build` then `next start`), never the dev server. Three engines on
// purpose: the bugs this exists to catch (menus, <details>, focus) are
// engine-specific and WebKit-prone.
const PORT = Number(process.env.WEB_E2E_PORT || 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./browser-tests",
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : [["list"]],
  outputDir: "test-results",
  use: {
    baseURL,
    trace: "retain-on-failure",
    serviceWorkers: "block",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: "node browser-tests/serve.mjs",
    url: baseURL,
    // CI starts the server itself so the browsers can run in a container.
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
