import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, nextTick, type Ref, ref } from 'vue';
import { useContainerSecurity } from '@/views/containers/useContainerSecurity';

const mocks = vi.hoisted(() => ({
  getContainerSbom: vi.fn(),
  getContainerVulnerabilities: vi.fn(),
}));

vi.mock('@/services/container', () => ({
  getContainerSbom: mocks.getContainerSbom,
  getContainerVulnerabilities: mocks.getContainerVulnerabilities,
}));

const mountedWrappers: VueWrapper[] = [];

interface SecurityHarnessState {
  selectedContainerId: Ref<string | undefined>;
  selectedContainerMeta: Ref<Record<string, unknown> | undefined>;
  composable: ReturnType<typeof useContainerSecurity>;
}

async function mountSecurityHarness(
  options: { selectedContainerId?: string; selectedContainerMeta?: Record<string, unknown> } = {},
) {
  let state: SecurityHarnessState | undefined;

  const Harness = defineComponent({
    setup() {
      const selectedContainerId = ref(options.selectedContainerId);
      const selectedContainerMeta = ref(options.selectedContainerMeta);
      const composable = useContainerSecurity({
        selectedContainerId,
        selectedContainerMeta,
      });
      state = {
        selectedContainerId,
        selectedContainerMeta,
        composable,
      };
      return () => h('div');
    },
  });

  const wrapper = mount(Harness);
  mountedWrappers.push(wrapper);
  await flushPromises();

  if (!state) {
    throw new Error('Security harness did not initialize');
  }

  return state;
}

