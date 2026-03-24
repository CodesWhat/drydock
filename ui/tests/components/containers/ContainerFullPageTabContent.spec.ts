import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import ContainerFullPageTabContent from '@/components/containers/ContainerFullPageTabContent.vue';

type Trigger = {
  type: string;
  name: string;
  agent?: string;
};

type Backup = {
  id: string;
  imageName: string;
  imageTag: string;
  timestamp: string;
};

type UpdateOperation = {
  id: string;
  status: string;
  phase: string;
  fromVersion?: string;
  toVersion?: string;
  rollbackReason?: string;
  lastError?: string;
  updatedAt?: string;
  createdAt: string;
};

function makeContainer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'container-1',
    name: 'nginx',
    image: 'nginx:1.0',
    currentTag: '1.0',
    status: 'running',
    server: 'local',
    registry: 'hub',
    registryUrl: '',
    registryName: '',
    bouncer: 'clear',
    newTag: '1.1',
    updateKind: 'minor',
    includeTags: '',
    excludeTags: '',
    transformTags: '',
    triggerInclude: '',
    triggerExclude: '',
    noUpdateReason: '',
    releaseLink: '',
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
const activeDetailTab = ref('actions');
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
const selectedImageMetadata = ref({
  architecture: '',
  os: '',
  digest: '',
  created: '',
});
const detailVulnerabilityLoading = ref(false);
const detailSbomLoading = ref(false);
const detailVulnerabilityError = ref<string | null>(null);
const vulnerabilitySummary = ref({
  critical: 0,
  high: 0,
  medium: 0,
  low: 0,
  unknown: 0,
});
const vulnerabilityTotal = ref(0);
const vulnerabilityPreview = ref<{ id: string; severity: string }[]>([]);
const selectedSbomFormat = ref('spdx-json');
const detailSbomError = ref<string | null>(null);
const sbomDocument = ref<Record<string, unknown> | null>(null);
const sbomComponentCount = ref<number | null>(null);
const sbomGeneratedAt = ref<string | null>(null);
const containerAutoFetchInterval = ref(0);
const containerLogRef = ref<HTMLElement | null>(null);
const containerScrollBlocked = ref(false);
const previewLoading = ref(false);
const actionInProgress = ref<string | null>(null);
const policyInProgress = ref<string | null>(null);
const snoozeDateInput = ref('');
const selectedSnoozeUntil = ref<string | null>(null);
const selectedSkipTags = ref<string[]>([]);
const selectedSkipDigests = ref<string[]>([]);
const selectedUpdatePolicy = ref<Record<string, unknown>>({});
const selectedHasMaturityPolicy = ref(true);
const selectedMaturityMode = ref<'all' | 'mature'>('mature');
const selectedMaturityMinAgeDays = ref(7);
const maturityModeInput = ref<'all' | 'mature'>('all');
const maturityMinAgeDaysInput = ref(7);
const policyMessage = ref<string | null>(null);
const policyError = ref<string | null>(null);
const detailPreview = ref<Record<string, unknown> | null>(null);
const detailComposePreview = ref<{
  files: string[];
  service?: string;
  writableFile?: string;
  willWrite?: boolean;
  patch?: string;
} | null>(null);
const previewError = ref<string | null>(null);
const triggersLoading = ref(false);
const detailTriggers = ref<Trigger[]>([]);
const triggerRunInProgress = ref<string | null>(null);
const triggerMessage = ref<string | null>(null);
const triggerError = ref<string | null>(null);
const backupsLoading = ref(false);
const detailBackups = ref<Backup[]>([]);
const rollbackInProgress = ref<string | null>(null);
const rollbackMessage = ref<string | null>(null);
const rollbackError = ref<string | null>(null);
const updateOperationsLoading = ref(false);
const detailUpdateOperations = ref<UpdateOperation[]>([]);
const updateOperationsError = ref<string | null>(null);

