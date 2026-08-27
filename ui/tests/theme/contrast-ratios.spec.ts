import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// WCAG 2.2 normal-text target: contrast ratio >= 4.5:1.
// https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
const WCAG_AA_NORMAL_TEXT = 4.5;

// The `-muted` surface tokens are `color-mix(in srgb, var(--dd-<tone>) 15%, transparent)`,
// defined once in the :root block and inherited by every theme. This constant mirrors that
// 15% literally; the "muted formula stays 15%" test below fails loudly if tokens.css ever
// changes the percentage without this file being updated to match.
const MUTED_MIX_ALPHA = 0.15;

const tokensSource = readFileSync(join(process.cwd(), 'src/theme/tokens.css'), 'utf8');

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const num = Number.parseInt(hex.replace('#', ''), 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexToRgb(hexA));
  const lumB = relativeLuminance(hexToRgb(hexB));
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

// Alpha-composites `fgHex` (painted at `alpha`) over `bgHex`, matching how the browser
// resolves `color-mix(in srgb, var(--dd-<tone>) 15%, transparent)` painted on a surface.
function compositeOver(fgHex: string, alpha: number, bgHex: string): string {
  const fg = hexToRgb(fgHex);
  const bg = hexToRgb(bgHex);
  const mix = (a: number, b: number) => Math.round(a * alpha + b * (1 - alpha));
  const toHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${toHex(mix(fg.r, bg.r))}${toHex(mix(fg.g, bg.g))}${toHex(mix(fg.b, bg.b))}`;
}

// Extracts the first `{ ... }` block that follows `selector` in the source, matching how
// tests/theme/themeTokens.spec.ts anchors on the same selector strings.
function extractBlock(source: string, selector: string): string {
  const start = source.indexOf(selector);
  if (start === -1) {
    throw new Error(`selector not found in tokens.css: ${selector}`);
  }
  const braceStart = source.indexOf('{', start);
  const braceEnd = source.indexOf('}', braceStart);
  return source.slice(braceStart, braceEnd);
}

function getHex(block: string, varName: string): string {
  const match = block.match(new RegExp(`${varName}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) {
    throw new Error(`token ${varName} not found in block`);
  }
  return match[1];
}

interface ThemeBlock {
  name: string;
  selector: string;
}

// Every dark-mode block tokens.css currently ships. One Dark is the default and lives at
// :root; the rest are opted into via `html.theme-<family>.dark`.
const DARK_THEMES: ThemeBlock[] = [
  { name: 'one-dark', selector: ':root' },
  { name: 'github', selector: 'html.theme-github.dark' },
  { name: 'dracula', selector: 'html.theme-dracula.dark' },
  { name: 'catppuccin', selector: 'html.theme-catppuccin.dark' },
  { name: 'gruvbox', selector: 'html.theme-gruvbox.dark' },
  { name: 'ayu', selector: 'html.theme-ayu.dark' },
];

// The light-mode counterpart of every family above. Selector strings only need to be a
// unique substring of the rule's own header line; extractBlock finds the next `{...}` after
// that substring, so the shared `html.light:not(...)` selector on one-dark's light block
// doesn't need to be reproduced here.
const LIGHT_THEMES: ThemeBlock[] = [
  { name: 'one-dark-light', selector: 'html.theme-one-dark.light' },
  { name: 'github-light', selector: 'html.theme-github.light' },
  { name: 'dracula-light', selector: 'html.theme-dracula.light' },
  { name: 'catppuccin-light', selector: 'html.theme-catppuccin.light' },
  { name: 'gruvbox-light', selector: 'html.theme-gruvbox.light' },
  { name: 'ayu-light', selector: 'html.theme-ayu.light' },
];

const ALL_THEMES: ThemeBlock[] = [...DARK_THEMES, ...LIGHT_THEMES];

