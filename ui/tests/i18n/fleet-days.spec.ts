import { i18n } from '@/boot/i18n';

describe('fleet snooze duration labels', () => {
  it.each([
    ['nl', 1, '1 dag'],
    ['nl', 7, '7 dagen'],
    ['nl', 30, '30 dagen'],
    ['pl', 1, '1 dzień'],
    ['pl', 7, '7 dni'],
    ['pl', 30, '30 dni'],
  ] as const)('renders %s duration %i', (locale, count, expected) => {
    expect(i18n.global.t('containerComponents.fleetBulk.days', { count }, { locale })).toBe(
      expected,
    );
  });
});