const mockLoadDetailSecurityData = vi.fn();
const mockLoadDetailSbom = vi.fn();
const mockRevealContainerEnv = vi.fn();
const mockGetContainerLogs = vi.fn(() => []);
const mockContainerHandleLogScroll = vi.fn();
const mockContainerResumeAutoScroll = vi.fn();
const mockRunContainerPreview = vi.fn();
const mockSkipCurrentForSelected = vi.fn();
const mockSnoozeSelected = vi.fn();
const mockSnoozeSelectedUntilDate = vi.fn();
const mockUnsnoozeSelected = vi.fn();
const mockClearSkipsSelected = vi.fn();
const mockSetMaturityPolicySelected = vi.fn();
const mockClearMaturityPolicySelected = vi.fn();
const mockClearPolicySelected = vi.fn();
const mockRemoveSkipTagSelected = vi.fn();
const mockRemoveSkipDigestSelected = vi.fn();
const mockGetTriggerKey = vi.fn((trigger: Trigger) => `${trigger.type}.${trigger.name}`);
const mockRunAssociatedTrigger = vi.fn();
const mockConfirmRollback = vi.fn();
const mockGetOperationStatusStyle = vi.fn(() => ({
  backgroundColor: 'var(--dd-bg-inset)',
  color: 'var(--dd-text)',
}));
const mockFormatOperationStatus = vi.fn((status: string) => `status:${status}`);
const mockFormatOperationPhase = vi.fn((phase: string) => `phase:${phase}`);
const mockFormatRollbackReason = vi.fn((reason: string) => `reason:${reason}`);
const mockScanContainer = vi.fn();
const mockConfirmUpdate = vi.fn();
const mockConfirmForceUpdate = vi.fn();

const LOG_AUTO_FETCH_INTERVALS = [
  { value: 0, label: 'Paused' },
  { value: 5, label: '5s' },
];

vi.mock('@/services/container', () => ({
  revealContainerEnv: (...args: unknown[]) => mockRevealContainerEnv(...args),
}));

vi.mock('@/components/containers/containersViewTemplateContext', () => ({
  useContainersViewTemplateContext: () => ({
    selectedContainer,
    activeDetailTab,
    selectedRuntimeOrigins,
    runtimeOriginStyle: () => ({}),
    runtimeOriginLabel: () => 'unknown',
    selectedRuntimeDriftWarnings,
    selectedComposePaths,
    selectedLifecycleHooks,
    lifecycleHookTemplateVariables,
    selectedAutoRollbackConfig,
    selectedImageMetadata,
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
    LOG_AUTO_FETCH_INTERVALS,
    containerAutoFetchInterval,
    getContainerLogs: mockGetContainerLogs,
    containerLogRef,
    containerHandleLogScroll: mockContainerHandleLogScroll,
    containerScrollBlocked,
    containerResumeAutoScroll: mockContainerResumeAutoScroll,
    previewLoading,
    runContainerPreview: mockRunContainerPreview,
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
    getTriggerKey: mockGetTriggerKey,
    triggerRunInProgress,
    runAssociatedTrigger: mockRunAssociatedTrigger,
    triggerMessage,
    triggerError,
    backupsLoading,
    detailBackups,
    rollbackInProgress,
    confirmRollback: mockConfirmRollback,
    rollbackMessage,
    rollbackError,
    updateOperationsLoading,
    detailUpdateOperations,
    getOperationStatusStyle: mockGetOperationStatusStyle,
    formatOperationStatus: mockFormatOperationStatus,
    formatOperationPhase: mockFormatOperationPhase,
    formatRollbackReason: mockFormatRollbackReason,
    updateOperationsError,
    scanContainer: mockScanContainer,
    confirmUpdate: mockConfirmUpdate,
    confirmForceUpdate: mockConfirmForceUpdate,
    registryColorBg: () => 'var(--dd-bg-inset)',
    registryColorText: () => 'var(--dd-text)',
    registryLabel: () => 'Docker Hub',
    updateKindColor: () => ({ bg: 'var(--dd-bg-inset)', text: 'var(--dd-text)' }),
  }),
}));

