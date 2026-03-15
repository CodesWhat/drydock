import { expect, test } from '@playwright/test';

test.describe('Containers view', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/containers');
    // Wait for view mode buttons to appear (containers page is loaded)
    await expect(page.getByRole('button', { name: 'Table view' })).toBeVisible({ timeout: 30_000 });
  });

  test('shows container count in header', async ({ page }) => {
    await expect(page.getByRole('banner').getByText('Containers')).toBeVisible();
    // Count format is "N/N" — wait for containers to load
    await expect(page.getByText(/\d+\/\d+/)).toBeVisible({ timeout: 30_000 });
  });

  test('has view mode toggle buttons', async ({ page }) => {
    await expect(page.getByRole('button', { name: 'Table view' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cards view' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'List view' })).toBeVisible();
  });

  test.describe('Card view', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByRole('button', { name: 'Cards view' }).click();
    });

    test('renders all containers as cards', async ({ page }) => {
      await expect(page.getByRole('button', { name: 'Select Remote Nginx' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Select PostgreSQL' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Select MongoDB' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Select Alpine (Latest)' })).toBeVisible();
    });

    test('shows current and latest version labels on update cards', async ({ page }) => {
      const nginxCard = page.getByRole('button', {
        name: 'Select PostgreSQL',
      });
      await expect(nginxCard.getByText('Current')).toBeVisible();
      await expect(nginxCard.getByText('Latest')).toBeVisible();
    });

    test('shows running status badge on cards', async ({ page }) => {
      const card = page.getByRole('button', {
        name: 'Select PostgreSQL',
      });
      await expect(card.getByText('running')).toBeVisible();
    });

    test('shows registry badge on cards', async ({ page }) => {
      await expect(page.getByText('Dockerhub').first()).toBeVisible();
    });

    test('container without update has no Latest label', async ({ page }) => {
      const alpineCard = page.getByRole('button', {
        name: 'Select Alpine (Latest)',
      });
      await expect(alpineCard.getByText('Current')).toBeVisible();
      // Alpine (Latest) should not show a "Latest" label (the word by itself)
      const latestLabels = alpineCard.locator(':text-is("Latest")');
      await expect(latestLabels).toHaveCount(0);
    });
  });

  test.describe('Table view', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByRole('button', { name: 'Table view' }).click();
    });

    test('renders table with correct column headers', async ({ page }) => {
      await expect(page.locator('th', { hasText: 'Container' })).toBeVisible();
      await expect(page.locator('th', { hasText: 'Version' })).toBeVisible();
      await expect(page.locator('th', { hasText: 'Kind' })).toBeVisible();
      await expect(page.locator('th', { hasText: 'Status' })).toBeVisible();
      await expect(page.locator('th', { hasText: 'Host' })).toBeVisible();
      await expect(page.locator('th', { hasText: 'Registry' })).toBeVisible();
    });

    test('renders at least one container row', async ({ page }) => {
      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();
      expect(await rows.count()).toBeGreaterThan(0);
    });

    test('shows version in table row', async ({ page }) => {
      const pgRow = page.locator('tr', { hasText: 'PostgreSQL' });
      // Version cell is the 3rd td (index 2)
      const versionCell = pgRow.locator('td').nth(2);
      await expect(versionCell).toContainText('16.0');
      await expect(versionCell).toContainText('18.3');
    });

    test('shows kind badges in kind column', async ({ page }) => {
      const pgRow = page.locator('tr', { hasText: 'PostgreSQL' });
      const kindCell = pgRow.locator('td').nth(3);
      await expect(kindCell).toContainText('major');
    });

    test('shows kind badges with correct types', async ({ page }) => {
      await expect(
        page.locator('tr', { hasText: 'Log Spammer' }).locator('td').nth(3),
      ).toContainText('minor');
      await expect(
        page.locator('tr', { hasText: 'PostgreSQL' }).locator('td').nth(3),
      ).toContainText('major');
      await expect(
        page.locator('tr', { hasText: 'Python (Unsafe)' }).locator('td').nth(3),
      ).toContainText('patch');
    });

    test('shows running status for all rendered containers', async ({ page }) => {
      const rows = page.locator('tbody tr');
      await expect(rows.first()).toBeVisible();
      const rowCount = await rows.count();
      expect(rowCount).toBeGreaterThan(0);

      const runningBadges = page.locator('tbody tr td:has-text("running")');
      await expect(runningBadges).toHaveCount(rowCount);
    });

    test('container without update shows dash for kind', async ({ page }) => {
      const alpineRow = page.locator('tr', { hasText: 'Alpine (Latest)' });
      await expect(alpineRow.getByText('—')).toBeVisible();
    });
  });

  test.describe('List view', () => {
    test.beforeEach(async ({ page }) => {
      await page.getByRole('button', { name: 'List view' }).click();
    });

    test('renders all containers as list items', async ({ page }) => {
      await expect(page.getByRole('button', { name: 'Select Remote Nginx' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Select PostgreSQL' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Select Alpine (Latest)' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Select Traefik Proxy' })).toBeVisible();
    });

    test('shows kind badge on list items with updates', async ({ page }) => {
      const pgItem = page.getByRole('button', {
        name: 'Select PostgreSQL',
      });
      await expect(pgItem).toContainText('major');
    });

    test('shows host location on list items', async ({ page }) => {
      const pgItem = page.getByRole('button', {
        name: 'Select PostgreSQL',
      });
      await expect(pgItem).toContainText('Local');
    });

    test('container without update has no kind badge', async ({ page }) => {
      const alpineItem = page.getByRole('button', {
        name: 'Select Alpine (Latest)',
      });
      await expect(alpineItem).toContainText('running');
      await expect(alpineItem).not.toContainText('minor');
      await expect(alpineItem).not.toContainText('major');
      await expect(alpineItem).not.toContainText('patch');
    });
  });

  test.describe('View mode persistence', () => {
    test('switching view modes updates the active button', async ({ page }) => {
      await page.getByRole('button', { name: 'Table view' }).click();
      await expect(page.getByRole('button', { name: 'Table view' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );

      await page.getByRole('button', { name: 'List view' }).click();
      await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(page.getByRole('button', { name: 'Table view' })).not.toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });
});
