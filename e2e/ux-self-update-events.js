const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { loadSelfUpdatePayload } = require('./self-update-payload');

(async () => {
  const out = {
    startedAt: new Date().toISOString(),
    triggerStatus: null,
    triggerError: null,
    events: [],
    sawSelfUpdateEvent: false,
    sawConnectedAfterSelfUpdate: false,
  };

  const payload = loadSelfUpdatePayload();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto('http://localhost:3333/login', { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('Enter your username').fill('admin');
    await page.getByPlaceholder('Enter your password').fill('password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('http://localhost:3333/', { timeout: 15000 });

    await page.evaluate(() => {
      window.__ddEvents = [];
      window.addEventListener('dd:sse-self-update', () => {
        window.__ddEvents.push({ name: 'self-update', ts: Date.now() });
      });
      window.addEventListener('dd:sse-connected', () => {
        window.__ddEvents.push({ name: 'connected', ts: Date.now() });
      });
    });

    await page.waitForTimeout(5000);

    try {
      const resp = await context.request.post('http://localhost:3333/api/triggers/docker/local', {
        data: payload,
      });
      out.triggerStatus = resp.status();
    } catch (err) {
      out.triggerError = String(err && err.message ? err.message : err);
    }

    await page.waitForFunction(
      () => {
        return (
          Array.isArray(window.__ddEvents) &&
          window.__ddEvents.some((e) => e.name === 'self-update')
        );
      },
      { timeout: 30000 },
    );

    await page.waitForFunction(
      () => {
        const events = Array.isArray(window.__ddEvents) ? window.__ddEvents : [];
        const selfIdx = events.findIndex((e) => e.name === 'self-update');
        if (selfIdx < 0) return false;
        return events.slice(selfIdx + 1).some((e) => e.name === 'connected');
      },
      { timeout: 120000 },
    );

    out.events = await page.evaluate(() => window.__ddEvents || []);
    out.sawSelfUpdateEvent = out.events.some((e) => e.name === 'self-update');
    const selfIdx = out.events.findIndex((e) => e.name === 'self-update');
    out.sawConnectedAfterSelfUpdate =
      selfIdx >= 0 && out.events.slice(selfIdx + 1).some((e) => e.name === 'connected');

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
