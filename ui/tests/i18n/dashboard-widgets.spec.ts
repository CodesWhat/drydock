import { i18n, SUPPORTED_LOCALES } from '@/boot/i18n';
import { DASHBOARD_WIDGET_META } from '@/views/dashboard/dashboardTypes';

const titleKeys = [
  'dashboardView.stats.containers',
  'dashboardView.stats.updatesAvailable',
  'dashboardView.stats.securityIssues',
  'dashboardView.stats.registries',
  'dashboardView.stats.approvals',
  'dashboardView.recentUpdates.title',
  'dashboardView.securityOverview.title',
  'dashboardView.resourceUsage.title',
  'dashboardView.hostStatus.title',
  'dashboardView.updateBreakdown.title',
];

describe('dashboard widget picker translations', () => {
  const originalLocale = i18n.global.locale.value;

  afterEach(() => {
    i18n.global.locale.value = originalLocale;
  });

  it.each(SUPPORTED_LOCALES)('matches the visible widget titles in %s', (locale) => {
    i18n.global.locale.value = locale;
    const titles = titleKeys.map((key) => {
      const translated = i18n.global.t(key);
      expect(translated).not.toBe(key);
      expect(translated.trim()).not.toBe('');
      return translated;
    });
    expect(DASHBOARD_WIDGET_META.map((widget) => i18n.global.t(widget.labelKey))).toEqual(titles);
  });
});