describe('useContainerSecurity', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getContainerVulnerabilities.mockResolvedValue({
      summary: { critical: 1, high: 2, medium: 3, low: 4, unknown: 5 },
      vulnerabilities: [
        { id: 'v1', severity: 'HIGH', packageName: 'openssl' },
        { id: 'v2', severity: 'LOW', package: 'curl' },
        { id: 'v3', severity: 'MEDIUM' },
        { id: 'v4', severity: 'CRITICAL' },
        { id: 'v5', severity: 'UNKNOWN' },
        { id: 'v6', severity: 'LOW' },
      ],
    });
    mocks.getContainerSbom.mockResolvedValue({
      generatedAt: '2026-03-05T10:00:00.000Z',
      document: { components: [{}, {}, {}] },
    });
  });

  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
  });

  it('parses runtime origins and reports drift warning for unknown metadata', async () => {
    const { composable } = await mountSecurityHarness({
      selectedContainerMeta: {
        labels: {
          'dd.runtime.entrypoint.origin': 'Explicit',
        },
      },
    });

    expect(composable.selectedRuntimeOrigins.value).toEqual({
      entrypoint: 'explicit',
      cmd: 'unknown',
    });
    expect(composable.selectedRuntimeDriftWarnings.value).toHaveLength(1);
    expect(composable.selectedRuntimeDriftWarnings.value[0]).toContain('Cmd');
    expect(composable.runtimeOriginLabel('explicit')).toBe('Explicit');
    expect(composable.runtimeOriginStyle('unknown')).toEqual({
      backgroundColor: 'var(--dd-warning-muted)',
      color: 'var(--dd-warning)',
    });
  });

  it('parses lifecycle hook and rollback labels with DD keys preferred over WUD keys', async () => {
    const { composable } = await mountSecurityHarness({
      selectedContainerMeta: {
        labels: {
          'dd.hook.pre': 'echo pre',
          'wud.hook.pre': 'ignored-pre',
          'wud.hook.post': 'echo post',
          'dd.hook.timeout': '1500',
          'dd.hook.pre.abort': 'true',
          'dd.rollback.auto': 'false',
          'wud.rollback.window': '2500',
          'wud.rollback.interval': '500',
        },
      },
    });

    expect(composable.selectedLifecycleHooks.value).toEqual({
      preUpdate: 'echo pre',
      postUpdate: 'echo post',
      timeoutLabel: '1500ms',
      preAbortBehavior: 'Abort update on pre-hook failure',
    });
    expect(composable.selectedAutoRollbackConfig.value).toEqual({
      enabledLabel: 'Disabled',
      windowLabel: '2500ms',
      intervalLabel: '500ms',
    });
  });

  it('falls back from blank DD hook labels to WUD labels and supports pre-abort=false', async () => {
    const { composable } = await mountSecurityHarness({
      selectedContainerMeta: {
        labels: {
          'dd.hook.pre': '   ',
          'wud.hook.pre': 'echo fallback-pre',
          'dd.hook.post': '',
          'wud.hook.post': 'echo fallback-post',
          'dd.hook.pre.abort': 'false',
        },
      },
    });

    expect(composable.selectedLifecycleHooks.value).toEqual({
      preUpdate: 'echo fallback-pre',
      postUpdate: 'echo fallback-post',
      timeoutLabel: '60000ms (default)',
      preAbortBehavior: 'Continue update on pre-hook failure',
    });
  });

  it('treats blank WUD hook labels as unset values', async () => {
    const { composable } = await mountSecurityHarness({
      selectedContainerMeta: {
        labels: {
          'wud.hook.pre': '   ',
          'wud.hook.post': '',
        },
      },
    });

    expect(composable.selectedLifecycleHooks.value.preUpdate).toBeUndefined();
    expect(composable.selectedLifecycleHooks.value.postUpdate).toBeUndefined();
  });

  it('falls back to default lifecycle/rollback labels when metadata is missing or invalid', async () => {
    const { composable } = await mountSecurityHarness({
      selectedContainerMeta: {
        labels: {
          'dd.hook.timeout': 'invalid',
          'dd.hook.pre.abort': 'nope',
          'dd.rollback.auto': 'maybe',
          'dd.rollback.window': '-1',
          'dd.rollback.interval': '0',
        },
      },
    });

    expect(composable.selectedLifecycleHooks.value).toEqual({
      preUpdate: undefined,
      postUpdate: undefined,
      timeoutLabel: '60000ms (default)',
      preAbortBehavior: undefined,
    });
    expect(composable.selectedAutoRollbackConfig.value).toEqual({
      enabledLabel: 'Disabled (default)',
      windowLabel: '300000ms',
      intervalLabel: '10000ms',
    });
  });

  it('loads vulnerability and sbom data and computes summary projections', async () => {
    const { composable } = await mountSecurityHarness({
      selectedContainerId: 'container-1',
    });

    expect(mocks.getContainerVulnerabilities).toHaveBeenCalledWith('container-1');
    expect(mocks.getContainerSbom).toHaveBeenCalledWith('container-1', 'spdx-json');
    expect(composable.vulnerabilitySummary.value).toEqual({
      critical: 1,
      high: 2,
      medium: 3,
      low: 4,
      unknown: 5,
    });
    expect(composable.vulnerabilityTotal.value).toBe(15);
    expect(composable.vulnerabilityPreview.value).toHaveLength(5);
    expect(composable.sbomComponentCount.value).toBe(3);
    expect(composable.sbomGeneratedAt.value).toBe('2026-03-05T10:00:00.000Z');
    expect(composable.getVulnerabilityPackage({})).toBe('unknown');
  });

  it('derives SBOM component count from packages when components are absent', async () => {
    mocks.getContainerSbom.mockResolvedValueOnce({
      generatedAt: '2026-03-05T10:00:00.000Z',
      document: { packages: [{}, {}] },
    });

    const { composable } = await mountSecurityHarness({
      selectedContainerId: 'container-1',
    });

    expect(composable.sbomComponentCount.value).toBe(2);
  });

  it('maps severity levels to expected style tokens', async () => {
    const { composable } = await mountSecurityHarness();

    expect(composable.severityStyle('CRITICAL')).toEqual({
      bg: 'var(--dd-danger-muted)',
      text: 'var(--dd-danger)',
    });
    expect(composable.severityStyle('HIGH')).toEqual({
      bg: 'var(--dd-warning-muted)',
      text: 'var(--dd-warning)',
    });
    expect(composable.severityStyle('MEDIUM')).toEqual({
      bg: 'var(--dd-caution-muted)',
      text: 'var(--dd-caution)',
    });
    expect(composable.severityStyle('LOW')).toEqual({
      bg: 'var(--dd-info-muted)',
      text: 'var(--dd-info)',
    });
  });

  it('reloads SBOM when format changes for the selected container', async () => {
    const { composable } = await mountSecurityHarness({
      selectedContainerId: 'container-1',
    });
    mocks.getContainerSbom.mockClear();

    composable.selectedSbomFormat.value = 'cyclonedx-json';
    await nextTick();
    await flushPromises();

    expect(mocks.getContainerSbom).toHaveBeenCalledWith('container-1', 'cyclonedx-json');
  });

  it('handles vulnerability fetch failures and clears state when selection is removed', async () => {
    mocks.getContainerVulnerabilities.mockRejectedValueOnce(new Error('vulns failed'));

    const { composable, selectedContainerId } = await mountSecurityHarness({
      selectedContainerId: 'container-1',
    });

    expect(composable.detailVulnerabilityError.value).toBe('vulns failed');
    expect(composable.detailVulnerabilityLoading.value).toBe(false);
    expect(composable.detailVulnerabilityError.value).toBe('vulns failed');

    selectedContainerId.value = undefined;
    await nextTick();

    expect(composable.detailVulnerabilityError.value).toBeNull();
    expect(composable.detailSbomError.value).toBeNull();
    expect(composable.vulnerabilityPreview.value).toEqual([]);
    expect(composable.sbomDocument.value).toBeUndefined();
  });

  it('handles SBOM fetch failures and keeps loading state consistent', async () => {
    mocks.getContainerSbom.mockRejectedValueOnce(new Error('sbom failed'));

    const { composable } = await mountSecurityHarness({
      selectedContainerId: 'container-1',
    });

    expect(composable.detailSbomError.value).toBe('sbom failed');
    expect(composable.detailSbomLoading.value).toBe(false);
  });

  it('no-ops detail security loaders when no container is selected', async () => {
    const { composable } = await mountSecurityHarness({
      selectedContainerId: undefined,
    });
    mocks.getContainerVulnerabilities.mockClear();
    mocks.getContainerSbom.mockClear();

    await composable.loadDetailSecurityData();

    expect(composable.detailVulnerabilityError.value).toBeNull();
    expect(composable.detailSbomError.value).toBeNull();
    expect(mocks.getContainerVulnerabilities).not.toHaveBeenCalled();
    expect(mocks.getContainerSbom).not.toHaveBeenCalled();
  });

  it('does not reload SBOM when format changes without a selected container', async () => {
    const { composable } = await mountSecurityHarness({
      selectedContainerId: undefined,
    });
    mocks.getContainerSbom.mockClear();

    composable.selectedSbomFormat.value = 'cyclonedx-json';
    await nextTick();
    await flushPromises();

    expect(mocks.getContainerSbom).not.toHaveBeenCalled();
  });
});
