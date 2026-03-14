import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import ContainerSideTabContent from '@/components/containers/ContainerSideTabContent.vue';

const mockRevealContainerEnv = vi.fn();
const mockSetMaturityPolicySelected = vi.fn();
const mockClearMaturityPolicySelected = vi.fn();

vi.mock('@/services/container', () => ({
  revealContainerEnv: (...args: unknown[]) => mockRevealContainerEnv(...args),
}));

const selectedContainer = ref({
  id: 'container-1',
  name: 'nginx',
  image: 'nginx',
  currentTag: 'latest',
  status: 'running',
  server: 'local',
  newTag: undefined,
  details: {
    ports: [],
    volumes: [],
    env: [
      { key: 'PATH', value: '/usr/local/bin:/usr/bin', sensitive: false },
      { key: 'DB_PASSWORD', value: '[REDACTED]', sensitive: true },
      { key: 'NODE_ENV', value: 'production', sensitive: false },
    ],
    labels: [],
  },
});
const activeDetailTab = ref('environment');
const selectedComposePaths = ref<string[]>([]);
const detailPreview = ref<Record<string, unknown> | null>(null);
const detailComposePreview = ref<{
  files: string[];
  service?: string;
  writableFile?: string;
  willWrite?: boolean;
  patch?: string;
} | null>(null);

vi.mock('@/components/containers/containersViewTemplateContext', () => ({
  useContainersViewTemplateContext: () => ({
    selectedContainer,
    activeDetailTab,
    selectedRuntimeOrigins: ref({ entrypoint: 'unknown', cmd: 'unknown' }),
    runtimeOriginStyle: () => ({}),
    runtimeOriginLabel: () => '',
    selectedRuntimeDriftWarnings: ref([]),
    selectedComposePaths,
    selectedLifecycleHooks: ref({
      preUpdate: undefined,
      postUpdate: undefined,
      timeoutLabel: '60000ms (default)',
      preAbortBehavior: undefined,
    }),
    lifecycleHookTemplateVariables: ref([]),
    selectedAutoRollbackConfig: ref({
      enabledLabel: 'Disabled (default)',
      windowLabel: '300000ms',
      intervalLabel: '10000ms',
    }),
    selectedImageMetadata: ref({
      architecture: undefined,
      os: undefined,
      digest: undefined,
      created: undefined,
    }),
    formatTimestamp: (v: string) => v,
    detailVulnerabilityLoading: ref(false),
    detailSbomLoading: ref(false),
    loadDetailSecurityData: vi.fn(),
    detailVulnerabilityError: ref(null),
    vulnerabilitySummary: ref({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0,
    }),
    vulnerabilityTotal: ref(0),
    vulnerabilityPreview: ref([]),
    severityStyle: () => ({}),
    normalizeSeverity: (s: string) => s,
    getVulnerabilityPackage: () => '',
    selectedSbomFormat: ref('json'),
    loadDetailSbom: vi.fn(),
    detailSbomError: ref(null),
    sbomDocument: ref(null),
    sbomComponentCount: ref(0),
    sbomGeneratedAt: ref(null),
    LOG_AUTO_FETCH_INTERVALS: [5, 15, 30],
    containerAutoFetchInterval: ref(15),
    getContainerLogs: vi.fn(),
    containerLogRef: ref(null),
    containerHandleLogScroll: vi.fn(),
    containerScrollBlocked: ref(false),
    containerResumeAutoScroll: vi.fn(),
    previewLoading: ref(false),
    runContainerPreview: vi.fn(),
    actionInProgress: ref(null),
    policyInProgress: ref(null),
    skipCurrentForSelected: vi.fn(),
    snoozeSelected: vi.fn(),
    snoozeDateInput: ref(''),
    snoozeSelectedUntilDate: vi.fn(),
    selectedSnoozeUntil: ref(null),
    unsnoozeSelected: vi.fn(),
    selectedSkipTags: ref([]),
    selectedSkipDigests: ref([]),
    clearSkipsSelected: vi.fn(),
    selectedUpdatePolicy: ref({}),
    selectedHasMaturityPolicy: ref(true),
    selectedMaturityMode: ref('mature'),
    selectedMaturityMinAgeDays: ref(7),
    maturityModeInput: ref('all'),
    maturityMinAgeDaysInput: ref(7),
    setMaturityPolicySelected: mockSetMaturityPolicySelected,
    clearMaturityPolicySelected: mockClearMaturityPolicySelected,
    clearPolicySelected: vi.fn(),
    policyMessage: ref(null),
    policyError: ref(null),
    removeSkipTagSelected: vi.fn(),
    removeSkipDigestSelected: vi.fn(),
    detailPreview,
    detailComposePreview,
    previewError: ref(null),
    triggersLoading: ref(false),
    detailTriggers: ref([]),
    getTriggerKey: () => '',
    triggerRunInProgress: ref({}),
    runAssociatedTrigger: vi.fn(),
    triggerMessage: ref(null),
    triggerError: ref(null),
    backupsLoading: ref(false),
    detailBackups: ref([]),
    rollbackInProgress: ref(false),
    confirmRollback: vi.fn(),
    rollbackToBackup: vi.fn(),
    rollbackMessage: ref(null),
    rollbackError: ref(null),
    updateOperationsLoading: ref(false),
    detailUpdateOperations: ref([]),
    getOperationStatusStyle: () => ({}),
    formatOperationStatus: () => '',
    formatOperationPhase: () => '',
    formatRollbackReason: () => '',
    updateOperationsError: ref(null),
    scanContainer: vi.fn(),
    confirmUpdate: vi.fn(),
    registryColorBg: () => 'var(--dd-bg-inset)',
    registryColorText: () => 'var(--dd-text)',
    registryLabel: () => 'Docker Hub',
  }),
}));

