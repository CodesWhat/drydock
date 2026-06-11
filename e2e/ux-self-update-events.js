const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { loadSelfUpdatePayload } = require('./self-update-payload');

// Asserts the new self-update event contract (v1.5.0+):
//   1. dd:sse-self-update fires on the original page (SSE store emitted self-update).
//   2. AppLayout's status-poll detects the terminal state and calls location.replace('/login'),
//      so the page URL becomes /login — that navigation is the recovery signal.
//      (The old contract looked for dd:sse-connected after self-update; that is wrong because
//       the store now closes the EventSource on self-update and the SPA hard-reloads.)
//   3. After logging in on the new page, dd:sse-connected fires — the fresh SPA on new assets
//      is connected.
//
// Because the page hard-reloads during recovery, window.__ddEvents installed via
// page.evaluate() would be wiped.  We use context.addInitScript() so every page load
// (including the post-reload /login page and the subsequent Dashboard page) initialises
// window.__ddEvents and attaches the listeners before any script runs.

(async () => {
  const out = {
    contract: 'v1.5.0-status-poll-reload',
    startedAt: new Date().toISOString(),
    triggerStatus: null,
    triggerError: null,
    sawSelfUpdateEvent: false,
    sawLoginNavigation: false,
    sawConnectedAfterRecovery: false,
    events: [],
  };

  const payload = loadSelfUpdatePayload();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  // Install the event-capture script on every page load so it survives the hard-reload.
  await context.addInitScript(() => {
    window.__ddEvents = window.__ddEvents || [];
    window.addEventListener('dd:sse-self-update', () => {
      window.__ddEvents.push({ name: 'self-update', ts: Date.now() });
    });
    window.addEventListener('dd:sse-connected', () => {
      window.__ddEvents.push({ name: 'connected', ts: Date.now() });
    });
  });

  const page = await context.newPage();

  try {
    await page.goto('http://localhost:3333/login', { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('Enter your username').fill('admin');
    await page.getByPlaceholder('Enter your password').fill('password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('http://localhost:3333/', { timeout: 15000 });

    // Give AppLayout enough time to mount SSE and receive dd:connected.
    await page.waitForTimeout(5000);

    try {
      const resp = await context.request.post('http://localhost:3333/api/triggers/docker/local', {
        data: payload,
      });
      out.triggerStatus = resp.status();
    } catch (err) {
      out.triggerError = String(err && err.message ? err.message : err);
    }

    // 1. Wait for dd:sse-self-update on the original page.
    await page.waitForFunction(
      () =>
        Array.isArray(window.__ddEvents) && window.__ddEvents.some((e) => e.name === 'self-update'),
      { timeout: 30000 },
    );
    out.sawSelfUpdateEvent = true;

    // 2. Wait for AppLayout to hard-reload to /login (status-poll detected terminal state).
    await page.waitForURL('**/login', { timeout: 120000 });
    out.sawLoginNavigation = true;

    await page.screenshot({
      path: path.resolve(__dirname, '../artifacts/self-update-drill/ux-events-login.png'),
    });

    // 3. Log in on the new page (QA compose has no /store volume — session is gone).
    await page.getByPlaceholder('Enter your username').fill('admin');
    await page.getByPlaceholder('Enter your password').fill('password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('http://localhost:3333/', { timeout: 15000 });

    // Wait for the fresh SPA to connect to the new server's SSE endpoint.
    await page.waitForFunction(
      () =>
        Array.isArray(window.__ddEvents) && window.__ddEvents.some((e) => e.name === 'connected'),
      { timeout: 30000 },
    );
    out.sawConnectedAfterRecovery = true;

    out.events = await page.evaluate(() => window.__ddEvents || []);

    await page.screenshot({
      path: path.resolve(__dirname, '../artifacts/self-update-drill/ux-events-final.png'),
    });
  } finally {
    out.finishedAt = new Date().toISOString();
    fs.writeFileSync(
      path.resolve(__dirname, '../artifacts/self-update-drill/ux-self-update-events.json'),
      JSON.stringify(out, null, 2),
    );
    await browser.close();
  }
})();
