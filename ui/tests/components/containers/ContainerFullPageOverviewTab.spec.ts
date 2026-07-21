import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import ContainerFullPageOverviewTab from '@/components/containers/ContainerFullPageOverviewTab.vue';

function makeContainer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'container-1',
    name: 'nginx',
    image: 'nginx',
    currentTag: '1.0',
    status: 'running',
    registry: 'hub',
    registryUrl: '',
    registryName: '',
    registryError: '',
    newTag: undefined as string | undefined,
    updateKind: null as string | null,
    updateMaturityTooltip: undefined as string | undefined,
    noUpdateReason: '',
    suggestedTag: undefined as string | undefined,
    sourceRepo: '',
    releaseNotes: undefined,
    currentReleaseNotes: undefined,
    releaseLink: '',
    isDigestPinned: false,
    currentDigest: undefined as string | undefined,
    softwareVersion: undefined as string | undefined,
    includeTags: '',
    excludeTags: '',
    transformTags: '',
    triggerInclude: '',
    triggerExclude: '',
    details: {
      ports: [],
      volumes: [],
      env: [],
      labels: [],
    },
    ...overrides,
  };
}

const selectedContainer = ref(makeContainer());
const selectedRuntimeOrigins = ref({ entrypoint: 'unknown', cmd: 'unknown' });
const selectedRuntimeDriftWarnings = ref<string[]>([]);
const selectedComposePaths = ref<string[]>([]);
const selectedLifecycleHooks = ref({
  preUpdate: '',
  postUpdate: '',
  timeoutLabel: '60000ms',
  preAbortBehavior: '',
});
const lifecycleHookTemplateVariables = ref<{ name: string; description: string }[]>([]);
const selectedAutoRollbackConfig = ref({
  enabledLabel: 'Disabled',
  windowLabel: '300000ms',
  intervalLabel: '10000ms',
});
const detailVulnerabilityLoading = ref(false);
const detailSbomLoading = ref(false);
const detailVulnerabilityError = ref<string | null>(null);
const vulnerabilitySummary = ref({ critical: 0, high: 0, medium: 0, low: 0, unknown: 0 });
const vulnerabilityTotal = ref(0);
const vulnerabilityPreview = ref<{ id: string; severity: string }[]>([]);
const selectedSbomFormat = ref('spdx-json');
const detailSbomError = ref<string | null>(null);
const sbomDocument = ref<Record<string, unknown> | null>(null);
const sbomComponentCount = ref<number | null>(null);
const sbomGeneratedAt = ref<string | null>(null);
const mockLoadDetailSecurityData = vi.fn();
const mockLoadDetailSbom = vi.fn();

vi.mock('@/components/containers/containersViewTemplateContext', () => ({
  useContainersViewTemplateContext: () => ({
    selectedContainer,
    selectedRuntimeOrigins,
    runtimeOriginStyle: () => ({}),
    runtimeOriginLabel: () => 'unknown',
    selectedRuntimeDriftWarnings,
    selectedComposePaths,
    selectedLifecycleHooks,
    lifecycleHookTemplateVariables,
    selectedAutoRollbackConfig,
    formatTimestamp: (value: string) => value,
    detailVulnerabilityLoading,
    detailSbomLoading,
    loadDetailSecurityData: mockLoadDetailSecurityData,
    detailVulnerabilityError,
    vulnerabilitySummary,
    vulnerabilityTotal,
    vulnerabilityPreview,
    severityStyle: () => ({ bg: 'var(--dd-bg-inset)', text: 'var(--dd-text)' }),
    normalizeSeverity: (severity: string) => severity,
    getVulnerabilityPackage: () => 'pkg',
    selectedSbomFormat,
    loadDetailSbom: mockLoadDetailSbom,
    detailSbomError,
    sbomDocument,
    sbomComponentCount,
    sbomGeneratedAt,
    registryColorBg: () => 'var(--dd-bg-inset)',
    registryColorText: () => 'var(--dd-text)',
    registryLabel: () => 'Docker Hub',
    updateKindColor: () => ({ bg: 'var(--dd-bg-inset)', text: 'var(--dd-text)' }),
  }),
}));

function resetState() {
  selectedContainer.value = makeContainer();
  selectedRuntimeOrigins.value = { entrypoint: 'unknown', cmd: 'unknown' };
  selectedRuntimeDriftWarnings.value = [];
  selectedComposePaths.value = [];
  selectedLifecycleHooks.value = {
    preUpdate: '',
    postUpdate: '',
    timeoutLabel: '60000ms',
    preAbortBehavior: '',
  };
  lifecycleHookTemplateVariables.value = [];
  selectedAutoRollbackConfig.value = {
    enabledLabel: 'Disabled',
    windowLabel: '300000ms',
    intervalLabel: '10000ms',
  };
  detailVulnerabilityLoading.value = false;
  detailSbomLoading.value = false;
  detailVulnerabilityError.value = null;
  vulnerabilitySummary.value = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  vulnerabilityTotal.value = 0;
  vulnerabilityPreview.value = [];
  selectedSbomFormat.value = 'spdx-json';
  detailSbomError.value = null;
  sbomDocument.value = null;
  sbomComponentCount.value = null;
  sbomGeneratedAt.value = null;
  mockLoadDetailSecurityData.mockReset();
  mockLoadDetailSbom.mockReset();
}

function mountComponent() {
  return mount(ContainerFullPageOverviewTab, {
    global: {
      stubs: {
        AppIcon: {
          template: '<span class="app-icon-stub" />',
          props: ['name', 'size'],
        },
      },
    },
  });
}

describe('ContainerFullPageOverviewTab', () => {
  afterEach(() => {
    resetState();
  });

  it('renders a localized label on the update-kind badge for a known kind', () => {
    selectedContainer.value = makeContainer({ newTag: '1.1', updateKind: 'minor' });

    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Minor');
    expect(wrapper.text()).not.toContain('minor');
  });

  it('falls back to the neutral Unknown label for an unrecognized updateKind instead of rendering the raw value (#display-honesty)', () => {
    selectedContainer.value = makeContainer({ newTag: '2.0.0', updateKind: 'bogus-kind' });

    const wrapper = mountComponent();
    const text = wrapper.text();

    expect(text).toContain('Unknown');
    expect(text).not.toContain('bogus-kind');
  });

  it('renders the up-to-date state when there is no new tag', () => {
    selectedContainer.value = makeContainer({ newTag: undefined, updateKind: null });

    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Up to date');
  });
});