const SURFACE_VARS = [
  '--dd-bg',
  '--dd-bg-sidebar',
  '--dd-bg-card',
  '--dd-bg-elevated',
  '--dd-bg-inset',
];
// --dd-neutral is included alongside the text tokens: in every dark theme it's defined as a
// literal duplicate of --dd-text-secondary or --dd-text-muted (not a var() reference), and it
// renders as normal body text (AppStatusIndicator's "neutral" tone, NoUpdateReasonBadge, ...).
const TEXT_VARS = ['--dd-text', '--dd-text-secondary', '--dd-text-muted', '--dd-neutral'];
const TONE_VARS = ['--dd-warning', '--dd-caution', '--dd-danger', '--dd-success', '--dd-info'];
// --dd-primary and --dd-alt are accent/interactive colors, not plain body text, so they're
// excluded from TEXT_VARS above (most call sites are borders, icons, or focus rings, which
// only need the 3:1 WCAG 1.4.11 non-text target). But both ARE painted as real small badge/chip
// text on their own 15%-muted surface at several call sites (utils/display.ts'
// `updateKindColor('patch')`, `registryColorText('ghcr')`, `suggestedTagColor()`;
// views/AuthView.vue's `authTypeBadge('oidc')`; layouts/AppLayout.vue's active search-scope
// chip) — the exact same own-muted-surface pattern TONE_VARS checks above, just for two tokens
// TONE_VARS doesn't cover. Checked separately so a regression in that specific pattern is
// caught without demanding 4.5:1 out of every flat-surface pairing (most of which are
// legitimately border/icon roles subject to the looser 3:1 target instead).
const ACCENT_VARS = ['--dd-primary', '--dd-alt'];

describe('dark theme contrast (WCAG 2.2 normal-text target, 4.5:1)', () => {
  it('assumes the -muted surfaces are a 15% color-mix, matching tokens.css', () => {
    for (const tone of ['warning', 'caution', 'danger', 'success', 'info']) {
      expect(tokensSource).toContain(
        `--dd-${tone}-muted: color-mix(in srgb, var(--dd-${tone}) 15%, transparent);`,
      );
    }
  });

  describe.each(DARK_THEMES)('$name', ({ selector }) => {
    const block = extractBlock(tokensSource, selector);
    const text: Record<string, string> = Object.fromEntries(
      TEXT_VARS.map((name) => [name, getHex(block, name)]),
    );
    const surface: Record<string, string> = Object.fromEntries(
      SURFACE_VARS.map((name) => [name, getHex(block, name)]),
    );
    const tone: Record<string, string> = Object.fromEntries(
      TONE_VARS.map((name) => [name, getHex(block, name)]),
    );
    const accent: Record<string, string> = Object.fromEntries(
      ACCENT_VARS.map((name) => [name, getHex(block, name)]),
    );

    it.each(TEXT_VARS.flatMap((t) => SURFACE_VARS.map((s) => [t, s] as const)))(
      'body text %s on surface %s clears 4.5:1',
      (textVar, surfaceVar) => {
        const ratio = contrastRatio(text[textVar], surface[surfaceVar]);
        expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
      },
    );

    it.each(TONE_VARS)(
      'tone text %s on its own muted surface (over --dd-bg-card) clears 4.5:1',
      (toneVar) => {
        const mutedBg = compositeOver(tone[toneVar], MUTED_MIX_ALPHA, surface['--dd-bg-card']);
        const ratio = contrastRatio(tone[toneVar], mutedBg);
        expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
      },
    );

    it.each(ACCENT_VARS)(
      'accent badge text %s on its own muted surface (over --dd-bg-card) clears 4.5:1',
      (accentVar) => {
        const mutedBg = compositeOver(accent[accentVar], MUTED_MIX_ALPHA, surface['--dd-bg-card']);
        const ratio = contrastRatio(accent[accentVar], mutedBg);
        expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
      },
    );
  });
});

// AppToast paints its tone text directly on `color-mix(in srgb, var(--dd-<tone>) N%, var(--dd-bg-card))`
// rather than the transparent-mix `-muted` tokens above, but the two are mathematically the same
// operation: alpha-compositing the tone color at N% over --dd-bg-card. The toast used to mix at 25%,
// which fails 4.5:1 in 5 of the 6 dark themes; this suite reads the percentage straight out of the
// component source so a regression back toward 25% (or any value that breaks contrast) fails here
// instead of only showing up as a visual nitpick.
const APP_TOAST_SOURCE = readFileSync(join(process.cwd(), 'src/components/AppToast.vue'), 'utf8');
const TOAST_TONE_VARS = ['--dd-danger', '--dd-success', '--dd-warning', '--dd-primary'];

