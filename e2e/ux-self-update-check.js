const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { loadSelfUpdatePayload } = require('./self-update-payload');

(async () => {
  const out = {
    startedAt: new Date().toISOString(),
    overlaySeen: false,
    recovered: false,
    triggerStatus: null,
    triggerError: null,
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

    // Give AppLayout enough time to mount SSE and receive dd:connected
    await page.waitForTimeout(5000);

    try {
      const resp = await context.request.post('http://localhost:3333/api/triggers/docker/local', {
        data: payload,
      });
      out.triggerStatus = resp.status();
    } catch (err) {
      out.triggerError = String(err && err.message ? err.message : err);
    }

    const applying = page.getByText('Applying Update', { exact: false });
    await applying.waitFor({ state: 'visible', timeout: 30000 });
    out.overlaySeen = true;
    await page.screenshot({
      path: path.resolve(__dirname, '../artifacts/self-update-drill/ux-overlay-visible.png'),
    });

    await applying.waitFor({ state: 'hidden', timeout: 120000 });

    const dashboard = page.getByText('Dashboard', { exact: false });
    await dashboard.first().waitFor({ state: 'visible', timeout: 30000 });
    out.recovered = true;
    await page.screenshot({
      path: path.resolve(__dirname, '../artifacts/self-update-drill/ux-recovered.png'),
    });
  } finally {
    out.finishedAt = new Date().toISOString();
    fs.writeFileSync(
      path.resolve(__dirname, '../artifacts/self-update-drill/ux-self-update-check.json'),
      JSON.stringify(out, null, 2),
    );
    await browser.close();
  }
})();
