const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const { loadSelfUpdatePayload } = require('./self-update-payload');

// Asserts the new self-update recovery contract (v1.5.0+):
//   1. Overlay becomes visible after triggering.
//   2. The drydock container is replaced (new container ID) BEFORE the overlay clears.
//   3. Recovery lands on Dashboard (session survived) or /login (session lost — QA compose
//      has no /store volume, so the new container has no session and no operation row).
//      In the login case we log in again and confirm Dashboard appears.
//
// The OLD (buggy) flow dismissed the overlay as soon as the native EventSource reconnect
// succeeded — before the SPA reloaded stale assets.  This script detects that regression:
// containerSwapped must be true when the overlay disappears.

(async () => {
  const out = {
    contract: 'v1.5.0-status-poll-reload',
    startedAt: new Date().toISOString(),
    overlaySeen: false,
    containerIdBefore: null,
    containerIdAfter: null,
    containerSwapped: false,
    recoveryPath: null,
    recovered: false,
    triggerStatus: null,
    triggerError: null,
  };

  const payload = loadSelfUpdatePayload();
  const containerName = typeof payload.name === 'string' ? payload.name.trim() : '';

  // Capture container ID before triggering.
  if (containerName !== '') {
    try {
      out.containerIdBefore = execFileSync('docker', ['inspect', '-f', '{{.Id}}', containerName], {
        encoding: 'utf8',
      }).trim();
    } catch {
      out.containerIdBefore = null;
    }
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
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

    const applying = page.getByText('Applying Update', { exact: false });
    await applying.waitFor({ state: 'visible', timeout: 30000 });
    out.overlaySeen = true;
    await page.screenshot({
      path: path.resolve(__dirname, '../artifacts/self-update-drill/ux-overlay-visible.png'),
    });

    // Wait for the overlay to disappear (AppLayout's status-poll detected terminal state
    // and hard-reloaded to /login).
    await applying.waitFor({ state: 'hidden', timeout: 120000 });

    // Check container swap — must have happened BEFORE the overlay cleared.
    if (containerName !== '') {
      try {
        out.containerIdAfter = execFileSync('docker', ['inspect', '-f', '{{.Id}}', containerName], {
          encoding: 'utf8',
        }).trim();
      } catch {
        out.containerIdAfter = null;
      }
    }
    out.containerSwapped =
      out.containerIdBefore !== null &&
      out.containerIdAfter !== null &&
      out.containerIdBefore !== out.containerIdAfter;

    if (!out.containerSwapped) {
      throw new Error(
        `Container ID did not change (before=${out.containerIdBefore}, after=${out.containerIdAfter}). ` +
          'Overlay was dismissed while the old container was still running — premature overlay-clear regression.',
      );
    }

    // After the hard-reload AppLayout navigates to /login.  Accept Dashboard (session survived)
    // or the login form (QA compose: no /store volume, session is gone on new container).
    const currentUrl = page.url();
    const onLogin =
      currentUrl.includes('/login') ||
      (await page
        .getByPlaceholder('Enter your username')
        .isVisible()
        .catch(() => false));

    if (onLogin) {
      out.recoveryPath = 'login-required';
      await page.getByPlaceholder('Enter your username').fill('admin');
      await page.getByPlaceholder('Enter your password').fill('password');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.waitForURL('http://localhost:3333/', { timeout: 15000 });
    } else {
      out.recoveryPath = 'session-survived';
    }

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
