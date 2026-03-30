import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import ContainerSideTabContent from '@/components/containers/ContainerSideTabContent.vue';
import type { Container } from '@/types/container';

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

function createSelectedContainer(): Container {
  return {
    id: 'container-1',
    name: 'nginx',
    image: 'nginx',
    icon: 'docker',
    currentTag: 'latest',
    newTag: null,
    status: 'running',
    registry: 'dockerhub',
    updateKind: null,
    updateMaturity: null,
    bouncer: 'safe',
    server: 'local',
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
const selectedRuntimeDriftWarnings = ref<string[]>([]);
const selectedLifecycleHooks = ref({
  preUpdate: undefined as string | undefined,
  postUpdate: undefined as string | undefined,
  timeoutLabel: '60000ms (default)',
  preAbortBehavior: undefined as string | undefined,
});
const lifecycleHookTemplateVariables = ref<Array<{ name: string; description: string }>>([]);
const selectedImageMetadata = ref({
  architecture: undefined as string | undefined,
  os: undefined as string | undefined,
  digest: undefined as string | undefined,
  created: undefined as string | undefined,
});
const detailVulnerabilityLoading = ref(false);
const detailSbomLoading = ref(false);
const loadDetailSecurityData = vi.fn();
const detailVulnerabilityError = ref<string | null>(null);
const vulnerabilitySummary = ref({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  unknown: 0,
});
const vulnerabilityTotal = ref(0);
const vulnerabilityPreview = ref<Array<{ id: string; severity: string }>>([]);
const selectedSbomFormat = ref('spdx-json');
const loadDetailSbom = vi.fn();
const detailSbomError = ref<string | null>(null);
const sbomDocument = ref<Record<string, unknown> | null>(null);
const sbomComponentCount = ref<number | null>(0);
const sbomGeneratedAt = ref<string | null>(null);
const LOG_AUTO_FETCH_INTERVALS = [
  { value: 5, label: '5s' },
  { value: 15, label: '15s' },
  { value: 30, label: '30s' },
];
const containerAutoFetchInterval = ref(15);
const getContainerLogs = vi.fn<(containerName: string) => string[]>(() => []);
const containerHandleLogScroll = vi.fn();
const containerScrollBlocked = ref(false);
const containerResumeAutoScroll = vi.fn();
const previewLoading = ref(false);
const previewError = ref<string | null>(null);
const runContainerPreview = vi.fn();
const actionInProgress = ref(new Set<string>());
const mockSkipCurrentForSelected = vi.fn();
const mockSnoozeSelected = vi.fn();
const mockSnoozeSelectedUntilDate = vi.fn();
const mockUnsnoozeSelected = vi.fn();
const policyInProgress = ref<string | null>(null);
const snoozeDateInput = ref('');
const selectedSnoozeUntil = ref<string | null>(null);
const selectedSkipTags = ref<string[]>([]);
const selectedSkipDigests = ref<string[]>([]);
const mockClearSkipsSelected = vi.fn();
const selectedUpdatePolicy = ref<Record<string, unknown>>({});
const selectedHasMaturityPolicy = ref(true);
const selectedMaturityMode = ref('mature');
const selectedMaturityMinAgeDays = ref(7);
const maturityModeInput = ref('all');
const maturityMinAgeDaysInput = ref(7);
const mockClearPolicySelected = vi.fn();
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
const mockScanContainer = vi.fn();
const mockConfirmUpdate = vi.fn();
const mockConfirmForceUpdate = vi.fn();

vi.mock('@/components/containers/containersViewTemplateContext', () => ({
  useContainersViewTemplateContext: () => ({
    selectedContainer,
    activeDetailTab,
    selectedRuntimeOrigins: ref({ entrypoint: 'unknown', cmd: 'unknown' }),
    runtimeOriginStyle: () => ({}),
    runtimeOriginLabel: () => '',
    selectedRuntimeDriftWarnings,
    selectedComposePaths,
    selectedLifecycleHooks,
    lifecycleHookTemplateVariables,
    selectedAutoRollbackConfig: ref({
      enabledLabel: 'Disabled (default)',
      windowLabel: '300000ms',
      intervalLabel: '10000ms',
    }),
    selectedImageMetadata,
    formatTimestamp: (v: string) => v,
    detailVulnerabilityLoading,
    detailSbomLoading,
    loadDetailSecurityData,
    detailVulnerabilityError,
    vulnerabilitySummary,
    vulnerabilityTotal,
    vulnerabilityPreview,
    severityStyle: () => ({}),
    normalizeSeverity: (s: string) => s,
    getVulnerabilityPackage: () => '',
    selectedSbomFormat,
    loadDetailSbom,
    detailSbomError,
    sbomDocument,
    sbomComponentCount,
    sbomGeneratedAt,
    LOG_AUTO_FETCH_INTERVALS,
    containerAutoFetchInterval,
    getContainerLogs,
    containerLogRef: ref(null),
    containerHandleLogScroll,
    containerScrollBlocked,
    containerResumeAutoScroll,
    previewLoading,
    runContainerPreview,
    actionInProgress,
    policyInProgress,
    skipCurrentForSelected: mockSkipCurrentForSelected,
    snoozeSelected: mockSnoozeSelected,
    snoozeDateInput,
    snoozeSelectedUntilDate: mockSnoozeSelectedUntilDate,
    selectedSnoozeUntil,
    unsnoozeSelected: mockUnsnoozeSelected,
    selectedSkipTags,
    selectedSkipDigests,
    clearSkipsSelected: mockClearSkipsSelected,
    selectedUpdatePolicy,
    selectedHasMaturityPolicy,
    selectedMaturityMode,
    selectedMaturityMinAgeDays,
    maturityModeInput,
    maturityMinAgeDaysInput,
    setMaturityPolicySelected: mockSetMaturityPolicySelected,
    clearMaturityPolicySelected: mockClearMaturityPolicySelected,
    confirmClearPolicy: mockClearPolicySelected,
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
    scanContainer: mockScanContainer,
    confirmUpdate: mockConfirmUpdate,
    confirmForceUpdate: mockConfirmForceUpdate,
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
        ContainerLogs: {
          props: ['containerId', 'containerName', 'compact'],
          template:
            '<div data-test="container-logs-stub" :data-id="containerId" :data-name="containerName" :data-compact="compact === undefined ? `false` : `true`">{{ containerName }}</div>',
        },
        ContainerStats: {
          props: ['containerId', 'compact'],
          template:
            '<div data-test="container-stats-stub" :data-id="containerId" :data-compact="compact === undefined ? `false` : `true`"></div>',
        },
      },
      directives: {
        tooltip: {},
      },
    },
  });
}

function findButtonByText(wrapper: ReturnType<typeof mountComponent>, text: string) {
  return wrapper.findAll('button').find((button) => button.text().includes(text));
}

describe('ContainerSideTabContent - Environment Variables', () => {
  afterEach(() => {
    activeDetailTab.value = 'environment';
    selectedComposePaths.value = [];
    detailPreview.value = null;
    detailComposePreview.value = null;
    selectedContainer.value = createSelectedContainer();
    selectedRuntimeDriftWarnings.value = [];
    selectedLifecycleHooks.value = {
      preUpdate: undefined,
      postUpdate: undefined,
      timeoutLabel: '60000ms (default)',
      preAbortBehavior: undefined,
    };
    lifecycleHookTemplateVariables.value = [];
    selectedImageMetadata.value = {
      architecture: undefined,
      os: undefined,
      digest: undefined,
      created: undefined,
    };
    detailVulnerabilityLoading.value = false;
    detailSbomLoading.value = false;
    detailVulnerabilityError.value = null;
    vulnerabilitySummary.value = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      unknown: 0,
    };
    vulnerabilityTotal.value = 0;
    vulnerabilityPreview.value = [];
    selectedSbomFormat.value = 'spdx-json';
    detailSbomError.value = null;
    sbomDocument.value = null;
    sbomComponentCount.value = 0;
    sbomGeneratedAt.value = null;
    getContainerLogs.mockReset();
    getContainerLogs.mockReturnValue([]);
    containerAutoFetchInterval.value = 15;
    containerScrollBlocked.value = false;
    previewLoading.value = false;
    previewError.value = null;
    actionInProgress.value = new Set();
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
    containerHandleLogScroll.mockReset();
    containerResumeAutoScroll.mockReset();
    runContainerPreview.mockReset();
    mockSkipCurrentForSelected.mockReset();
    mockSnoozeSelected.mockReset();
    mockSnoozeSelectedUntilDate.mockReset();
    mockUnsnoozeSelected.mockReset();
    mockClearSkipsSelected.mockReset();
    mockClearPolicySelected.mockReset();
    loadDetailSecurityData.mockReset();
    loadDetailSbom.mockReset();
    mockScanContainer.mockReset();
    mockConfirmUpdate.mockReset();
    mockConfirmForceUpdate.mockReset();
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
    expect(eyeButton?.attributes('aria-label')).toBe('Reveal value');

    await eyeButton?.trigger('click');
    await flushPromises();
    await nextTick();

    const updatedRows = wrapper.findAll('[data-test="container-side-tab-content"] .font-mono');
    const updatedPasswordRow = updatedRows.find((row) => row.text().includes('DB_PASSWORD'));
    expect(updatedPasswordRow?.text()).toContain('super-secret');
    expect(updatedPasswordRow?.find('button').attributes('aria-label')).toBe('Hide value');
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
    expect(tagChip?.find('button').attributes('aria-label')).toBe('Remove skip');
    expect(digestChip?.find('button').attributes('aria-label')).toBe('Remove skip');

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

  it('renders populated overview rows for ports, volumes, runtime warnings, and hook variables', () => {
    activeDetailTab.value = 'overview';
    const withOverviewData = createSelectedContainer();
    withOverviewData.details.ports = ['80:80/tcp'];
    withOverviewData.details.volumes = ['/srv/data'];
    selectedContainer.value = withOverviewData;
    selectedRuntimeDriftWarnings.value = ['Entrypoint differs from expected runtime args'];
    selectedLifecycleHooks.value = {
      ...selectedLifecycleHooks.value,
      preAbortBehavior: 'Abort update when pre-update hook fails',
    };
    lifecycleHookTemplateVariables.value = [
      { name: '{{ .Container.Name }}', description: 'Container name at runtime' },
    ];

    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Ports');
    expect(wrapper.text()).toContain('80:80/tcp');
    expect(wrapper.text()).toContain('Volumes');
    expect(wrapper.text()).toContain('/srv/data');
    expect(wrapper.text()).toContain('Entrypoint differs from expected runtime args');
    expect(wrapper.text()).toContain('Abort update when pre-update hook fails');
    expect(wrapper.text()).toContain('{{ .Container.Name }}');
  });

  it('refreshes security data and SBOM from overview controls', async () => {
    activeDetailTab.value = 'overview';
    vulnerabilityPreview.value = [{ id: 'CVE-2026-0001', severity: 'high' }];
    vulnerabilitySummary.value = { critical: 0, high: 1, medium: 0, low: 0, unknown: 0 };
    vulnerabilityTotal.value = 1;

    const wrapper = mountComponent();
    const refreshButton = findButtonByText(wrapper, 'Refresh');
    const sbomButton = findButtonByText(wrapper, 'Refresh SBOM');
    const sbomSelect = wrapper.findAll('select')[0];

    await refreshButton?.trigger('click');
    await sbomSelect.setValue('cyclonedx-json');
    await sbomButton?.trigger('click');

    expect(wrapper.text()).toContain('CVE-2026-0001');
    expect(selectedSbomFormat.value).toBe('cyclonedx-json');
    expect(loadDetailSecurityData).toHaveBeenCalledTimes(1);
    expect(loadDetailSbom).toHaveBeenCalledTimes(1);
  });

  it('renders compact logs tab via container logs component', () => {
    activeDetailTab.value = 'logs';

    const wrapper = mountComponent();
    const logsStub = wrapper.find('[data-test="container-logs-stub"]');

    expect(logsStub.exists()).toBe(true);
    expect(logsStub.attributes('data-id')).toBe('container-1');
    expect(logsStub.attributes('data-name')).toBe('nginx');
    expect(logsStub.attributes('data-compact')).toBe('true');
  });

  it('renders labels list when labels exist', () => {
    activeDetailTab.value = 'labels';
    const withLabels = createSelectedContainer();
    withLabels.details.labels = ['com.example.role=web'];
    selectedContainer.value = withLabels;

    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Labels');
    expect(wrapper.text()).toContain('com.example.role=web');
  });

  it('fires action, skip, snooze, reset, and rollback latest handlers', async () => {
    activeDetailTab.value = 'actions';
    const actionable = createSelectedContainer();
    actionable.newTag = '1.25.0';
    selectedContainer.value = actionable;
    selectedSkipTags.value = ['v1.24.0'];
    selectedUpdatePolicy.value = { mode: 'manual' };
    selectedSnoozeUntil.value = '2026-03-21T00:00:00Z';
    detailBackups.value = [
      {
        id: 'latest-backup',
        imageName: 'nginx',
        imageTag: '1.24.0',
        timestamp: '2026-03-12T00:00:00Z',
      },
    ];

    const wrapper = mountComponent();
    const previewButton = findButtonByText(wrapper, 'Preview Update');
    const updateNowButton = findButtonByText(wrapper, 'Update Now');
    const scanNowButton = findButtonByText(wrapper, 'Scan Now');
    const skipButton = findButtonByText(wrapper, 'Skip This Update');
    const snooze1dButton = findButtonByText(wrapper, 'Snooze 1d');
    const snooze7dButton = findButtonByText(wrapper, 'Snooze 7d');
    const snoozeUntilButton = findButtonByText(wrapper, 'Snooze Until');
    const unsnoozeButton = findButtonByText(wrapper, 'Unsnooze');
    const clearSkipsButton = findButtonByText(wrapper, 'Clear Skips');
    const clearPolicyButton = findButtonByText(wrapper, 'Clear Policy');
    const rollbackLatestButton = findButtonByText(wrapper, 'Rollback Latest');
    const dateInput = wrapper.find('input[type="date"]');

    await previewButton?.trigger('click');
    await updateNowButton?.trigger('click');
    await scanNowButton?.trigger('click');
    await skipButton?.trigger('click');
    await snooze1dButton?.trigger('click');
    await snooze7dButton?.trigger('click');
    await dateInput.setValue('2026-03-25');
    await snoozeUntilButton?.trigger('click');
    await unsnoozeButton?.trigger('click');
    await clearSkipsButton?.trigger('click');
    await clearPolicyButton?.trigger('click');
    await rollbackLatestButton?.trigger('click');

    expect(runContainerPreview).toHaveBeenCalledTimes(1);
    expect(mockConfirmUpdate).toHaveBeenCalledWith('nginx');
    expect(mockScanContainer).toHaveBeenCalledWith('nginx');
    expect(mockSkipCurrentForSelected).toHaveBeenCalledTimes(1);
    expect(mockSnoozeSelected).toHaveBeenCalledWith(1);
    expect(mockSnoozeSelected).toHaveBeenCalledWith(7);
    expect(mockSnoozeSelectedUntilDate).toHaveBeenCalledTimes(1);
    expect(mockUnsnoozeSelected).toHaveBeenCalledTimes(1);
    expect(mockClearSkipsSelected).toHaveBeenCalledTimes(1);
    expect(mockClearPolicySelected).toHaveBeenCalledTimes(1);
    expect(mockConfirmRollback).toHaveBeenCalledWith();
  });

  it('fires force update handler for blocked containers', async () => {
    activeDetailTab.value = 'actions';
    const blockedContainer = createSelectedContainer() as ReturnType<
      typeof createSelectedContainer
    > & {
      bouncer?: string;
    };
    blockedContainer.newTag = '1.25.0';
    blockedContainer.bouncer = 'blocked';
    selectedContainer.value = blockedContainer;

    const wrapper = mountComponent();
    const forceUpdateButton = findButtonByText(wrapper, 'Force Update');

    await forceUpdateButton?.trigger('click');

    expect(mockConfirmForceUpdate).toHaveBeenCalledWith('nginx');
  });

  it('keeps sensitive value masked when reveal response has no env list', async () => {
    mockRevealContainerEnv.mockResolvedValueOnce({});

    const wrapper = mountComponent();
    const passwordRow = wrapper
      .findAll('[data-test="container-side-tab-content"] .font-mono')
      .find((row) => row.text().includes('DB_PASSWORD'));
    const eyeButton = passwordRow?.find('button');

    await eyeButton?.trigger('click');
    await flushPromises();
    await nextTick();

    expect(passwordRow?.text()).toContain('\u2022\u2022\u2022\u2022\u2022');
    expect(wrapper.text()).not.toContain('Failed to reveal value');
  });

  it('renders overview version and registry conditional states', () => {
    activeDetailTab.value = 'overview';
    selectedComposePaths.value = ['/opt/stack/compose.yml'];
    selectedImageMetadata.value = {
      architecture: 'amd64',
      os: 'linux',
      digest: 'sha256:abc',
      created: '2026-03-10T10:00:00Z',
    };
    selectedContainer.value = {
      ...createSelectedContainer(),
      newTag: '1.26.0',
      releaseLink: 'https://example.com/release-notes',
      registryError: 'Registry authentication failed',
    };

    const wrapper = mountComponent();
    const releaseLink = wrapper.find('a[href="https://example.com/release-notes"]');

    expect(releaseLink.exists()).toBe(true);
    expect(wrapper.text()).toContain('1.26.0');
    expect(wrapper.text()).toContain('Registry authentication failed');
    expect(wrapper.text()).toContain('2026-03-10T10:00:00Z');
    expect(wrapper.text()).not.toContain('#1');
  });

  it('renders no-update reason when no new tag is available', () => {
    activeDetailTab.value = 'overview';
    selectedContainer.value = {
      ...createSelectedContainer(),
      noUpdateReason: 'Pinned image digest has no newer tag',
    };

    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Pinned image digest has no newer tag');
  });

  it('shows floating tag badge in overview when tag precision is floating and digest watch is disabled', () => {
    activeDetailTab.value = 'overview';
    selectedContainer.value = {
      ...createSelectedContainer(),
      tagPrecision: 'floating',
      imageDigestWatch: false,
    };

    const wrapper = mountComponent();

    expect(wrapper.find('[data-test="floating-tag-badge"]').exists()).toBe(true);
  });

  it('hides floating tag badge in overview when tag is specific or digest watch is enabled', async () => {
    activeDetailTab.value = 'overview';
    selectedContainer.value = {
      ...createSelectedContainer(),
      tagPrecision: 'specific',
      imageDigestWatch: false,
    };

    const wrapper = mountComponent();
    expect(wrapper.find('[data-test="floating-tag-badge"]').exists()).toBe(false);

    selectedContainer.value = {
      ...createSelectedContainer(),
      tagPrecision: 'floating',
      imageDigestWatch: true,
    };
    await nextTick();

    expect(wrapper.find('[data-test="floating-tag-badge"]').exists()).toBe(false);
  });

  it('renders vulnerability and SBOM loading/error states', () => {
    activeDetailTab.value = 'overview';
    detailVulnerabilityLoading.value = true;
    detailSbomLoading.value = true;

    const loadingWrapper = mountComponent();
    expect(loadingWrapper.text()).toContain('Refreshing...');
    expect(loadingWrapper.text()).toContain('Loading vulnerability data...');
    expect(loadingWrapper.text()).toContain('Loading SBOM...');
    expect(loadingWrapper.text()).toContain('Loading SBOM document...');

    detailVulnerabilityLoading.value = false;
    detailSbomLoading.value = false;
    detailVulnerabilityError.value = 'Vulnerability endpoint failed';
    detailSbomError.value = 'SBOM endpoint failed';
    const errorWrapper = mountComponent();

    expect(errorWrapper.text()).toContain('Vulnerability endpoint failed');
    expect(errorWrapper.text()).toContain('SBOM endpoint failed');
  });

  it('renders SBOM document branches for optional fields', () => {
    activeDetailTab.value = 'overview';
    sbomDocument.value = { schema: 'cyclonedx' };
    sbomComponentCount.value = null;
    sbomGeneratedAt.value = '2026-03-11T00:00:00Z';

    const generatedWrapper = mountComponent();
    expect(generatedWrapper.text()).toContain('generated:');
    expect(generatedWrapper.text()).not.toContain('components:');

    sbomComponentCount.value = 42;
    sbomGeneratedAt.value = null;
    const componentsWrapper = mountComponent();
    expect(componentsWrapper.text()).toContain('components:');
    expect(componentsWrapper.text()).not.toContain('generated:');
  });

  it('renders preview/policy alternate states and fallbacks', () => {
    activeDetailTab.value = 'actions';
    policyMessage.value = 'Policy applied';
    policyError.value = 'Policy warning';
    previewError.value = 'Preview transport failed';
    detailPreview.value = {
      isRunning: false,
      networks: [],
    };
    detailComposePreview.value = {
      files: ['/a.yml', '/b.yml'],
      writableFile: '/tmp/compose.yml',
      willWrite: true,
    };

    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Policy applied');
    expect(wrapper.text()).toContain('Policy warning');
    expect(wrapper.text()).toContain('Preview transport failed');
    expect(wrapper.text()).toContain('Current: -');
    expect(wrapper.text()).toContain('New: -');
    expect(wrapper.text()).toContain('unknown');
    expect(wrapper.text()).toContain('Running: no');
    expect(wrapper.text()).toContain('Networks: -');
    expect(wrapper.text()).toContain('Compose files:');
    expect(wrapper.text()).toContain('Writable file:');
    expect(wrapper.text()).toContain('/tmp/compose.yml');
    expect(wrapper.text()).toContain('Writes compose file:');
    expect(wrapper.text()).toContain('yes');
    expect(wrapper.text()).not.toContain('Compose service:');
    expect(wrapper.text()).not.toContain('Patch preview:');
  });

  it('renders trigger/backup/update-history alternate states', () => {
    activeDetailTab.value = 'actions';
    triggersLoading.value = true;
    backupsLoading.value = true;
    rollbackInProgress.value = 'latest';
    rollbackMessage.value = 'Rollback complete';
    rollbackError.value = 'Rollback warning';
    updateOperationsLoading.value = true;
    updateOperationsError.value = 'History endpoint failed';

    const loadingWrapper = mountComponent();
    expect(loadingWrapper.text()).toContain('Loading triggers...');
    expect(loadingWrapper.text()).toContain('Rolling back...');
    expect(loadingWrapper.text()).toContain('Loading backups...');
    expect(loadingWrapper.text()).toContain('Rollback complete');
    expect(loadingWrapper.text()).toContain('Rollback warning');
    expect(loadingWrapper.text()).toContain('Loading operation history...');
    expect(loadingWrapper.text()).toContain('History endpoint failed');

    triggersLoading.value = false;
    detailTriggers.value = [{ type: 'cron', name: 'nightly' }];
    triggerRunInProgress.value = 'cron.nightly';
    triggerMessage.value = 'Trigger completed';
    triggerError.value = 'Trigger warning';
    backupsLoading.value = false;
    rollbackInProgress.value = 'backup-1';
    detailBackups.value = [
      { id: 'backup-1', imageName: 'nginx', imageTag: '1.24.0', timestamp: '2026-03-12T00:00:00Z' },
    ];
    updateOperationsLoading.value = false;
    detailUpdateOperations.value = [
      {
        id: 'op-a',
        status: 'failed',
        phase: 'rollback',
        toVersion: '2.0.0',
        createdAt: '2026-03-01T00:00:00Z',
      },
      {
        id: 'op-b',
        status: 'failed',
        phase: 'rollback',
        fromVersion: '1.0.0',
        rollbackReason: 'manual',
        lastError: 'timeout',
        createdAt: '2026-03-02T00:00:00Z',
      },
    ];

    const dataWrapper = mountComponent();
    expect(dataWrapper.text()).toContain('Running...');
    expect(dataWrapper.text()).not.toContain('agent:');
    expect(dataWrapper.text()).toContain('Trigger completed');
    expect(dataWrapper.text()).toContain('Trigger warning');
    expect(dataWrapper.text()).toContain('Rolling...');
    expect(dataWrapper.text()).toContain('Version: ?');
    expect(dataWrapper.text()).toContain('Version: 1.0.0');
    expect(dataWrapper.text()).toContain('Rollback reason:');
    expect(dataWrapper.text()).toContain('manual');
    expect(dataWrapper.text()).toContain('Last error:');
    expect(dataWrapper.text()).toContain('timeout');
  });

  it('renders labels empty state and logs component without inline pause controls', async () => {
    activeDetailTab.value = 'labels';
    const labelsWrapper = mountComponent();
    expect(labelsWrapper.text()).toContain('No labels assigned');

    activeDetailTab.value = 'logs';
    await nextTick();

    const logsWrapper = mountComponent();
    const logsStub = logsWrapper.find('[data-test="container-logs-stub"]');
    expect(logsStub.exists()).toBe(true);
    expect(logsWrapper.text()).not.toContain('Auto-scroll paused');
  });

  it('omits optional preview and version rows when values are absent', () => {
    activeDetailTab.value = 'actions';
    detailPreview.value = {
      currentImage: 'nginx:latest',
      newImage: 'nginx:latest',
      isRunning: true,
      networks: 'bridge',
    };
    detailComposePreview.value = null;
    detailUpdateOperations.value = [
      {
        id: 'op-no-versions',
        status: 'success',
        phase: 'completed',
        createdAt: '2026-03-02T00:00:00Z',
      },
    ];

    const wrapper = mountComponent();

    expect(wrapper.text()).not.toContain('Networks:');
    expect(wrapper.text()).not.toContain('Compose file:');
    expect(wrapper.text()).not.toContain('Writes compose file:');
    expect(wrapper.text()).not.toContain('Version:');
  });
});
