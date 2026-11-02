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

  it('does not use deprecated overflow overlay', () => {
    expect(css).not.toMatch(/@supports\s*\(overflow:\s*overlay\)/);
    expect(css).not.toMatch(/overflow:\s*overlay/);
  });

  it('provides dd-scroll-stable utility with scrollbar-gutter stable', () => {
    expect(css).toMatch(/\.dd-scroll-stable\s*\{[^}]*scrollbar-gutter:\s*stable/);
  });
});

describe('style.css reduced motion', () => {
  it('has a global prefers-reduced-motion override that shortens animations and transitions', () => {
    const block = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/);
    expect(block).not.toBeNull();
    expect(block?.[0]).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(block?.[0]).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(block?.[0]).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });

  it('keeps progress spinners running', () => {
    expect(css).toMatch(/:not\(\.dd-spin, \.dd-spin-slow, \.dd-spin-fast\)/);
  });
});