function extractToastMixAlpha(source: string, toneVar: string): number {
  const match = source.match(
    new RegExp(`color-mix\\(in srgb, var\\(${toneVar}\\) (\\d+)%, var\\(--dd-bg-card\\)\\)`),
  );
  if (!match) {
    throw new Error(`AppToast.vue: color-mix for ${toneVar} not found`);
  }
  return Number(match[1]) / 100;
}

describe('AppToast tone surfaces (WCAG 2.2 normal-text target, 4.5:1)', () => {
  it.each(TOAST_TONE_VARS)(
    '%s mixes at 15%% against --dd-bg-card, matching the muted-surface pattern',
    (toneVar) => {
      expect(extractToastMixAlpha(APP_TOAST_SOURCE, toneVar)).toBeCloseTo(0.15);
    },
  );

  describe.each(DARK_THEMES)('$name', ({ selector }) => {
    const block = extractBlock(tokensSource, selector);
    const bgCard = getHex(block, '--dd-bg-card');

    it.each(TOAST_TONE_VARS)(
      'toast text %s on its own toast surface (over --dd-bg-card) clears 4.5:1',
      (toneVar) => {
        const toneHex = getHex(block, toneVar);
        const alpha = extractToastMixAlpha(APP_TOAST_SOURCE, toneVar);
        const mixedBg = compositeOver(toneHex, alpha, bgCard);
        const ratio = contrastRatio(toneHex, mixedBg);
        expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
      },
    );
  });
});

// LoginView's submit button and NotificationsView's save-rule button both paint label text
// directly on a solid --dd-primary fill. --dd-primary is an accent color sized for borders,
// icons, and small badge text on its own 15%-muted surface (see ACCENT_VARS above), not for a
// full-strength fill behind body text, so a hardcoded white fails 4.5:1 in every dark theme and
// in most light themes too once the raised --dd-primary values from the token pass are used.
// The fix is a dedicated on-primary foreground token (--dd-primary-fg) picked per theme; this
// runs across ALL_THEMES (light included) because both buttons render under whichever theme is
// active, not just the dark ones the rest of this file scopes to.
const PRIMARY_CTA_FILES = [
  join(process.cwd(), 'src/views/LoginView.vue'),
  join(process.cwd(), 'src/views/NotificationsView.vue'),
];

describe('primary CTA foreground contrast (WCAG 2.2 normal-text target, 4.5:1)', () => {
  it.each(PRIMARY_CTA_FILES)(
    '%s uses the --dd-primary-fg token instead of a hardcoded color',
    (filePath) => {
      const source = readFileSync(filePath, 'utf8');
      expect(source).toContain('var(--dd-primary-fg)');
    },
  );

  it.each(ALL_THEMES)('$name: --dd-primary-fg on --dd-primary clears 4.5:1', ({ selector }) => {
    const block = extractBlock(tokensSource, selector);
    const primary = getHex(block, '--dd-primary');
    const primaryFg = getHex(block, '--dd-primary-fg');
    const ratio = contrastRatio(primary, primaryFg);
    expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
  });
});

// palettes.ts carries its own copy of each family's accent, used for the theme picker's
// swatches. It is a second source of truth for a value tokens.css already owns, so raising
// --dd-primary for contrast silently leaves the picker previewing a colour the app no longer
// renders. That is exactly what happened during this contrast pass. Until the duplication is
// removed, this pins the two together so the next change to either one fails here instead.
const palettesSource = readFileSync(join(process.cwd(), 'src/theme/palettes.ts'), 'utf8');

function getPaletteAccent(source: string, familyId: string): string {
  const entry = new RegExp(`id: '${familyId}',[\\s\\S]*?accent: '(#[0-9a-fA-F]{6})'`).exec(source);
  if (!entry) {
    throw new Error(`No accent found for theme family '${familyId}' in palettes.ts`);
  }
  return entry[1].toLowerCase();
}

describe('theme picker accents match the dark --dd-primary they preview', () => {
  it.each(DARK_THEMES)('$name', ({ name, selector }) => {
    const accent = getPaletteAccent(palettesSource, name);
    const primary = getHex(extractBlock(tokensSource, selector), '--dd-primary').toLowerCase();
    expect(accent).toBe(primary);
  });
});
