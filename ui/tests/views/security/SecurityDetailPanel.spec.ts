import { mount } from '@vue/test-utils';
import { defineComponent } from 'vue';
import SecurityDetailPanel from '@/views/security/SecurityDetailPanel.vue';
import type { SbomState, Vulnerability } from '@/views/security/securityViewTypes';
import type { VulnExportFormat } from '@/views/security/securityViewUtils';

const detailPanelStub = defineComponent({
  props: ['open', 'isMobile', 'showSizeControls', 'showFullPage'],
  emits: ['update:open'],
  template: `
    <section v-if="open" data-test="security-detail-panel">
      <header data-test="security-detail-header"><slot name="header" /></header>
      <div data-test="security-detail-subtitle"><slot name="subtitle" /></div>
      <main data-test="security-detail-body"><slot /></main>
    </section>
  `,
});

const selectedImage = {
  image: 'ghcr.io/acme/web:1.0.0',
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
  unknown: 0,
  total: 10,
  fixable: 6,
  hasUpdate: true,
};

const vulnerabilities: Array<Vulnerability & { safePrimaryUrl: string | null }> = [
  {
    id: 'CVE-2026-1111',
    severity: 'CRITICAL',
    package: 'openssl',
    version: '3.0.0',
    fixedIn: '3.0.10',
    title: 'OpenSSL buffer overflow',
    target: 'usr/lib/libcrypto.so',
    primaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-1111',
    safePrimaryUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-1111',
    image: selectedImage.image,
    publishedDate: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 'CVE-2026-2222',
    severity: 'LOW',
    package: 'zlib',
    version: '1.2.13',
    fixedIn: null,
    title: 'zlib issue',
    target: 'usr/lib/libz.so',
    primaryUrl: 'javascript:alert(1)',
    safePrimaryUrl: null,
    image: selectedImage.image,
    publishedDate: '2026-02-02T00:00:00.000Z',
  },
];

const sbomState: SbomState = {
  componentCount: 42,
  document: { bomFormat: 'CycloneDX', components: [{ name: 'openssl' }] },
  documentJson: '{\n  "bomFormat": "CycloneDX"\n}',
  error: null,
  generatedAt: '2026-04-05T06:07:08.000Z',
  loading: false,
  selectedFormat: 'cyclonedx-json',
  showDocument: true,
};

function factory(overrides: Partial<InstanceType<typeof SecurityDetailPanel>['$props']> = {}) {
  const props = {
    open: true,
    isMobile: false,
    selectedImage,
    selectedImageUpdateBlocked: false,
    updatesAllowed: true,
    selectedImageVulns: vulnerabilities,
    selectedImageVulnsWithSafeUrl: vulnerabilities,
    sbomState,
    selectedVulnExportFormat: 'json' as VulnExportFormat,
    ...overrides,
  };

  return mount(SecurityDetailPanel, {
    props,
    global: {
      stubs: {
        AppIcon: defineComponent({
          props: ['name', 'size'],
          template: '<span class="app-icon-stub" :data-icon="name" />',
        }),
        DetailPanel: detailPanelStub,
        ProjectLink: defineComponent({
          props: ['sourceRepo', 'iconOnly', 'iconSize'],
          template: '<span v-if="sourceRepo" class="project-link-stub" />',
        }),
        ReleaseNotesLink: defineComponent({ template: '<span data-test="release-notes-stub" />' }),
      },
    },
  });
}

