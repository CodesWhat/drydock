const { After, AfterAll, Given, Then, When, setDefaultTimeout } = require('@cucumber/cucumber');
const assert = require('node:assert');
const { chromium, expect } = require('@playwright/test');
const config = require('../../config');

const baseUrl = `${config.protocol}://${config.host}:${config.port}`;
const NAVIGATION_TIMEOUT_MS = 20_000;
const RENDER_TIMEOUT_MS = 30_000;

let browser;

setDefaultTimeout(60_000);

function normalizePath(path) {
  const normalized = path.trim().replace(/\/+$/, '');
  return normalized || '/';
}

async function ensureBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: process.env.DD_UI_HEADLESS !== 'false',
    });
  }
  return browser;
}

async function ensurePage(world) {
  if (!world.uiContext) {
    const activeBrowser = await ensureBrowser();
    world.uiContext = await activeBrowser.newContext({ baseURL: baseUrl });
  }

  if (!world.uiPage) {
    world.uiPage = await world.uiContext.newPage();
  }

  return world.uiPage;
}

async function openUiRoute(world, path) {
  const page = await ensurePage(world);
  const targetUrl = new URL(path, baseUrl).toString();
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('#app').waitFor({ state: 'visible', timeout: RENDER_TIMEOUT_MS });
  await page.waitForLoadState('networkidle', { timeout: 2_500 }).catch(() => {});
  world.uiCurrentPath = path;
  return page;
}

async function waitForCurrentPath(page, path) {
  const expectedPath = normalizePath(path);
  await page.waitForURL((url) => normalizePath(url.pathname) === expectedPath, {
    timeout: NAVIGATION_TIMEOUT_MS,
  });
}

AfterAll(async () => {
  await browser?.close();
  browser = undefined;
});

After(async function () {
  await this.uiContext?.close();
  this.uiContext = undefined;
  this.uiPage = undefined;
  this.uiCurrentPath = undefined;
});

Given(/^I am signed into the UI$/, async function () {
  const page = await openUiRoute(this, '/login');
  await expect(page.getByPlaceholder('Enter your username')).toBeVisible({
    timeout: RENDER_TIMEOUT_MS,
  });
  await page.getByPlaceholder('Enter your username').fill(config.username);
  await page.getByPlaceholder('Enter your password').fill(config.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await waitForCurrentPath(page, '/');
});

When(/^I open UI route (.+)$/, async function (path) {
  const page = await openUiRoute(this, path);
  await waitForCurrentPath(page, path);
});

Then(/^the UI route should render (.+)$/, async function (text) {
  assert.ok(this.uiPage, 'UI page was not opened');
  const scope =
    normalizePath(this.uiCurrentPath) === '/login'
      ? this.uiPage.locator('body')
      : this.uiPage.locator('main');
  await expect(scope).toContainText(text, { timeout: RENDER_TIMEOUT_MS });
});
