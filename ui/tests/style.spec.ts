import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, '../src/style.css'), 'utf-8');

describe('style.css scrollbar rules', () => {
  it('sets scrollbar-width to thin globally', () => {
    expect(css).toContain('scrollbar-width: thin');
  });

  it('sets webkit scrollbar width to 6px', () => {
    expect(css).toMatch(/::-webkit-scrollbar\s*\{[^}]*width:\s*6px/);
  });

  it('uses transparent webkit scrollbar track', () => {
    expect(css).toMatch(/::-webkit-scrollbar-track\s*\{[^}]*background:\s*transparent/);
  });

  it('enables overflow overlay for .overflow-auto when supported', () => {
    expect(css).toMatch(/@supports\s*\(overflow:\s*overlay\)/);
    expect(css).toMatch(/\.overflow-auto\s*\{[^}]*overflow:\s*overlay;/);
  });

  it('enables overflow-y overlay for .overflow-y-auto when supported', () => {
    expect(css).toMatch(/\.overflow-y-auto\s*\{[^}]*overflow-y:\s*overlay;/);
  });

  it('enables overflow-x overlay for .overflow-x-auto when supported', () => {
    expect(css).toMatch(/\.overflow-x-auto\s*\{[^}]*overflow-x:\s*overlay;/);
  });
});