function mountComponent() {
  return mount(ContainerSideTabContent, {
    global: {
      stubs: {
        AppIcon: { template: '<span class="app-icon-stub" />', props: ['name', 'size'] },
      },
      directives: {
        tooltip: {},
      },
    },
  });
}

describe('ContainerSideTabContent - Environment Variables', () => {
  afterEach(() => {
    activeDetailTab.value = 'environment';
    selectedComposePaths.value = [];
    detailPreview.value = null;
    detailComposePreview.value = null;
    selectedContainer.value = {
      id: 'container-1',
      name: 'nginx',
      image: 'nginx',
      currentTag: 'latest',
      status: 'running',
      server: 'local',
      newTag: undefined,
      details: {
        ports: [],
        volumes: [],
        env: [
          { key: 'PATH', value: '/usr/local/bin:/usr/bin', sensitive: false },
          { key: 'DB_PASSWORD', value: '[REDACTED]', sensitive: true },
          { key: 'NODE_ENV', value: 'production', sensitive: false },
        ],
        labels: [],
      },
    };
    mockRevealContainerEnv.mockReset();
    mockSetMaturityPolicySelected.mockReset();
    mockClearMaturityPolicySelected.mockReset();
  });

  it('displays non-sensitive env var values directly', () => {
    const wrapper = mountComponent();
    const envRows = wrapper.findAll('[data-test="container-side-tab-content"] .font-mono');
    const pathRow = envRows.find((row) => row.text().includes('PATH'));
    expect(pathRow).toBeDefined();
    expect(pathRow?.text()).toContain('/usr/local/bin:/usr/bin');
  });

  it('masks sensitive env var values with dots', () => {
    const wrapper = mountComponent();
    const envRows = wrapper.findAll('[data-test="container-side-tab-content"] .font-mono');
    const passwordRow = envRows.find((row) => row.text().includes('DB_PASSWORD'));
    expect(passwordRow).toBeDefined();
    expect(passwordRow?.text()).not.toContain('super-secret');
    expect(passwordRow?.text()).toContain('\u2022\u2022\u2022\u2022\u2022');
  });

  it('reveals sensitive value on eye button click via async fetch', async () => {
    mockRevealContainerEnv.mockResolvedValueOnce({
      env: [
        { key: 'PATH', value: '/usr/local/bin:/usr/bin', sensitive: false },
        { key: 'DB_PASSWORD', value: 'super-secret', sensitive: true },
        { key: 'NODE_ENV', value: 'production', sensitive: false },
      ],
    });

    const wrapper = mountComponent();
    const envRows = wrapper.findAll('[data-test="container-side-tab-content"] .font-mono');
    const passwordRow = envRows.find((row) => row.text().includes('DB_PASSWORD'));
    expect(passwordRow).toBeDefined();

    const eyeButton = passwordRow?.find('button');
    expect(eyeButton).toBeDefined();

    await eyeButton?.trigger('click');
    await flushPromises();
    await nextTick();

    const updatedRows = wrapper.findAll('[data-test="container-side-tab-content"] .font-mono');
    const updatedPasswordRow = updatedRows.find((row) => row.text().includes('DB_PASSWORD'));
    expect(updatedPasswordRow?.text()).toContain('super-secret');
    expect(mockRevealContainerEnv).toHaveBeenCalledWith('container-1');
  });

  it('re-masks sensitive value on second eye button click', async () => {
    mockRevealContainerEnv.mockResolvedValueOnce({
      env: [{ key: 'DB_PASSWORD', value: 'super-secret', sensitive: true }],
    });

    const wrapper = mountComponent();
    const envRows = wrapper.findAll('[data-test="container-side-tab-content"] .font-mono');
    const passwordRow = envRows.find((row) => row.text().includes('DB_PASSWORD'));

    const eyeButton = passwordRow?.find('button');

    // Reveal
    await eyeButton?.trigger('click');
    await flushPromises();
    await nextTick();

    // Re-mask
    await eyeButton?.trigger('click');
    await nextTick();

    const updatedRows = wrapper.findAll('[data-test="container-side-tab-content"] .font-mono');
    const updatedPasswordRow = updatedRows.find((row) => row.text().includes('DB_PASSWORD'));
    expect(updatedPasswordRow?.text()).not.toContain('super-secret');
    expect(updatedPasswordRow?.text()).toContain('\u2022\u2022\u2022\u2022\u2022');
  });

  it('shows detected compose paths in overview for multi-file stacks', async () => {
    activeDetailTab.value = 'overview';
    selectedComposePaths.value = ['/opt/stack/compose.yml', '/opt/stack/compose.override.yml'];

    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Compose Files');
    expect(wrapper.text()).toContain('/opt/stack/compose.yml');
    expect(wrapper.text()).toContain('/opt/stack/compose.override.yml');
  });

  it('renders compose preview rows without dropping generic preview rows', async () => {
    activeDetailTab.value = 'actions';
    detailPreview.value = {
      currentImage: 'nginx:1.0',
      newImage: 'nginx:1.1',
      updateKind: 'tag',
      isRunning: true,
      networks: ['bridge'],
    };
    detailComposePreview.value = {
      files: ['/opt/stack/compose.yml'],
      service: 'web',
      willWrite: false,
      patch: '@@ -1,3 +1,3 @@',
    };

    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Current:');
    expect(wrapper.text()).toContain('New:');
    expect(wrapper.text()).toContain('Compose file:');
    expect(wrapper.text()).toContain('/opt/stack/compose.yml');
    expect(wrapper.text()).toContain('Compose service:');
    expect(wrapper.text()).toContain('web');
    expect(wrapper.text()).toContain('Writes compose file:');
    expect(wrapper.text()).toContain('no');
    expect(wrapper.text()).toContain('Patch preview:');
    expect(wrapper.text()).toContain('@@ -1,3 +1,3 @@');
  });

  it('wires maturity policy action controls in actions tab', async () => {
    activeDetailTab.value = 'actions';

    const wrapper = mountComponent();
    expect(wrapper.text()).toContain('Maturity');
    expect(wrapper.text()).toContain('Apply Maturity');

    const controls = wrapper.findAll('button');
    const applyButton = controls.find((button) => button.text().includes('Apply Maturity'));
    const clearButton = controls.find((button) => button.text().includes('Clear Maturity'));
    expect(applyButton).toBeDefined();
    expect(clearButton).toBeDefined();

    await applyButton?.trigger('click');
    expect(mockSetMaturityPolicySelected).toHaveBeenCalledWith('all');

    await clearButton?.trigger('click');
    expect(mockClearMaturityPolicySelected).toHaveBeenCalledTimes(1);
  });
});
