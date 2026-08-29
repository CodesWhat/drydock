import { setI18nLocale } from '@/boot/i18n';
import DashboardSecurityOverviewWidget from '@/views/dashboard/components/DashboardSecurityOverviewWidget.vue';
import { mountWithPlugins } from '../../helpers/mount';

interface VulnerabilityRowOverrides {
  id?: string;
  image?: string;
  package?: string;
  severity?: 'CRITICAL' | 'HIGH';
}

function makeVulnerability(overrides: VulnerabilityRowOverrides = {}) {
  return {
    id: 'CVE-2024-0001',
    image: 'nginx:1.25',
    package: 'openssl',
    severity: 'CRITICAL' as const,
    ...overrides,
  };
}

function mountWidget(overrides: Record<string, unknown> = {}) {
  return mountWithPlugins(DashboardSecurityOverviewWidget, {
    props: {
      donutCircumference: 301.6,
      editMode: false,
      securityCleanArcLength: 200,
      securityCleanCount: 4,
      securityIssueArcLength: 60,
      securityIssueCount: 2,
      securityNotScannedArcLength: 0,
      securityNotScannedCount: 0,
      securitySeverityTotals: { critical: 1, high: 1, medium: 0, low: 0 },
      securityTotalCount: 6,
      showSecuritySeverityBreakdown: true,
      vulnerabilities: [],
      ...overrides,
    },
  });
}

describe('DashboardSecurityOverviewWidget', () => {
  afterEach(() => {
    setI18nLocale('en');
  });

  describe('vulnerability severity labels (defect 3)', () => {
    it('translates severity labels for the active locale instead of rendering the raw English enum', () => {
      setI18nLocale('de');
      // Severity breakdown disabled so its own (already-translated,
      // unrelated) "{count} Kritisch"/"{count} Hoch" text can't make this
      // assertion pass by coincidence -- only the vulnerability row's own
      // label is under test here.
      const wrapper = mountWidget({
        showSecuritySeverityBreakdown: false,
        vulnerabilities: [
          makeVulnerability({ id: 'CVE-1', severity: 'CRITICAL' }),
          makeVulnerability({ id: 'CVE-2', severity: 'HIGH' }),
        ],
      });

      // securityView.badge.critical/high === "Kritisch"/"Hoch" in de — see
      // src/locales/de/listViews.json (same catalog SecurityView.vue's own
      // severityBadgeLabel reuses for this concept).
      expect(wrapper.text()).not.toContain('CRITICAL');
      expect(wrapper.text()).not.toContain('HIGH');
      expect(wrapper.text()).toContain('Kritisch');
      expect(wrapper.text()).toContain('Hoch');
    });

    it('renders the bare English severity label (not the raw enum) in the default locale', () => {
      const wrapper = mountWidget({
        showSecuritySeverityBreakdown: false,
        vulnerabilities: [makeVulnerability({ severity: 'CRITICAL' })],
      });
      expect(wrapper.text()).toContain('Critical');
      expect(wrapper.text()).not.toContain('CRITICAL');
    });
  });

  describe('vulnerabilities list', () => {
    it('shows the empty state when there are no vulnerabilities', () => {
      const wrapper = mountWidget({ vulnerabilities: [] });
      expect(wrapper.text()).toContain('No vulnerabilities reported');
    });

    it('renders the vulnerability package and image alongside the severity label', () => {
      const wrapper = mountWidget({
        showSecuritySeverityBreakdown: false,
        vulnerabilities: [
          makeVulnerability({ id: 'CVE-9999', image: 'redis:7', package: 'libssl' }),
        ],
      });
      expect(wrapper.text()).toContain('CVE-9999');
      expect(wrapper.text()).toContain('libssl');
      expect(wrapper.text()).toContain('redis:7');
    });
  });
});
