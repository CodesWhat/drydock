import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import ContainerSideTabContent from '@/components/containers/ContainerSideTabContent.vue';

const mockRevealContainerEnv = vi.fn();
const mockSetMaturityPolicySelected = vi.fn();
const mockClearMaturityPolicySelected = vi.fn();
const mockRemoveSkipTagSelected = vi.fn();
const mockRemoveSkipDigestSelected = vi.fn();
const mockRunAssociatedTrigger = vi.fn();
const mockConfirmRollback = vi.fn();

vi.mock('@/services/container', () => ({
  revealContainerEnv: (...args: unknown[]) => mockRevealContainerEnv(...args),
}));

function createSelectedContainer() {
  return {
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
}

const selectedContainer = ref(createSelectedContainer());
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
const previewLoading = ref(false);
const previewError = ref<string | null>(null);
const policyInProgress = ref<string | null>(null);
const snoozeDateInput = ref('');
const selectedSnoozeUntil = ref<string | null>(null);
const selectedSkipTags = ref<string[]>([]);
const selectedSkipDigests = ref<string[]>([]);
const selectedUpdatePolicy = ref<Record<string, unknown>>({});
const selectedHasMaturityPolicy = ref(true);
const selectedMaturityMode = ref('mature');
const selectedMaturityMinAgeDays = ref(7);
const maturityModeInput = ref('all');
const maturityMinAgeDaysInput = ref(7);
const policyMessage = ref<string | null>(null);
const policyError = ref<string | null>(null);
const triggersLoading = ref(false);
const detailTriggers = ref<Array<{ type: string; name: string; agent?: string }>>([]);
const triggerRunInProgress = ref<string | null>(null);
const triggerMessage = ref<string | null>(null);
const triggerError = ref<string | null>(null);
const backupsLoading = ref(false);
const detailBackups = ref<
  Array<{ id: string; imageName: string; imageTag: string; timestamp: string }>
>([]);
const rollbackInProgress = ref<string | null>(null);
const rollbackMessage = ref<string | null>(null);
const rollbackError = ref<string | null>(null);
const updateOperationsLoading = ref(false);
const detailUpdateOperations = ref<
  Array<{
    id: string;
    status: string;
    phase: string;
    fromVersion?: string;
    toVersion?: string;
    rollbackReason?: string;
    lastError?: string;
    updatedAt?: string;
    createdAt?: string;
  }>
>([]);
const updateOperationsError = ref<string | null>(null);

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
    previewLoading,
    runContainerPreview: vi.fn(),
    actionInProgress: ref(null),
    policyInProgress,
    skipCurrentForSelected: vi.fn(),
    snoozeSelected: vi.fn(),
    snoozeDateInput,
    snoozeSelectedUntilDate: vi.fn(),
    selectedSnoozeUntil,
    unsnoozeSelected: vi.fn(),
    selectedSkipTags,
    selectedSkipDigests,
    clearSkipsSelected: vi.fn(),
    selectedUpdatePolicy,
    selectedHasMaturityPolicy,
    selectedMaturityMode,
    selectedMaturityMinAgeDays,
    maturityModeInput,
    maturityMinAgeDaysInput,
    setMaturityPolicySelected: mockSetMaturityPolicySelected,
    clearMaturityPolicySelected: mockClearMaturityPolicySelected,
    clearPolicySelected: vi.fn(),
    policyMessage,
    policyError,
    removeSkipTagSelected: mockRemoveSkipTagSelected,
    removeSkipDigestSelected: mockRemoveSkipDigestSelected,
    detailPreview,
    detailComposePreview,
    previewError,
    triggersLoading,
    detailTriggers,
    getTriggerKey: (trigger: { type: string; name: string }) => `${trigger.type}.${trigger.name}`,
    triggerRunInProgress,
    runAssociatedTrigger: mockRunAssociatedTrigger,
    triggerMessage,
    triggerError,
    backupsLoading,
    detailBackups,
    rollbackInProgress,
    confirmRollback: mockConfirmRollback,
    rollbackToBackup: vi.fn(),
    rollbackMessage,
    rollbackError,
    updateOperationsLoading,
    detailUpdateOperations,
    getOperationStatusStyle: () => ({}),
    formatOperationStatus: (status: string) => status,
    formatOperationPhase: (phase: string) => phase,
    formatRollbackReason: (reason: string) => reason,
    updateOperationsError,
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
    selectedContainer.value = createSelectedContainer();
    previewLoading.value = false;
    previewError.value = null;
    policyInProgress.value = null;
    snoozeDateInput.value = '';
    selectedSnoozeUntil.value = null;
    selectedSkipTags.value = [];
    selectedSkipDigests.value = [];
    selectedUpdatePolicy.value = {};
    selectedHasMaturityPolicy.value = true;
    selectedMaturityMode.value = 'mature';
    selectedMaturityMinAgeDays.value = 7;
    maturityModeInput.value = 'all';
    maturityMinAgeDaysInput.value = 7;
    policyMessage.value = null;
    policyError.value = null;
    triggersLoading.value = false;
    detailTriggers.value = [];
    triggerRunInProgress.value = null;
    triggerMessage.value = null;
    triggerError.value = null;
    backupsLoading.value = false;
    detailBackups.value = [];
    rollbackInProgress.value = null;
    rollbackMessage.value = null;
    rollbackError.value = null;
    updateOperationsLoading.value = false;
    detailUpdateOperations.value = [];
    updateOperationsError.value = null;
    mockRevealContainerEnv.mockReset();
    mockSetMaturityPolicySelected.mockReset();
    mockClearMaturityPolicySelected.mockReset();
    mockRemoveSkipTagSelected.mockReset();
    mockRemoveSkipDigestSelected.mockReset();
    mockRunAssociatedTrigger.mockReset();
    mockConfirmRollback.mockReset();
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

  it('uses the cached sensitive value when revealing again', async () => {
    mockRevealContainerEnv.mockResolvedValueOnce({
      env: [{ key: 'DB_PASSWORD', value: 'cached-secret', sensitive: true }],
    });

    const wrapper = mountComponent();
    const getPasswordRow = () =>
      wrapper
        .findAll('[data-test="container-side-tab-content"] .font-mono')
        .find((row) => row.text().includes('DB_PASSWORD'));
    const getEyeButton = () => getPasswordRow()?.find('button');

    await getEyeButton()?.trigger('click');
    await flushPromises();
    await nextTick();
    expect(mockRevealContainerEnv).toHaveBeenCalledTimes(1);

    await getEyeButton()?.trigger('click');
    await nextTick();
    await getEyeButton()?.trigger('click');
    await nextTick();

    expect(mockRevealContainerEnv).toHaveBeenCalledTimes(1);
    expect(getPasswordRow()?.text()).toContain('cached-secret');
  });

  it('shows an error when revealing a sensitive value fails', async () => {
    mockRevealContainerEnv.mockRejectedValueOnce(new Error('fetch failed'));

    const wrapper = mountComponent();
    const envRows = wrapper.findAll('[data-test="container-side-tab-content"] .font-mono');
    const passwordRow = envRows.find((row) => row.text().includes('DB_PASSWORD'));
    const eyeButton = passwordRow?.find('button');

    await eyeButton?.trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.text()).toContain('fetch failed');
    expect(passwordRow?.text()).toContain('\u2022\u2022\u2022\u2022\u2022');
  });

  it('shows empty-state copy when env vars and volumes are not configured', () => {
    const noDataContainer = createSelectedContainer();
    noDataContainer.details.env = [];
    noDataContainer.details.volumes = [];
    selectedContainer.value = noDataContainer;

    const wrapper = mountComponent();
    expect(wrapper.text()).toContain('No environment variables configured');
    expect(wrapper.text()).toContain('No volumes mounted');
  });

  it('shows mounted volumes in the environment tab', () => {
    const withVolumes = createSelectedContainer();
    withVolumes.details.volumes = ['/var/lib/data'];
    selectedContainer.value = withVolumes;

    const wrapper = mountComponent();
    expect(wrapper.text()).toContain('/var/lib/data');
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

  it('updates maturity inputs and applies the selected mode', async () => {
    activeDetailTab.value = 'actions';
    selectedMaturityMode.value = 'all';

    const wrapper = mountComponent();
    const maturityModeSelect = wrapper.find('select');
    const maturityAgeInput = wrapper.find('input[type="number"]');
    const applyButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Apply Maturity'));

    await maturityModeSelect.setValue('mature');
    await maturityAgeInput.setValue('14');
    await applyButton?.trigger('click');

    expect(maturityModeInput.value).toBe('mature');
    expect(maturityMinAgeDaysInput.value).toBe(14);
    expect(mockSetMaturityPolicySelected).toHaveBeenCalledWith('mature');
    expect(wrapper.text()).toContain('Allow all updates');
  });

  it('shows no active policy summary when no maturity, snooze, or skips exist', () => {
    activeDetailTab.value = 'actions';
    selectedHasMaturityPolicy.value = false;
    selectedSnoozeUntil.value = null;
    selectedSkipTags.value = [];
    selectedSkipDigests.value = [];

    const wrapper = mountComponent();
    const clearButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Clear Maturity'));

    expect(wrapper.text()).toContain('No active update policy.');
    expect(clearButton?.attributes('disabled')).toBeDefined();
    expect(wrapper.text()).not.toContain('Maturity mode:');
  });

  it('renders snooze and skip summaries and wires remove actions', async () => {
    activeDetailTab.value = 'actions';
    selectedSnoozeUntil.value = '2026-03-12T14:30:00Z';
    selectedSkipTags.value = ['v1.2.3'];
    selectedSkipDigests.value = ['sha256:abc123'];

    const wrapper = mountComponent();
    const tagChip = wrapper.findAll('span').find((span) => span.text().includes('v1.2.3'));
    const digestChip = wrapper
      .findAll('span')
      .find((span) => span.text().includes('sha256:abc123'));

    expect(wrapper.text()).toContain('Snoozed until:');
    expect(wrapper.text()).toContain('2026-03-12T14:30:00Z');
    expect(wrapper.text()).toContain('Skipped tags:');
    expect(wrapper.text()).toContain('Skipped digests:');

    await tagChip?.find('button').trigger('click');
    await digestChip?.find('button').trigger('click');

    expect(mockRemoveSkipTagSelected).toHaveBeenCalledWith('v1.2.3');
    expect(mockRemoveSkipDigestSelected).toHaveBeenCalledWith('sha256:abc123');
  });

  it('renders preview loading and preview error states', async () => {
    activeDetailTab.value = 'actions';
    previewLoading.value = true;

    const wrapper = mountComponent();
    expect(wrapper.text()).toContain('Generating preview...');

    previewLoading.value = false;
    detailPreview.value = { error: 'preview failed' };
    await nextTick();

    expect(wrapper.text()).toContain('preview failed');
  });

  it('renders trigger, backup, and update operation rows and wires actions', async () => {
    activeDetailTab.value = 'actions';
    detailTriggers.value = [{ type: 'cron', name: 'nightly', agent: 'watcher' }];
    detailBackups.value = [
      { id: 'backup-1', imageName: 'nginx', imageTag: '1.0', timestamp: '2026-01-01T00:00:00Z' },
    ];
    detailUpdateOperations.value = [
      {
        id: 'op-1',
        status: 'success',
        phase: 'completed',
        fromVersion: '1.0',
        toVersion: '1.1',
        rollbackReason: 'manual',
        lastError: 'none',
        updatedAt: '2026-01-02T00:00:00Z',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ];

    const wrapper = mountComponent();
    const runButton = wrapper.findAll('button').find((button) => button.text().includes('Run'));
    const useBackupButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Use'));

    expect(wrapper.text()).toContain('cron.nightly');
    expect(wrapper.text()).toContain('agent: watcher');
    expect(wrapper.text()).toContain('nginx:1.0');
    expect(wrapper.text()).toContain('op-1');
    expect(wrapper.text()).toContain('success');
    expect(wrapper.text()).toContain('completed');
    expect(wrapper.text()).toContain('manual');

    await runButton?.trigger('click');
    await useBackupButton?.trigger('click');

    expect(mockRunAssociatedTrigger).toHaveBeenCalledWith(detailTriggers.value[0]);
    expect(mockConfirmRollback).toHaveBeenCalledWith('backup-1');
  });
});
