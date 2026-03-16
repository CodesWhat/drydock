import { mount } from '@vue/test-utils';
import SecurityEmptyState from '@/components/SecurityEmptyState.vue';

const stubs = {
  AppIcon: { template: '<span class="app-icon-stub" />', props: ['name', 'size'] },
  ScanProgressText: { template: '<span class="scan-progress-stub" />', props: ['progress'] },
};

function factory(overrides: Record<string, unknown> = {}) {
  return mount(SecurityEmptyState, {
    props: {
      hasVulnerabilityData: false,
      scannerSetupNeeded: false,
      scannerMessage: '',
      activeFilterCount: 0,
      scanning: false,
      runtimeLoading: false,
      scannerReady: true,
      scanDisabledReason: 'Scan all containers for vulnerabilities',
      scanProgress: { done: 0, total: 0 },
      ...overrides,
    },
    global: { stubs },
  });
}

describe('SecurityEmptyState', () => {
  it('renders no-data empty copy when there is no vulnerability data', () => {
    const wrapper = factory();
    expect(wrapper.text()).toContain('No vulnerability data yet');
    expect(wrapper.text()).toContain(
      'Run a scan to check your containers for known vulnerabilities',
    );
  });

  it('renders filter empty copy when vulnerabilities exist but none match filters', () => {
    const wrapper = factory({ hasVulnerabilityData: true });
    expect(wrapper.text()).toContain('No images match your filters');
    expect(wrapper.text()).not.toContain(
      'Run a scan to check your containers for known vulnerabilities',
    );
  });

  it('emits clear-filters when clear button is clicked', async () => {
    const wrapper = factory({ activeFilterCount: 1 });
    await wrapper.get('[data-testid="security-empty-clear-filters"]').trigger('click');
    expect(wrapper.emitted('clear-filters')).toHaveLength(1);
  });

  it('emits scan-now when scan button is clicked', async () => {
    const wrapper = factory();
    await wrapper.get('[data-testid="security-empty-scan-now"]').trigger('click');
    expect(wrapper.emitted('scan-now')).toHaveLength(1);
  });

  it('shows setup guide and scanner message when scanner setup is needed', () => {
    const wrapper = factory({
      scannerSetupNeeded: true,
      scannerMessage: 'Trivy is not installed',
    });
    expect(wrapper.text()).toContain('Trivy is not installed');
    expect(wrapper.get('a').attributes('href')).toBe(
      'https://getdrydock.com/docs/configuration/security',
    );
    expect(wrapper.find('[data-testid="security-empty-scan-now"]').exists()).toBe(false);
  });

  it('applies card/list container styling when boxed is true', () => {
    const wrapper = factory({ boxed: true });
    const root = wrapper.get('[data-testid="security-empty-state"]');
    expect(root.attributes('style')).toContain('background-color');
  });
});
