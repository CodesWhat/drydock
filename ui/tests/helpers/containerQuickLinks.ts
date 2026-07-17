import type { DOMWrapper } from '@vue/test-utils';
import { expect } from 'vitest';

type RequiredDOMWrapper = Pick<DOMWrapper<Element>, 'findAll' | 'get'>;

export const QUICK_LINK_SELECTOR =
  '[data-test="project-link"], [data-test="release-link"], [data-test="registry-link"]';

export function expectContainerQuickLinks(group: RequiredDOMWrapper, registryLookup: string): void {
  const actions = group.findAll(QUICK_LINK_SELECTOR);

  expect(actions.map((action) => action.attributes('data-test'))).toEqual([
    'project-link',
    'release-link',
    'registry-link',
  ]);

  const source = group.get('[data-test="project-link"]');
  expect(source.element.tagName).toBe('A');
  expect(source.attributes('target')).toBe('_blank');
  expect(source.attributes('rel')).toContain('noopener');

  const release = group.get('[data-test="release-link"]');
  expect(release.element.tagName).toBe('BUTTON');
  expect(release.attributes('aria-haspopup')).toBe('dialog');

  const registry = group.get('[data-test="registry-link"]');
  expect(registry.element.tagName).toBe('A');
  expect(registry.attributes('target')).toBeUndefined();
  const registryUrl = new URL(registry.attributes('href'), 'http://localhost');
  expect(registryUrl.pathname).toBe('/registries');
  expect(registryUrl.searchParams.get('q')).toBe(registryLookup);

  for (const action of actions) {
    expect(action.classes()).toEqual(expect.arrayContaining(['w-11', 'h-11']));
  }
}

export function quickLinkTestIds(group: RequiredDOMWrapper): Array<string | undefined> {
  return group.findAll(QUICK_LINK_SELECTOR).map((action) => action.attributes('data-test'));
}
