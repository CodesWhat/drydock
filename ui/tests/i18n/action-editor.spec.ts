import { SUPPORTED_LOCALES } from '@/i18n/locales';
import english from '@/locales/en/actionEditor.json';

const locales = import.meta.glob('../../src/locales/*/actionEditor.json', {
  eager: true,
  import: 'default',
});
function leaves(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(leaves);
  return [];
}
it.each(SUPPORTED_LOCALES)('provides translated action policy copy for %s', (locale) => {
  const value = locales[`../../src/locales/${locale}/actionEditor.json`];
  expect(value).toBeDefined();
  const actual = leaves(value),
    expected = leaves(english);
  expect(actual).toHaveLength(expected.length);
  for (const [index, text] of actual.entries()) {
    expect(text.trim()).not.toBe('');
    if (locale !== 'en') expect(text).not.toBe(expected[index]);
  }
});
