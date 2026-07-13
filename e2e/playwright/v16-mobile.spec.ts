import { expect, type Locator, type Page, type Route, test } from '@playwright/test';
import {
  dismissAnnouncementBanners,
  registerServerAvailabilityCheck,
} from './helpers/test-helpers';

registerServerAvailabilityCheck(test);

const FIXTURE_NAMES = ['V16 Mobile Fixture One', 'V16 Mobile Fixture Two'] as const;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectionFrom(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) {
    return [];
  }
  for (const key of ['data', 'items', 'entries'] as const) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }
  return [];
}

function replaceCollection(payload: unknown, collection: JsonRecord[]): unknown {
  if (Array.isArray(payload)) {
    return collection;
  }
  if (!isRecord(payload)) {
    return collection;
  }
  for (const key of ['data', 'items', 'entries'] as const) {
    if (Array.isArray(payload[key])) {
      return { ...payload, [key]: collection };
    }
  }
  return collection;
}

function fixtureContainer(source: JsonRecord, index: number): JsonRecord {
  const image = isRecord(source.image) ? source.image : {};
  const tag = isRecord(image.tag) ? image.tag : {};
  return {
    ...source,
    displayName: FIXTURE_NAMES[index],
    status: 'running',
    sourceRepo: 'github.com/CodesWhat/drydock',
    image: {
      ...image,
      name: 'nginx',
      registry: { name: 'hub', url: 'https://registry-1.docker.io' },
      tag: { ...tag, value: `1.25.${index + 1}` },
    },
    result: null,
    updateAvailable: false,
    updateKind: null,
    error: null,
    currentReleaseNotes: {
      title: `${FIXTURE_NAMES[index]} release`,
      body: `Deterministic release notes for ${FIXTURE_NAMES[index]}.`,
      url: `https://github.com/CodesWhat/drydock/releases/tag/v1.5.${index + 1}`,
      publishedAt: `2026-07-0${index + 1}T12:00:00.000Z`,
      provider: 'github',
    },
  };
}

async function interceptContainerCollection(route: Route): Promise<void> {
  const response = await route.fetch();
  const payload: unknown = await response.json();
  const collection = collectionFrom(payload);
  if (collection.length < FIXTURE_NAMES.length) {
    await route.fulfill({
      response,
      status: 503,
      json: { error: 'The v1.6 mobile fixture requires at least two QA containers' },
    });
    return;
  }
  const withFixtures = collection.map((container, index) =>
    index < FIXTURE_NAMES.length ? fixtureContainer(container, index) : container,
  );
  await route.fulfill({ response, json: replaceCollection(payload, withFixtures) });
}

async function openMobileContainers(page: Page): Promise<void> {
  await page.route(/\/api\/v1\/containers(?:\?.*)?$/, interceptContainerCollection);
  await page.goto('/containers');
  await dismissAnnouncementBanners(page);

  await expect(cardFor(page, FIXTURE_NAMES[0])).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Table view' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cards view' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'List view' })).toHaveCount(0);
  await expect(page.locator('[data-test="containers-grouped-views"] table')).toHaveCount(0);
}

function cardFor(page: Page, name: string): Locator {
  return page.locator('[data-test="dd-card"]').filter({ hasText: name }).first();
}

async function expectTouchTarget(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, 'expected a rendered touch target').not.toBeNull();
  expect(box!.width, 'touch target width').toBeGreaterThanOrEqual(44);
  expect(box!.height, 'touch target height').toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const rootOverflow =
          document.documentElement.scrollWidth - document.documentElement.clientWidth;
        const bodyOverflow = document.body.scrollWidth - window.innerWidth;
        return Math.max(rootOverflow, bodyOverflow);
      }),
    )
    .toBeLessThanOrEqual(1);
}

test.describe('v1.6 mobile release promises', () => {
  test('#242 forces card reflow and keeps mobile controls and detail panel touch-safe', async ({
    page,
  }) => {
    await openMobileContainers(page);
    await expectNoHorizontalOverflow(page);

    await expectTouchTarget(page.getByRole('button', { name: 'Toggle filters' }));
    await expectTouchTarget(page.getByRole('button', { name: 'Group by stack' }));
    await expectTouchTarget(page.getByRole('button', { name: 'Recheck for updates' }).first());
    await expectTouchTarget(page.locator('[data-test="dd-toolbar-sort-select"]'));
    await expectTouchTarget(page.locator('[data-test="dd-toolbar-sort-direction"]'));

    const firstCard = cardFor(page, FIXTURE_NAMES[0]);
    await firstCard.click({ position: { x: 8, y: 8 } });

    const dialog = page.locator('[data-test="container-side-detail"] [role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
    await dialog.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished));
    });
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox).not.toBeNull();
    expect(dialogBox!.x).toBeLessThanOrEqual(1);
    expect(dialogBox!.y).toBeLessThanOrEqual(1);
    expect(dialogBox!.width).toBeGreaterThanOrEqual(389);
    expect(dialogBox!.height).toBeGreaterThanOrEqual(843);

    for (const name of [
      'Open full page view',
      'Close details panel',
      'Stop',
      'Restart',
      'Scan',
      'Recheck for updates',
      'Delete',
      'Overview',
    ]) {
      await expectTouchTarget(dialog.getByRole('button', { name, exact: true }));
    }
    await expectNoHorizontalOverflow(page);
  });

  test('#295 keeps resource actions ordered and the release dialog touch-safe', async ({
    page,
  }) => {
    await openMobileContainers(page);

    const cards = FIXTURE_NAMES.map((name) => cardFor(page, name));
    const resourceGroups = cards.map((card) =>
      card.locator(
        '[data-test="container-card-resource-actions"] [data-test="container-quick-links"]',
      ),
    );
    const firstActions = resourceGroups[0].locator(
      '[data-test="project-link"], [data-test="current-release-notes-link"], [data-test="registry-link"]',
    );
    await expect(firstActions).toHaveCount(3);
    expect(
      await firstActions.evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-test')),
      ),
    ).toEqual(['project-link', 'current-release-notes-link', 'registry-link']);
    for (let index = 0; index < 3; index += 1) {
      await expectTouchTarget(firstActions.nth(index));
    }

    const releaseButtons = resourceGroups.map((group) =>
      group.locator('[data-test="current-release-notes-link"]'),
    );
    await releaseButtons[0].tap();
    const popover = page.locator('[data-test="release-notes-popover"]');
    await expect(popover).toHaveCount(1);
    await expect(popover).toContainText(`${FIXTURE_NAMES[0]} release`);
    const popoverBox = await popover.boundingBox();
    expect(popoverBox).not.toBeNull();
    expect(popoverBox!.x).toBeGreaterThanOrEqual(7);
    expect(popoverBox!.y).toBeGreaterThanOrEqual(0);
    expect(popoverBox!.x + popoverBox!.width).toBeLessThanOrEqual(383);
    expect(popoverBox!.y + popoverBox!.height).toBeLessThanOrEqual(844);
    await expect(popover.getByRole('button').first()).toBeFocused();

    await popover.getByRole('button', { name: 'Close' }).tap();
    await expect(popover).toHaveCount(0);
    await expect(releaseButtons[0]).toBeFocused();

    await releaseButtons[0].tap();
    await releaseButtons[1].tap();
    await expect(popover).toHaveCount(1);
    await expect(popover).toContainText(`${FIXTURE_NAMES[1]} release`);
    await expect(page.locator('[data-test="container-side-detail"]')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });
});
