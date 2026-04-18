import { expect, test } from '@playwright/test';
import {
  dismissAnnouncementBanners,
  registerServerAvailabilityCheck,
} from './helpers/test-helpers';

registerServerAvailabilityCheck(test);

test.describe('Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await dismissAnnouncementBanners(page);
    await expect(page.locator('main')).toContainText('Updates Available', { timeout: 30_000 });
  });

  test('stat cards render labels and numeric values', async ({ page }) => {
    const statLabels = ['Registries', 'Containers', 'Updates Available', 'Security Issues'];

    for (const label of statLabels) {
      const card = page.locator('.stat-card').filter({ hasText: label }).first();
      await expect(card).toBeVisible();
      await expect(card).toContainText(/\d+/);
    }
  });

  test('critical dashboard widgets are present', async ({ page }) => {
    const requiredSections = [
      'Updates Available',
      'Update Breakdown',
      'Host Status',
      'Security Overview',
    ];

    for (const section of requiredSections) {
      await expect(page.locator('main')).toContainText(section);
    }
  });

  test('updates available columns stay aligned while the widget scrolls', async ({ page }) => {
    const scrollContainer = page.locator(
      '[aria-label="Updates Available widget"] .dd-scroll-stable',
    );
    await expect(scrollContainer).toBeVisible();

    const samples = await scrollContainer.evaluate(async (el) => {
      const table = el.closest('[aria-label="Updates Available widget"]')?.querySelector('table');
      const headerRow = table?.querySelector('thead tr');
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
      const stops = [0, 0.25, 0.5, 0.75, 1].map((pct) => Math.round(maxScroll * pct));
      const results: Array<{
        headers: Array<{ left: number; width: number }>;
        scrollTop: number;
      }> = [];

      for (const target of stops) {
        el.scrollTop = target;
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const headers = headerRow
          ? Array.from(headerRow.children).map((cell) => {
              const rect = cell.getBoundingClientRect();
              return {
                left: Number(rect.left.toFixed(3)),
                width: Number(rect.width.toFixed(3)),
              };
            })
          : [];

        results.push({ scrollTop: el.scrollTop, headers });
      }

      return { maxScroll, results };
    });

    expect(samples.maxScroll).toBeGreaterThan(0);
    expect(samples.results[0]?.headers.length).toBeGreaterThan(0);

    const baseline = samples.results[0].headers;
    for (const sample of samples.results.slice(1)) {
      for (const [index, header] of baseline.entries()) {
        expect(
          Math.abs(sample.headers[index].left - header.left),
          `header ${index} drifted horizontally at scrollTop=${sample.scrollTop}`,
        ).toBeLessThanOrEqual(0.5);
        expect(
          Math.abs(sample.headers[index].width - header.width),
          `header ${index} width changed at scrollTop=${sample.scrollTop}`,
        ).toBeLessThanOrEqual(0.5);
      }
    }
  });

  test('dashboard updates start in place without leaving the dashboard', async ({ page }) => {
    const widget = page.locator('[aria-label="Updates Available widget"]');
    const updateButtons = widget.locator('[data-test="dashboard-update-btn"]');

    await expect(updateButtons.first()).toBeVisible();

    const buttonCountBefore = await updateButtons.count();
    const targetButton = updateButtons.first();
    const targetRow = targetButton.locator('xpath=ancestor::tr');
    const targetName = (await targetRow.locator('.font-medium').first().textContent())?.trim();

    expect(targetName).toBeTruthy();

    const updateAccepted = page.waitForResponse((response) => {
      return (
        response.request().method() === 'POST' &&
        /\/api\/v1\/containers\/[^/]+\/update$/.test(response.url()) &&
        response.status() === 202
      );
    });

    await targetButton.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`Update ${targetName} now?`);
    await dialog.getByRole('button', { name: 'Update', exact: true }).click();

    await updateAccepted;

    await expect(page).toHaveURL(/\/$/);

    let sawInFlightState = false;
    let buttonCountAfter = buttonCountBefore;
    const deadline = Date.now() + 15_000;

    while (Date.now() < deadline) {
      const widgetText = await widget.innerText();
      buttonCountAfter = await updateButtons.count();
      if (/Updating|Queued/i.test(widgetText)) {
        sawInFlightState = true;
        break;
      }
      if (buttonCountAfter < buttonCountBefore) {
        break;
      }
      await page.waitForTimeout(500);
    }

    expect(sawInFlightState || buttonCountAfter < buttonCountBefore).toBeTruthy();
  });
});