describe('SecurityDetailPanel', () => {
  it('renders SBOM metadata and expanded document JSON', () => {
    const wrapper = factory();

    expect(wrapper.text()).toContain('cyclonedx-json');
    expect(wrapper.text()).toContain('42');
    expect(wrapper.text()).toContain('2026-04-05T06:07:08.000Z');
    expect(wrapper.find('pre').text()).toContain('"bomFormat": "CycloneDX"');
  });

  it('renders CVE rows with fix state, target, and only safe reference links', () => {
    const wrapper = factory();

    expect(wrapper.text()).toContain('CVE-2026-1111');
    expect(wrapper.text()).toContain('CRITICAL');
    expect(wrapper.text()).toContain('openssl');
    expect(wrapper.text()).toContain('3.0.0');
    expect(wrapper.text()).toContain('3.0.10');
    expect(wrapper.text()).toContain('OpenSSL buffer overflow');
    expect(wrapper.text()).toContain('usr/lib/libcrypto.so');

    const safeLink = wrapper.find('a[href="https://nvd.nist.gov/vuln/detail/CVE-2026-1111"]');
    expect(safeLink.exists()).toBe(true);
    expect(safeLink.attributes('target')).toBe('_blank');
    expect(safeLink.attributes('rel')).toBe('noopener noreferrer');

    expect(wrapper.text()).toContain('CVE-2026-2222');
    expect(wrapper.text()).toContain('zlib');
    expect(wrapper.text()).toContain('No fix');
    expect(wrapper.find('a[href="javascript:alert(1)"]').exists()).toBe(false);
  });

  it('emits SBOM and vulnerability export actions from the detail controls', async () => {
    const wrapper = factory();
    const buttons = wrapper.findAll('button');

    await buttons.find((button) => button.text().trim() === 'Download Report')?.trigger('click');
    await buttons.find((button) => button.text().trim() === 'Download')?.trigger('click');

    expect(wrapper.emitted('downloadVulnReport')).toHaveLength(1);
    expect(wrapper.emitted('downloadDetailSbom')).toHaveLength(1);
  });

  it('renders update button and containers link when selectedImage has hasUpdate', () => {
    const wrapper = factory();
    expect(wrapper.find('[data-test="security-detail-update-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="security-detail-containers-link"]').exists()).toBe(true);
  });

  it('does not render update button when selectedImage has no hasUpdate', () => {
    const wrapper = factory({
      selectedImage: { ...selectedImage, hasUpdate: false },
    });
    expect(wrapper.find('[data-test="security-detail-update-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="security-detail-containers-link"]').exists()).toBe(false);
  });

  it('renders ReleaseNotesLink for a no-update image with currentReleaseNotes', () => {
    const wrapper = factory({
      selectedImage: {
        ...selectedImage,
        hasUpdate: false,
        currentReleaseNotes: {
          title: 'v1.25.0',
          body: 'Running tag notes',
          url: 'https://github.com/acme/web/releases/tag/v1.25.0',
          publishedAt: '2025-12-01T00:00:00Z',
          provider: 'github',
        },
      },
    });
    expect(wrapper.find('[data-test="security-detail-release-notes"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="security-detail-update-btn"]').exists()).toBe(false);
  });

  it('renders ProjectLink stub for a no-update image with sourceRepo', () => {
    const wrapper = factory({
      selectedImage: {
        ...selectedImage,
        hasUpdate: false,
        sourceRepo: 'github.com/acme/web',
      },
    });
    expect(wrapper.find('.project-link-stub').exists()).toBe(true);
    expect(wrapper.find('[data-test="security-detail-update-btn"]').exists()).toBe(false);
  });

  it('renders both ReleaseNotesLink and ProjectLink alongside update buttons when hasUpdate is true', () => {
    const wrapper = factory({
      selectedImage: {
        ...selectedImage,
        hasUpdate: true,
        currentReleaseNotes: {
          title: 'v1.25.0',
          body: 'Current notes',
          url: 'https://github.com/acme/web/releases/tag/v1.25.0',
          publishedAt: '2025-12-01T00:00:00Z',
          provider: 'github',
        },
        sourceRepo: 'github.com/acme/web',
      },
    });
    expect(wrapper.find('[data-test="security-detail-update-btn"]').exists()).toBe(true);
    expect(wrapper.find('[data-test="security-detail-release-notes"]').exists()).toBe(true);
    expect(wrapper.find('.project-link-stub').exists()).toBe(true);
  });

  it('does not render the action row when selectedImage has none of the relevant fields', () => {
    const wrapper = factory({
      selectedImage: {
        ...selectedImage,
        hasUpdate: false,
        sourceRepo: undefined,
        releaseNotes: undefined,
        currentReleaseNotes: undefined,
        releaseLink: undefined,
      },
    });
    expect(wrapper.find('[data-test="security-detail-update-btn"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="release-notes-stub"]').exists()).toBe(false);
    expect(wrapper.find('.project-link-stub').exists()).toBe(false);
  });
});
