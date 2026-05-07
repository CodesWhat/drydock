import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = join(process.cwd(), 'src');
const RAW_TEXT_SIZE_CLASS =
  /\btext-(?:5xs|4xs|3xs|2xs|2xs-plus|xs|xs-plus|sm|sm-plus|base|lg|xl)\b/g;

function rawTextSizeClasses(source: string): string[] {
  return [...new Set(source.match(RAW_TEXT_SIZE_CLASS) ?? [])].sort();
}

function cssTokenValue(source: string, tokenName: string): string {
  const match = new RegExp(`--${tokenName}:\\s*([^;]+);`).exec(source);
  return match?.[1]?.trim() ?? '';
}

describe('typography standard', () => {
  it('defines semantic typography tokens and utilities', () => {
    const styleSource = readFileSync(join(SRC_DIR, 'style.css'), 'utf8');

    expect(styleSource).toContain('--dd-font-card-title:');
    expect(styleSource).toContain('--dd-font-card-description:');
    expect(styleSource).toContain('--dd-font-choice-title:');
    expect(styleSource).toContain('--dd-font-choice-description:');
    expect(styleSource).toContain('.dd-text-card-title {');
    expect(styleSource).toContain('.dd-text-card-description {');
    expect(styleSource).toContain('.dd-text-choice-title {');
    expect(styleSource).toContain('.dd-text-choice-description {');
    expect(styleSource).toContain('.dd-text-button {');
    expect(styleSource).toContain('.dd-text-indicator {');
    expect(styleSource).not.toMatch(/@utility dd-text-/);
  });

  it('keeps appearance choices on a clear heading, title, and description type hierarchy', () => {
    const styleSource = readFileSync(join(SRC_DIR, 'style.css'), 'utf8');

    expect(cssTokenValue(styleSource, 'dd-font-heading-section')).toBe('var(--text-lg)');
    expect(cssTokenValue(styleSource, 'dd-font-choice-title')).toBe('var(--text-sm)');
    expect(cssTokenValue(styleSource, 'dd-font-choice-description')).toBe('var(--text-2xs)');
  });

  it('keeps shared components on semantic typography classes', () => {
    const targetFiles = [
      join(SRC_DIR, 'components/AppButton.vue'),
      join(SRC_DIR, 'components/AppBadge.vue'),
      join(SRC_DIR, 'components/AppStatusIndicator.vue'),
      join(SRC_DIR, 'components/AppTabBar.vue'),
    ];
    const offenders: Record<string, string[]> = {};

    for (const filePath of targetFiles) {
      const source = readFileSync(filePath, 'utf8');
      const rawClasses = rawTextSizeClasses(source);
      if (rawClasses.length > 0) {
        offenders[relative(process.cwd(), filePath).replaceAll('\\', '/')] = rawClasses;
      }
    }

    expect(offenders).toEqual({});
  });

  it('keeps config tabs on semantic typography classes', () => {
    const targetFiles = [
      join(SRC_DIR, 'components/config/ConfigAppearanceTab.vue'),
      join(SRC_DIR, 'components/config/ConfigGeneralTab.vue'),
      join(SRC_DIR, 'components/config/ConfigLogsTab.vue'),
      join(SRC_DIR, 'components/config/ConfigProfileTab.vue'),
    ];
    const offenders: Record<string, string[]> = {};

    for (const filePath of targetFiles) {
      const source = readFileSync(filePath, 'utf8');
      const rawClasses = rawTextSizeClasses(source);
      if (rawClasses.length > 0) {
        offenders[relative(process.cwd(), filePath).replaceAll('\\', '/')] = rawClasses;
      }
    }

    expect(readFileSync(targetFiles[0], 'utf8')).toContain('dd-text-choice-title');
    expect(readFileSync(targetFiles[0], 'utf8')).toContain('dd-text-choice-description');
    expect(readFileSync(targetFiles[1], 'utf8')).toContain('dd-text-card-title');
    expect(readFileSync(targetFiles[1], 'utf8')).toContain('dd-text-card-description');
    expect(offenders).toEqual({});
  });

  it('keeps appearance choice controls on compact choice typography without default pills', () => {
    const source = readFileSync(join(SRC_DIR, 'components/config/ConfigAppearanceTab.vue'), 'utf8');

    expect(source).toContain('dd-text-choice-title');
    expect(source).toContain('dd-text-choice-description');
    expect(source).not.toContain('fontFamily.defaultBadge');
    expect(source).not.toContain('font.bundled');
  });
});
