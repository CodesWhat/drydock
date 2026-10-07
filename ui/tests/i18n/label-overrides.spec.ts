import { SUPPORTED_LOCALES } from '@/i18n/locales';
import english from '@/locales/en/labelOverrides.json';

const locales = import.meta.glob('../../src/locales/*/labelOverrides.json', {
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
it.each(SUPPORTED_LOCALES)('provides label override messages for %s', (locale) => {
  const value = locales[`../../src/locales/${locale}/labelOverrides.json`];
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

it.each(SUPPORTED_LOCALES)('keeps the plural forms of %s countable strings', (locale) => {
  const value = locales[`../../src/locales/${locale}/labelOverrides.json`] as {
    labelOverrides: { scope: Record<string, string>; status: Record<string, string> };
  };
  const counted = [
    value.labelOverrides.scope.composeService,
    value.labelOverrides.scope.composeServiceAgent,
    value.labelOverrides.status.resetAll,
  ];
  for (const text of counted) {
    expect(text.split(' | ')).toHaveLength(2);
    expect(text).toContain('{count}');
  }
});
