import { SUPPORTED_LOCALES } from '@/i18n/locales';
import english from '@/locales/en/watcherEditor.json';

const locales = import.meta.glob('../../src/locales/*/watcherEditor.json', {
  eager: true,
  import: 'default',
});
function leaves(value: Record<string, unknown>, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) =>
      typeof child === 'string'
        ? [[`${prefix}${key}`, child]]
        : Object.entries(leaves(child as Record<string, unknown>, `${prefix}${key}.`)),
    ),
  );
}

it.each(SUPPORTED_LOCALES)('provides watcher editor messages and placeholders for %s', (locale) => {
  const value = locales[`../../src/locales/${locale}/watcherEditor.json`];
  expect(value).toBeDefined();
  const actual = leaves(value as Record<string, unknown>),
    expected = leaves(english);
  expect(Object.keys(actual).sort()).toEqual(Object.keys(expected).sort());
  for (const [key, text] of Object.entries(expected)) {
    expect(actual[key].trim()).not.toBe('');
    expect(actual[key].match(/\{\w+\}/g)?.sort() ?? []).toEqual(
      text.match(/\{\w+\}/g)?.sort() ?? [],
    );
  }
});