function resetState() {
  selectedContainer.value = makeContainer();
  activeDetailTab.value = 'actions';
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
  selectedImageMetadata.value = {
    architecture: '',
    os: '',
    digest: '',
    created: '',
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
  sbomComponentCount.value = null;
  sbomGeneratedAt.value = null;
  containerAutoFetchInterval.value = 0;
  containerLogRef.value = null;
  containerScrollBlocked.value = false;
  previewLoading.value = false;
  actionInProgress.value = null;
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
  detailPreview.value = null;
  detailComposePreview.value = null;
  previewError.value = null;
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

  mockLoadDetailSecurityData.mockReset();
  mockLoadDetailSbom.mockReset();
  mockRevealContainerEnv.mockReset();
  mockGetContainerLogs.mockReset();
  mockContainerHandleLogScroll.mockReset();
  mockContainerResumeAutoScroll.mockReset();
  mockRunContainerPreview.mockReset();
  mockSkipCurrentForSelected.mockReset();
  mockSnoozeSelected.mockReset();
  mockSnoozeSelectedUntilDate.mockReset();
  mockUnsnoozeSelected.mockReset();
  mockClearSkipsSelected.mockReset();
  mockSetMaturityPolicySelected.mockReset();
  mockClearMaturityPolicySelected.mockReset();
  mockClearPolicySelected.mockReset();
  mockRemoveSkipTagSelected.mockReset();
  mockRemoveSkipDigestSelected.mockReset();
  mockGetTriggerKey.mockClear();
  mockRunAssociatedTrigger.mockReset();
  mockConfirmRollback.mockReset();
  mockGetOperationStatusStyle.mockClear();
  mockFormatOperationStatus.mockClear();
  mockFormatOperationPhase.mockClear();
  mockFormatRollbackReason.mockClear();
  mockScanContainer.mockReset();
  mockConfirmUpdate.mockReset();
  mockConfirmForceUpdate.mockReset();
}

function mountComponent() {
  return mount(ContainerFullPageTabContent, {
    global: {
      stubs: {
        ContainerLogs: {
          template:
            '<div data-test="container-logs-stub" :data-id="containerId" :data-name="containerName" :data-compact="compact ? `true` : `false`">{{ containerName }}</div>',
          props: ['containerId', 'containerName', 'compact'],
        },
        AppIcon: {
          template: '<span class="app-icon-stub" />',
          props: ['name', 'size'],
        },
      },
    },
  });
}

function findButtonByText(wrapper: ReturnType<typeof mountComponent>, text: string) {
  return wrapper.findAll('button').find((button) => button.text().includes(text));
}

describe('ContainerFullPageTabContent', () => {
  afterEach(() => {
    resetState();
  });

  it('wires standard action buttons in the non-blocked update branch', async () => {
    snoozeDateInput.value = '2026-03-20';
    selectedSnoozeUntil.value = '2026-03-21T00:00:00Z';

    const wrapper = mountComponent();

    expect(findButtonByText(wrapper, 'Force Update')).toBeUndefined();
    const updateNowButton = findButtonByText(wrapper, 'Update Now');
    expect(updateNowButton).toBeDefined();

    await findButtonByText(wrapper, 'Preview Update')?.trigger('click');
    await updateNowButton?.trigger('click');
    await findButtonByText(wrapper, 'Scan Now')?.trigger('click');
    await findButtonByText(wrapper, 'Skip This Update')?.trigger('click');
    await findButtonByText(wrapper, 'Snooze 1d')?.trigger('click');
    await findButtonByText(wrapper, 'Snooze 7d')?.trigger('click');
    await findButtonByText(wrapper, 'Snooze Until')?.trigger('click');
    await findButtonByText(wrapper, 'Unsnooze')?.trigger('click');

    expect(mockRunContainerPreview).toHaveBeenCalledTimes(1);
    expect(mockConfirmUpdate).toHaveBeenCalledWith('nginx');
    expect(mockScanContainer).toHaveBeenCalledWith('nginx');
    expect(mockSkipCurrentForSelected).toHaveBeenCalledTimes(1);
    expect(mockSnoozeSelected).toHaveBeenNthCalledWith(1, 1);
    expect(mockSnoozeSelected).toHaveBeenNthCalledWith(2, 7);
    expect(mockSnoozeSelectedUntilDate).toHaveBeenCalledTimes(1);
    expect(mockUnsnoozeSelected).toHaveBeenCalledTimes(1);
  });

  it('uses the force-update action branch for blocked containers', async () => {
    selectedContainer.value = makeContainer({ bouncer: 'blocked' });

    const wrapper = mountComponent();

    expect(findButtonByText(wrapper, 'Update Now')).toBeUndefined();
    const forceUpdateButton = findButtonByText(wrapper, 'Force Update');
    expect(forceUpdateButton).toBeDefined();

    await forceUpdateButton?.trigger('click');
    expect(mockConfirmForceUpdate).toHaveBeenCalledWith('nginx');
  });

  it('wires maturity controls and renders mature-only policy summary', async () => {
    selectedHasMaturityPolicy.value = true;
    selectedMaturityMode.value = 'mature';
    selectedMaturityMinAgeDays.value = 14;
    maturityModeInput.value = 'mature';

    const wrapper = mountComponent();

    const maturityDaysInput = wrapper.find('input[type="number"]');
    await maturityDaysInput.setValue('21');
    expect(maturityMinAgeDaysInput.value).toBe(21);

    const applyMaturityButton = findButtonByText(wrapper, 'Apply Maturity');
    const clearMaturityButton = findButtonByText(wrapper, 'Clear Maturity');
    expect(applyMaturityButton).toBeDefined();
    expect(clearMaturityButton).toBeDefined();
    expect(clearMaturityButton?.attributes('disabled')).toBeUndefined();

    await applyMaturityButton?.trigger('click');
    await clearMaturityButton?.trigger('click');

    expect(mockSetMaturityPolicySelected).toHaveBeenCalledWith('mature');
    expect(mockClearMaturityPolicySelected).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('Mature only (14d minimum)');
  });

  it('renders the allow-all maturity summary branch', () => {
    selectedHasMaturityPolicy.value = true;
    selectedMaturityMode.value = 'all';

    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Allow all updates');
  });

  it('shows no-active-policy fallback and disables clear maturity when no maturity policy exists', () => {
    selectedHasMaturityPolicy.value = false;
    selectedSnoozeUntil.value = null;
    selectedSkipTags.value = [];
    selectedSkipDigests.value = [];

    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('No active update policy.');
    const clearMaturityButton = findButtonByText(wrapper, 'Clear Maturity');
    expect(clearMaturityButton?.attributes('disabled')).toBeDefined();
  });

  it('renders skip entries and wires reset/removal handlers', async () => {
    selectedSkipTags.value = ['1.2.3'];
    selectedSkipDigests.value = ['sha256:abc'];
    selectedUpdatePolicy.value = { mode: 'mature' };

    const wrapper = mountComponent();

    await findButtonByText(wrapper, 'Clear Skips')?.trigger('click');
    await findButtonByText(wrapper, 'Clear Policy')?.trigger('click');

    expect(mockClearSkipsSelected).toHaveBeenCalledTimes(1);
    expect(mockClearPolicySelected).toHaveBeenCalledTimes(1);

    const tagLabel = wrapper.findAll('span').find((node) => node.text() === '1.2.3');
    const digestLabel = wrapper.findAll('span').find((node) => node.text() === 'sha256:abc');
    const tagRemoveButton = tagLabel?.element.parentElement?.querySelector('button');
    const digestRemoveButton = digestLabel?.element.parentElement?.querySelector('button');
    expect(tagRemoveButton).toBeTruthy();
    expect(digestRemoveButton).toBeTruthy();

    (tagRemoveButton as HTMLButtonElement).click();
    (digestRemoveButton as HTMLButtonElement).click();
    await nextTick();

    expect(mockRemoveSkipTagSelected).toHaveBeenCalledWith('1.2.3');
    expect(mockRemoveSkipDigestSelected).toHaveBeenCalledWith('sha256:abc');
  });

  it('renders detailed preview, trigger, backups, and operation history branches', async () => {
    detailPreview.value = {
      currentImage: 'nginx:1.0',
      newImage: 'nginx:1.1',
      updateKind: { kind: 'tag' },
      isRunning: true,
      networks: ['bridge'],
    };
    detailComposePreview.value = {
      files: ['/opt/stack/compose.yml', '/opt/stack/compose.override.yml'],
      service: 'web',
      writableFile: '/opt/stack/compose.yml',
      willWrite: false,
      patch: '@@ -1,3 +1,3 @@',
    };
    detailTriggers.value = [{ type: 'docker', name: 'deploy', agent: 'watchtower' }];
    detailBackups.value = [
      {
        id: 'backup-1',
        imageName: 'nginx',
        imageTag: '1.0',
        timestamp: '2026-03-11T00:00:00Z',
      },
    ];
    detailUpdateOperations.value = [
      {
        id: 'op-1',
        status: 'success',
        phase: 'complete',
        fromVersion: '1.0',
        toVersion: '1.1',
        rollbackReason: 'manual',
        lastError: 'none',
        createdAt: '2026-03-10T00:00:00Z',
        updatedAt: '2026-03-11T00:00:00Z',
      },
    ];

    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Compose files:');
    expect(wrapper.text()).toContain('/opt/stack/compose.yml, /opt/stack/compose.override.yml');
    expect(wrapper.text()).toContain('Writes compose file:');
    expect(wrapper.text()).toContain('no');
    expect(wrapper.text()).toContain('Patch preview:');

    const runTriggerButton = findButtonByText(wrapper, 'Run');
    expect(runTriggerButton).toBeDefined();
    await runTriggerButton?.trigger('click');
    expect(mockRunAssociatedTrigger).toHaveBeenCalledWith(detailTriggers.value[0]);

    const rollbackLatestButton = findButtonByText(wrapper, 'Rollback Latest');
    const rollbackSpecificButton = findButtonByText(wrapper, 'Use');
    expect(rollbackLatestButton).toBeDefined();
    expect(rollbackSpecificButton).toBeDefined();
    await rollbackLatestButton?.trigger('click');
    await rollbackSpecificButton?.trigger('click');
    expect(mockConfirmRollback).toHaveBeenCalledWith();
    expect(mockConfirmRollback).toHaveBeenCalledWith('backup-1');

    expect(wrapper.text()).toContain('status:success');
    expect(wrapper.text()).toContain('phase:complete');
    expect(wrapper.text()).toContain('reason:manual');
  });

  it('renders action-tab status/error messages and running-state branches', () => {
    policyMessage.value = 'Policy saved';
    policyError.value = 'Policy failed';
    detailPreview.value = { error: 'Preview generation failed' };
    previewError.value = 'Preview API error';
    detailTriggers.value = [{ type: 'docker', name: 'deploy', agent: 'watchtower' }];
    triggerRunInProgress.value = 'docker.deploy';
    triggerMessage.value = 'Trigger started';
    triggerError.value = 'Trigger failed';
    detailBackups.value = [
      {
        id: 'backup-1',
        imageName: 'nginx',
        imageTag: '1.0',
        timestamp: '2026-03-11T00:00:00Z',
      },
    ];
    rollbackInProgress.value = 'latest';
    rollbackMessage.value = 'Rollback queued';
    rollbackError.value = 'Rollback failed';
    detailUpdateOperations.value = [
      {
        id: 'op-1',
        status: 'failed',
        phase: 'rollback',
        fromVersion: '1.0',
        toVersion: '1.1',
        rollbackReason: 'manual',
        lastError: 'boom',
        createdAt: '2026-03-10T00:00:00Z',
        updatedAt: '2026-03-11T00:00:00Z',
      },
    ];
    updateOperationsError.value = 'Operation feed unavailable';

    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Policy saved');
    expect(wrapper.text()).toContain('Policy failed');
    expect(wrapper.text()).toContain('Preview generation failed');
    expect(wrapper.text()).toContain('Preview API error');
    expect(wrapper.text()).toContain('Running...');
    expect(wrapper.text()).toContain('Trigger started');
    expect(wrapper.text()).toContain('Trigger failed');
    expect(wrapper.text()).toContain('Rolling back...');
    expect(wrapper.text()).toContain('Rollback queued');
    expect(wrapper.text()).toContain('Rollback failed');
    expect(wrapper.text()).toContain('Operation feed unavailable');
  });

  it('renders preview and history fallback values for missing operation details', () => {
    detailPreview.value = {
      currentImage: '',
      newImage: '',
      updateKind: undefined,
      isRunning: false,
      networks: [],
    };
    detailComposePreview.value = {
      files: ['/opt/stack/compose.yml'],
      willWrite: true,
    };
    detailTriggers.value = [{ type: 'docker', name: 'deploy' }];
    detailBackups.value = [
      {
        id: 'backup-1',
        imageName: 'nginx',
        imageTag: '1.0',
        timestamp: '2026-03-11T00:00:00Z',
      },
    ];
    rollbackInProgress.value = 'backup-1';
    detailUpdateOperations.value = [
      {
        id: 'op-missing-from',
        status: 'pending',
        phase: 'download',
        toVersion: '2.0',
        createdAt: '2026-03-12T00:00:00Z',
      },
      {
        id: 'op-missing-to',
        status: 'pending',
        phase: 'download',
        fromVersion: '1.0',
        createdAt: '2026-03-12T00:00:00Z',
      },
    ];

    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Current: -');
    expect(wrapper.text()).toContain('New: -');
    expect(wrapper.text()).toContain('unknown');
    expect(wrapper.text()).toContain('Running:');
    expect(wrapper.text()).toContain('no');
    expect(wrapper.text()).toContain('Networks: -');
    expect(wrapper.text()).toContain('Compose file:');
    expect(wrapper.text()).toContain('Writes compose file:');
    expect(wrapper.text()).toContain('yes');
    expect(wrapper.text()).toContain('Rolling...');
    expect(wrapper.text()).toContain('?');
    expect(wrapper.text()).toContain('2.0');
    expect(wrapper.text()).toContain('1.0');
    expect(wrapper.text()).not.toContain('Rollback reason:');
    expect(wrapper.text()).not.toContain('Last error:');
  });

  it('hides optional preview and operation rows when their data is absent', () => {
    detailPreview.value = {
      currentImage: 'nginx:1.0',
      newImage: 'nginx:1.1',
      updateKind: 'minor',
      isRunning: true,
      // no networks property on purpose
    };
    detailComposePreview.value = {
      files: [],
      // no willWrite/service/writableFile/patch on purpose
    };
    detailUpdateOperations.value = [
      {
        id: 'op-no-version',
        status: 'pending',
        phase: 'download',
        createdAt: '2026-03-12T00:00:00Z',
      },
    ];

    const wrapper = mountComponent();

    expect(wrapper.text()).not.toContain('Networks:');
    expect(wrapper.text()).not.toContain('Compose file:');
    expect(wrapper.text()).not.toContain('Writes compose file:');
    expect(wrapper.text()).not.toContain('Version:');
  });

  it('renders loading and empty-state branches across action-tab cards', async () => {
    previewLoading.value = true;
    triggersLoading.value = true;
    backupsLoading.value = true;
    updateOperationsLoading.value = true;

    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Generating preview...');
    expect(wrapper.text()).toContain('Loading triggers...');
    expect(wrapper.text()).toContain('Loading backups...');
    expect(wrapper.text()).toContain('Loading operation history...');

    previewLoading.value = false;
    triggersLoading.value = false;
    backupsLoading.value = false;
    updateOperationsLoading.value = false;
    await nextTick();

    expect(wrapper.text()).toContain('Run a preview to inspect the planned update operations.');
    expect(wrapper.text()).toContain('No triggers associated with this container');
    expect(wrapper.text()).toContain('No backups available yet');
    expect(wrapper.text()).toContain('No update operations recorded yet');
  });

  it('renders overview rich-state branches and wires security refresh controls', async () => {
    activeDetailTab.value = 'overview';
    selectedContainer.value = makeContainer({
      releaseLink: 'https://example.com/releases/nginx',
      includeTags: '^v',
      excludeTags: 'beta',
      transformTags: 'stable',
      triggerInclude: 'prod',
      triggerExclude: 'dev',
      registryError: 'Registry warning',
      details: {
        ports: ['80:80'],
        volumes: ['/host/data:/data'],
        env: [],
        labels: [],
      },
    });
    selectedComposePaths.value = ['/stack/compose.yml', '/stack/compose.override.yml'];
    selectedRuntimeDriftWarnings.value = ['Entrypoint differs from desired config'];
    selectedLifecycleHooks.value = {
      preUpdate: 'echo pre',
      postUpdate: 'echo post',
      timeoutLabel: '120000ms',
      preAbortBehavior: 'Abort on pre-update failure',
    };
    lifecycleHookTemplateVariables.value = [{ name: '{{name}}', description: 'Container name' }];
    vulnerabilitySummary.value = { critical: 1, high: 1, medium: 0, low: 0, unknown: 0 };
    vulnerabilityTotal.value = 2;
    vulnerabilityPreview.value = [{ id: 'CVE-2026-0001', severity: 'high' }];
    sbomDocument.value = { bomFormat: 'spdx' };
    sbomComponentCount.value = 42;
    sbomGeneratedAt.value = '2026-03-13T00:00:00Z';

    const wrapper = mountComponent();

    expect(wrapper.text()).toContain('Compose Files');
    expect(wrapper.text()).toContain('#1');
    expect(wrapper.text()).toContain('/stack/compose.yml');
    expect(wrapper.text()).toContain('Latest:');
    expect(wrapper.text()).toContain('Release notes');
    expect(wrapper.text()).toContain('Registry warning');
    expect(wrapper.text()).toContain('Entrypoint differs from desired config');
    expect(wrapper.text()).toContain('Abort on pre-update failure');
    expect(wrapper.text()).toContain('{{name}}');
    expect(wrapper.text()).toContain('CVE-2026-0001');
    expect(wrapper.text()).toContain('components:');
    expect(wrapper.text()).toContain('generated:');

    const refreshButton = wrapper
      .findAll('button')
      .find((button) => button.text().trim() === 'Refresh');
    const refreshSbomButton = wrapper
      .findAll('button')
      .find((button) => button.text().trim() === 'Refresh SBOM');
    expect(refreshButton).toBeDefined();
    expect(refreshSbomButton).toBeDefined();

    await refreshButton?.trigger('click');
    await refreshSbomButton?.trigger('click');
    expect(mockLoadDetailSecurityData).toHaveBeenCalledTimes(1);
    expect(mockLoadDetailSbom).toHaveBeenCalledTimes(1);
  });

  it('renders overview fallback, loading, and error branches', () => {
    activeDetailTab.value = 'overview';
    selectedContainer.value = makeContainer({
      newTag: undefined,
      noUpdateReason: 'No compatible tags found',
      releaseLink: '',
      details: {
        ports: [],
        volumes: [],
        env: [],
        labels: [],
      },
    });
    selectedComposePaths.value = [];
    selectedRuntimeDriftWarnings.value = [];
    selectedLifecycleHooks.value = {
      preUpdate: '',
      postUpdate: '',
      timeoutLabel: '60000ms',
      preAbortBehavior: '',
    };
    lifecycleHookTemplateVariables.value = [];
    detailVulnerabilityLoading.value = true;
    detailSbomLoading.value = true;

    const loadingWrapper = mountComponent();
    expect(loadingWrapper.text()).toContain('No ports exposed');
    expect(loadingWrapper.text()).toContain('No volumes mounted');
    expect(loadingWrapper.text()).toContain('Up to date');
    expect(loadingWrapper.text()).toContain('No compatible tags found');
    expect(loadingWrapper.text()).toContain('Not set');
    expect(loadingWrapper.text()).toContain('Loading vulnerability data...');
    expect(loadingWrapper.text()).toContain('Loading SBOM document...');

    detailVulnerabilityLoading.value = false;
    detailSbomLoading.value = false;
    detailVulnerabilityError.value = 'Vulnerability scan failed';
    detailSbomError.value = 'SBOM refresh failed';

    const errorWrapper = mountComponent();
    expect(errorWrapper.text()).toContain('Vulnerability scan failed');
    expect(errorWrapper.text()).toContain('SBOM refresh failed');
  });

  it('shows floating tag badge in overview when tag precision is floating and digest watch is disabled', () => {
    activeDetailTab.value = 'overview';
    selectedContainer.value = makeContainer({
      newTag: undefined,
      tagPrecision: 'floating',
      imageDigestWatch: false,
    });

    const wrapper = mountComponent();

    expect(wrapper.find('[data-test="floating-tag-badge"]').exists()).toBe(true);
  });

  it('hides floating tag badge in overview when tag is specific or digest watch is enabled', async () => {
    activeDetailTab.value = 'overview';
    selectedContainer.value = makeContainer({
      newTag: undefined,
      tagPrecision: 'specific',
      imageDigestWatch: false,
    });

    const wrapper = mountComponent();
    expect(wrapper.find('[data-test="floating-tag-badge"]').exists()).toBe(false);

    selectedContainer.value = makeContainer({
      newTag: undefined,
      tagPrecision: 'floating',
      imageDigestWatch: true,
    });
    await nextTick();

    expect(wrapper.find('[data-test="floating-tag-badge"]').exists()).toBe(false);
  });

  it('renders logs tab with the real-time log viewer component', () => {
    activeDetailTab.value = 'logs';
    selectedContainer.value = makeContainer({ id: 'container-99', name: 'api' });

    const wrapper = mountComponent();
    const logsStub = wrapper.find('[data-test="container-logs-stub"]');
    expect(logsStub.exists()).toBe(true);
    expect(logsStub.attributes('data-id')).toBe('container-99');
    expect(logsStub.attributes('data-name')).toBe('api');
    expect(logsStub.attributes('data-compact')).toBe('false');
  });

  it('renders environment sensitive-value reveal flows including cache and hide', async () => {
    activeDetailTab.value = 'environment';
    selectedContainer.value = makeContainer({
      details: {
        ports: [],
        volumes: ['/cache:/cache'],
        env: [
          { key: 'PATH', value: '/usr/local/bin', sensitive: false },
          { key: 'SECRET', value: '[REDACTED]', sensitive: true },
        ],
        labels: [],
      },
    });
    mockRevealContainerEnv.mockResolvedValueOnce({
      env: [{ key: 'SECRET', value: 'super-secret' }],
    });

    const wrapper = mountComponent();
    expect(wrapper.text()).toContain('/usr/local/bin');
    expect(wrapper.text()).toContain('\u2022\u2022\u2022\u2022\u2022');

    const secretRow = wrapper.findAll('.font-mono').find((node) => node.text().includes('SECRET'));
    const eyeButton = secretRow?.find('button');
    expect(eyeButton).toBeDefined();

    await eyeButton?.trigger('click');
    await flushPromises();
    await nextTick();
    expect(wrapper.text()).toContain('super-secret');
    expect(mockRevealContainerEnv).toHaveBeenCalledTimes(1);

    await eyeButton?.trigger('click');
    await nextTick();
    expect(wrapper.text()).toContain('\u2022\u2022\u2022\u2022\u2022');

    await eyeButton?.trigger('click');
    await nextTick();
    expect(wrapper.text()).toContain('super-secret');
    expect(mockRevealContainerEnv).toHaveBeenCalledTimes(1);
  });

  it('handles environment reveal fetch failure and keeps sensitive values masked', async () => {
    activeDetailTab.value = 'environment';
    selectedContainer.value = makeContainer({
      details: {
        ports: [],
        volumes: [],
        env: [{ key: 'TOKEN', value: '[REDACTED]', sensitive: true }],
        labels: [],
      },
    });
    mockRevealContainerEnv.mockRejectedValueOnce(new Error('reveal failed'));

    const wrapper = mountComponent();
    const tokenRow = wrapper.findAll('.font-mono').find((node) => node.text().includes('TOKEN'));
    const eyeButton = tokenRow?.find('button');
    expect(eyeButton).toBeDefined();

    await eyeButton?.trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.text()).toContain('\u2022\u2022\u2022\u2022\u2022');
    expect(mockRevealContainerEnv).toHaveBeenCalledTimes(1);
  });

  it('renders labels tab present and empty branches', async () => {
    activeDetailTab.value = 'labels';
    selectedContainer.value = makeContainer({
      details: {
        ports: [],
        volumes: [],
        env: [],
        labels: ['com.example.team=platform'],
      },
    });

    const wrapper = mountComponent();
    expect(wrapper.text()).toContain('com.example.team=platform');

    selectedContainer.value = makeContainer({
      details: {
        ports: [],
        volumes: [],
        env: [],
        labels: [],
      },
    });
    await nextTick();
    expect(wrapper.text()).toContain('No labels assigned');
  });

  it('renders overview single-compose and empty security/sbom fallback branches', () => {
    activeDetailTab.value = 'overview';
    selectedContainer.value = makeContainer({
      details: {
        ports: [],
        volumes: [],
        env: [],
        labels: [],
      },
    });
    selectedComposePaths.value = ['/stack/compose.yml'];
    detailVulnerabilityLoading.value = false;
    detailVulnerabilityError.value = null;
    vulnerabilityPreview.value = [];
    detailSbomLoading.value = false;
    detailSbomError.value = null;
    sbomDocument.value = null;

    const wrapper = mountComponent();
    expect(wrapper.text()).toContain('/stack/compose.yml');
    expect(wrapper.text()).not.toContain('#1');
    expect(wrapper.text()).toContain('No vulnerabilities reported for this container.');
    expect(wrapper.text()).toContain('SBOM document is not available yet.');
  });

  it('renders sbom document branch without optional component and generated fields', () => {
    activeDetailTab.value = 'overview';
    sbomDocument.value = { bomFormat: 'spdx' };
    sbomComponentCount.value = null;
    sbomGeneratedAt.value = null;

    const wrapper = mountComponent();
    expect(wrapper.text()).toContain('format:');
    expect(wrapper.text()).not.toContain('components:');
    expect(wrapper.text()).not.toContain('generated:');
  });

  it('renders environment empty-state branch when no env variables exist', () => {
    activeDetailTab.value = 'environment';
    selectedContainer.value = makeContainer({
      details: {
        ports: [],
        volumes: [],
        env: [],
        labels: [],
      },
    });

    const wrapper = mountComponent();
    expect(wrapper.text()).toContain('No environment variables configured');
  });

  it('handles reveal responses without env payload by keeping sensitive values masked', async () => {
    activeDetailTab.value = 'environment';
    selectedContainer.value = makeContainer({
      details: {
        ports: [],
        volumes: [],
        env: [{ key: 'SECRET', value: '[REDACTED]', sensitive: true }],
        labels: [],
      },
    });
    mockRevealContainerEnv.mockResolvedValueOnce({});

    const wrapper = mountComponent();
    const secretRow = wrapper.findAll('.font-mono').find((node) => node.text().includes('SECRET'));
    const eyeButton = secretRow?.find('button');
    expect(eyeButton).toBeDefined();

    await eyeButton?.trigger('click');
    await flushPromises();
    await nextTick();

    expect(wrapper.text()).toContain('\u2022\u2022\u2022\u2022\u2022');
    expect(mockRevealContainerEnv).toHaveBeenCalledTimes(1);
  });

  it('updates select and input models for sbom, snooze date, and maturity mode controls', async () => {
    activeDetailTab.value = 'overview';
    const wrapper = mountComponent();

    const sbomSelect = wrapper
      .findAll('select')
      .find((select) => select.find('option[value="cyclonedx-json"]').exists());
    expect(sbomSelect).toBeDefined();
    await sbomSelect?.setValue('cyclonedx-json');
    expect(selectedSbomFormat.value).toBe('cyclonedx-json');

    activeDetailTab.value = 'actions';
    await nextTick();
    const snoozeInput = wrapper.find('input[type="date"]');
    expect(snoozeInput.exists()).toBe(true);
    await snoozeInput.setValue('2026-03-22');
    expect(snoozeDateInput.value).toBe('2026-03-22');

    const maturitySelect = wrapper
      .findAll('select')
      .find((select) => select.find('option[value="mature"]').exists());
    expect(maturitySelect).toBeDefined();
    await maturitySelect?.setValue('mature');
    expect(maturityModeInput.value).toBe('mature');
  });
});
