import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { computed, defineComponent, h, nextTick, type Ref, ref } from 'vue';
import type { ApiContainerTrigger } from '@/types/api';
import type { Container } from '@/types/container';
import { daysToMs } from '@/utils/maturity-policy';
import {
  ACTION_TAB_DETAIL_REFRESH_DEBOUNCE_MS,
  PENDING_ACTIONS_POLL_INTERVAL_MS,
  useContainerActions,
} from '@/views/containers/useContainerActions';

const mocks = vi.hoisted(() => ({
  confirmRequire: vi.fn(),
  getBackups: vi.fn(),
  rollback: vi.fn(),
  deleteContainer: vi.fn(),
  scanContainer: vi.fn(),
  getContainerUpdateOperations: vi.fn(),
  getContainerTriggers: vi.fn(),
  runTrigger: vi.fn(),
  updateContainerPolicy: vi.fn(),
  restartContainer: vi.fn(),
  startContainer: vi.fn(),
  stopContainer: vi.fn(),
  updateContainer: vi.fn(),
  previewContainer: vi.fn(),
  containerActionsEnabled: { value: true },
  loadServerFeatures: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({
    require: mocks.confirmRequire,
  }),
}));

vi.mock('@/services/backup', () => ({
  getBackups: mocks.getBackups,
  rollback: mocks.rollback,
}));

vi.mock('@/services/container', () => ({
  deleteContainer: mocks.deleteContainer,
  scanContainer: mocks.scanContainer,
  getContainerUpdateOperations: mocks.getContainerUpdateOperations,
  getContainerTriggers: mocks.getContainerTriggers,
  runTrigger: mocks.runTrigger,
  updateContainerPolicy: mocks.updateContainerPolicy,
}));

vi.mock('@/services/container-actions', () => ({
  restartContainer: mocks.restartContainer,
  startContainer: mocks.startContainer,
  stopContainer: mocks.stopContainer,
  updateContainer: mocks.updateContainer,
}));

vi.mock('@/services/preview', () => ({
  previewContainer: mocks.previewContainer,
}));

vi.mock('@/composables/useServerFeatures', () => ({
  useServerFeatures: () => ({
    featureFlags: computed(() => ({
      containeractions: mocks.containerActionsEnabled.value,
    })),
    containerActionsEnabled: computed(() => mocks.containerActionsEnabled.value),
    containerActionsDisabledReason: computed(
      () => 'Container actions disabled by server configuration',
    ),
    deleteEnabled: computed(() => true),
    loaded: computed(() => true),
    loading: computed(() => false),
    error: computed(() => null),
    loadServerFeatures: mocks.loadServerFeatures,
    isFeatureEnabled: (name: string) =>
      name.toLowerCase() === 'containeractions' ? mocks.containerActionsEnabled.value : false,
  }),
}));

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'container-1',
    name: 'web',
    image: 'nginx',
    icon: 'docker',
    currentTag: '1.0.0',
    newTag: null,
    status: 'running',
    registry: 'dockerhub',
    updateKind: null,
    updateMaturity: null,
    bouncer: 'safe',
    server: 'Local',
    details: { ports: [], volumes: [], env: [], labels: [] },
    ...overrides,
  };
}

const mountedWrappers: VueWrapper[] = [];

interface ActionsHarnessState {
  activeDetailTab: Ref<string>;
  closeFullPage: ReturnType<typeof vi.fn>;
  closePanel: ReturnType<typeof vi.fn>;
  containerIdMap: Ref<Record<string, string>>;
  containerMetaMap: Ref<Record<string, unknown>>;
  containers: Ref<Container[]>;
  error: Ref<string | null>;
  loadContainers: ReturnType<typeof vi.fn>;
  selectedContainer: Ref<Container | null>;
  selectedContainerId: Ref<string | undefined>;
  composable: ReturnType<typeof useContainerActions>;
}

async function mountActionsHarness(
  options: {
    activeDetailTab?: string;
    containerIdMap?: Record<string, string>;
    containerMetaMap?: Record<string, unknown>;
    containers?: Container[];
    selectedContainer?: Container | null;
    selectedContainerId?: string;
  } = {},
) {
  let state: ActionsHarnessState | undefined;

  const Harness = defineComponent({
    setup() {
      const activeDetailTab = ref(options.activeDetailTab ?? 'overview');
      const closeFullPage = vi.fn();
      const closePanel = vi.fn();
      const containerIdMap = ref(options.containerIdMap ?? {});
      const containerMetaMap = ref(options.containerMetaMap ?? {});
      const containers = ref(options.containers ?? []);
      const error = ref<string | null>(null);
      const loadContainers = vi.fn().mockResolvedValue(undefined);
      const selectedContainer = ref(options.selectedContainer ?? null);
      const selectedContainerId = ref(
        options.selectedContainerId ?? options.selectedContainer?.id ?? undefined,
      );
      const composable = useContainerActions({
        activeDetailTab,
        closeFullPage,
        closePanel,
        containerIdMap,
        containerMetaMap,
        containers,
        error,
        loadContainers,
        selectedContainer,
        selectedContainerId,
      });
      state = {
        activeDetailTab,
        closeFullPage,
        closePanel,
        containerIdMap,
        containerMetaMap,
        containers,
        error,
        loadContainers,
        selectedContainer,
        selectedContainerId,
        composable,
      };
      return () => h('div');
    },
  });

  const wrapper = mount(Harness);
  mountedWrappers.push(wrapper);
  await flushPromises();

  if (!state) {
    throw new Error('Actions harness did not initialize');
  }

  return state;
}

describe('useContainerActions', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
    mocks.containerActionsEnabled.value = true;
    mocks.getBackups.mockResolvedValue([]);
    mocks.rollback.mockResolvedValue({});
    mocks.deleteContainer.mockResolvedValue({});
    mocks.scanContainer.mockResolvedValue({});
    mocks.getContainerUpdateOperations.mockResolvedValue([]);
    mocks.getContainerTriggers.mockResolvedValue([]);
    mocks.runTrigger.mockResolvedValue({});
    mocks.updateContainerPolicy.mockResolvedValue({});
    mocks.restartContainer.mockResolvedValue({});
    mocks.startContainer.mockResolvedValue({});
    mocks.stopContainer.mockResolvedValue({});
    mocks.updateContainer.mockResolvedValue({});
    mocks.previewContainer.mockResolvedValue({});
  });

  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    vi.useRealTimers();
  });

  it('runs associated trigger and refreshes action-tab data', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, loadContainers } = await mountActionsHarness({
      activeDetailTab: 'actions',
      selectedContainer: container,
      selectedContainerId: container.id,
    });
    mocks.getContainerTriggers.mockClear();
    mocks.getBackups.mockClear();
    mocks.getContainerUpdateOperations.mockClear();
    loadContainers.mockClear();

    const trigger: ApiContainerTrigger = {
      type: 'slack',
      name: 'notify',
      agent: 'agent-1',
    };
    await composable.runAssociatedTrigger(trigger);

    expect(mocks.runTrigger).toHaveBeenCalledWith({
      containerId: 'container-1',
      triggerType: 'slack',
      triggerName: 'notify',
      triggerAgent: 'agent-1',
    });
    expect(composable.triggerMessage.value).toBe('Trigger agent-1.slack.notify ran successfully');
    expect(composable.triggerError.value).toBeNull();
    expect(loadContainers).toHaveBeenCalledTimes(1);
    expect(mocks.getContainerTriggers).toHaveBeenCalledTimes(1);
    expect(mocks.getBackups).toHaveBeenCalledTimes(1);
    expect(mocks.getContainerUpdateOperations).toHaveBeenCalledTimes(1);
    expect(composable.triggerRunInProgress.value).toBeNull();
  });

  it('guards trigger execution without a selected id and reports trigger run failures', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, selectedContainerId } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: '',
    });
    const trigger: ApiContainerTrigger = {
      type: 'slack',
      name: 'notify',
      agent: undefined,
    };

    await composable.runAssociatedTrigger(trigger);
    expect(mocks.runTrigger).not.toHaveBeenCalled();

    selectedContainerId.value = 'container-1';
    mocks.runTrigger.mockRejectedValueOnce(new Error('trigger failed'));
    await composable.runAssociatedTrigger(trigger);
    expect(composable.triggerError.value).toBe('trigger failed');
  });

  it('rolls back to a selected backup and refreshes backup/update operation lists', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, loadContainers } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
    });
    composable.skippedUpdates.value.add('web');
    mocks.getBackups.mockClear();
    mocks.getContainerUpdateOperations.mockClear();
    loadContainers.mockClear();

    await composable.rollbackToBackup('backup-1');

    expect(mocks.rollback).toHaveBeenCalledWith('container-1', 'backup-1');
    expect(composable.rollbackMessage.value).toBe('Rollback completed from selected backup');
    expect(composable.skippedUpdates.value.has('web')).toBe(false);
    expect(loadContainers).toHaveBeenCalledTimes(1);
    expect(mocks.getBackups).toHaveBeenCalledTimes(1);
    expect(mocks.getContainerUpdateOperations).toHaveBeenCalledTimes(1);
  });

  it('updates skip policy for selected container and tracks skipped updates', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, loadContainers } = await mountActionsHarness({
      activeDetailTab: 'actions',
      selectedContainer: container,
      selectedContainerId: container.id,
      containerIdMap: { web: 'container-1' },
    });
    mocks.getContainerTriggers.mockClear();
    mocks.getBackups.mockClear();
    mocks.getContainerUpdateOperations.mockClear();
    loadContainers.mockClear();

    await composable.skipCurrentForSelected();

    expect(mocks.updateContainerPolicy).toHaveBeenCalledWith('container-1', 'skip-current', {});
    expect(composable.policyMessage.value).toBe('Skipped current update for web');
    expect(composable.skippedUpdates.value.has('web')).toBe(true);
    expect(loadContainers).toHaveBeenCalledTimes(1);
    expect(mocks.getContainerTriggers).toHaveBeenCalledTimes(1);
    expect(mocks.getBackups).toHaveBeenCalledTimes(1);
    expect(mocks.getContainerUpdateOperations).toHaveBeenCalledTimes(1);
  });

  it('runs direct update/scan actions and guards unmapped containers', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
      containerIdMap: { web: 'container-1' },
    });

    await composable.updateContainer('web');
    await composable.scanContainer('web');

    expect(mocks.updateContainer).toHaveBeenCalledWith('container-1');
    expect(mocks.scanContainer).toHaveBeenCalledWith('container-1');

    mocks.updateContainer.mockClear();
    mocks.scanContainer.mockClear();
    await composable.updateContainer('api');
    await composable.scanContainer('api');
    expect(mocks.updateContainer).not.toHaveBeenCalled();
    expect(mocks.scanContainer).not.toHaveBeenCalled();
  });

  it('validates snooze-until input before policy updates', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
      containerIdMap: { web: 'container-1' },
    });

    composable.snoozeDateInput.value = '2026/03/05';
    await composable.snoozeSelectedUntilDate();

    expect(composable.policyError.value).toBe('Select a valid snooze date');
    expect(mocks.updateContainerPolicy).not.toHaveBeenCalled();
  });

  it('applies snooze-until policy when date input is valid', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
      containerIdMap: { web: 'container-1' },
    });

    composable.snoozeDateInput.value = '2026-03-15';
    await composable.snoozeSelectedUntilDate();

    expect(mocks.updateContainerPolicy).toHaveBeenCalledWith(
      'container-1',
      'snooze',
      expect.objectContaining({ snoozeUntil: expect.any(String) }),
    );
  });

  it('applies and clears maturity policy actions with defaults and validation', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
      containerIdMap: { web: 'container-1' },
    });

    await composable.setMaturityPolicySelected('mature');
    expect(mocks.updateContainerPolicy).toHaveBeenNthCalledWith(
      1,
      'container-1',
      'set-maturity-policy',
      {
        mode: 'mature',
        minAgeDays: 7,
      },
    );

    composable.maturityMinAgeDaysInput.value = 21;
    await composable.setMaturityPolicySelected('all');
    expect(mocks.updateContainerPolicy).toHaveBeenNthCalledWith(
      2,
      'container-1',
      'set-maturity-policy',
      {
        mode: 'all',
        minAgeDays: 21,
      },
    );

    await composable.clearMaturityPolicySelected();
    expect(mocks.updateContainerPolicy).toHaveBeenNthCalledWith(
      3,
      'container-1',
      'clear-maturity-policy',
      {},
    );

    composable.maturityMinAgeDaysInput.value = 1;
    await composable.setMaturityPolicySelected('mature');
    expect(mocks.updateContainerPolicy).toHaveBeenNthCalledWith(
      4,
      'container-1',
      'set-maturity-policy',
      {
        mode: 'mature',
        minAgeDays: 1,
      },
    );

    composable.maturityMinAgeDaysInput.value = 0;
    await composable.setMaturityPolicySelected('mature');
    expect(composable.policyError.value).toBe('Enter a maturity age between 1 and 365 days');
    expect(mocks.updateContainerPolicy).toHaveBeenCalledTimes(4);
  });

  it('deletes selected container and closes detail views', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, closeFullPage, closePanel, loadContainers } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
      containerIdMap: { web: 'container-1' },
    });

    composable.confirmDelete('web');
    expect(mocks.confirmRequire).toHaveBeenCalledWith(
      expect.objectContaining({
        header: 'Delete Container',
        acceptLabel: 'Delete',
      }),
    );
    const confirmOptions = mocks.confirmRequire.mock.calls[0][0] as { accept?: () => unknown };
    const result = await confirmOptions.accept?.();

    expect(result).toBe(true);
    expect(mocks.deleteContainer).toHaveBeenCalledWith('container-1');
    expect(closeFullPage).toHaveBeenCalledTimes(1);
    expect(closePanel).toHaveBeenCalledTimes(1);
    expect(loadContainers).toHaveBeenCalledTimes(1);
  });

  it('updates all eligible containers in a group and reloads once after the batch', async () => {
    const c1 = makeContainer({ id: 'container-1', name: 'web', newTag: '1.1.0', bouncer: 'safe' });
    const c2 = makeContainer({
      id: 'container-2',
      name: 'api',
      newTag: '2.0.0',
      bouncer: 'safe',
    });
    const c3 = makeContainer({
      id: 'container-3',
      name: 'worker',
      newTag: '2.0.0',
      bouncer: 'blocked',
    });
    const c4 = makeContainer({ id: 'container-4', name: 'cron', newTag: null, bouncer: 'safe' });

    const { composable, loadContainers } = await mountActionsHarness({
      containers: [c1, c2, c3, c4],
      containerIdMap: {
        web: 'container-1',
        api: 'container-2',
        worker: 'container-3',
        cron: 'container-4',
      },
    });
    loadContainers.mockClear();

    await composable.updateAllInGroup({
      key: 'group-1',
      containers: [c1, c2, c3, c4],
    });

    expect(mocks.updateContainer).toHaveBeenCalledTimes(2);
    expect(mocks.updateContainer).toHaveBeenNthCalledWith(1, 'container-1');
    expect(mocks.updateContainer).toHaveBeenNthCalledWith(2, 'container-2');
    expect(loadContainers).toHaveBeenCalledTimes(1);
    expect(composable.groupUpdateInProgress.value.has('group-1')).toBe(false);
  });

  it('does not reload grouped containers when every update action fails', async () => {
    const c1 = makeContainer({ id: 'container-1', name: 'web', newTag: '1.1.0', bouncer: 'safe' });
    const c2 = makeContainer({
      id: 'container-2',
      name: 'api',
      newTag: '2.0.0',
      bouncer: 'safe',
    });
    const { composable, loadContainers } = await mountActionsHarness({
      containers: [c1, c2],
      containerIdMap: {
        web: 'container-1',
        api: 'container-2',
      },
    });
    mocks.updateContainer.mockRejectedValue(new Error('update failed'));
    loadContainers.mockClear();

    await composable.updateAllInGroup({
      key: 'group-1',
      containers: [c1, c2],
    });

    expect(mocks.updateContainer).toHaveBeenCalledTimes(2);
    expect(loadContainers).not.toHaveBeenCalled();
    expect(composable.groupUpdateInProgress.value.has('group-1')).toBe(false);
  });

  it('tracks pending actions and polls until container reappears', async () => {
    vi.useFakeTimers();
    const web = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, containers, loadContainers } = await mountActionsHarness({
      containers: [web],
      containerIdMap: { web: 'container-1' },
    });
    let loadCallCount = 0;
    loadContainers.mockImplementation(async () => {
      loadCallCount += 1;
      containers.value = loadCallCount === 1 ? [] : [web];
    });

    await composable.startContainer('web');
    expect(composable.actionPending.value.has('web')).toBe(true);

    vi.advanceTimersByTime(PENDING_ACTIONS_POLL_INTERVAL_MS);
    await flushPromises();

    expect(loadContainers).toHaveBeenCalledTimes(2);
    expect(composable.actionPending.value.has('web')).toBe(false);

    vi.advanceTimersByTime(PENDING_ACTIONS_POLL_INTERVAL_MS * 2);
    await flushPromises();
    expect(loadContainers).toHaveBeenCalledTimes(2);
  });

  it('reuses existing pending start timestamps when the same action is queued again', async () => {
    vi.useFakeTimers();
    const web = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, containers, loadContainers } = await mountActionsHarness({
      containers: [web],
      containerIdMap: { web: 'container-1' },
    });
    const dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    loadContainers.mockImplementation(async () => {
      containers.value = [];
    });

    await composable.startContainer('web');
    expect(composable.actionPending.value.has('web')).toBe(true);
    expect(dateNowSpy).toHaveBeenCalledTimes(1);

    containers.value = [web];
    await composable.startContainer('web');
    expect(dateNowSpy).toHaveBeenCalledTimes(1);

    dateNowSpy.mockRestore();
  });

  it('returns false when an action fails and clears in-progress state', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    mocks.startContainer.mockRejectedValueOnce(new Error('start failed'));

    const { composable, error } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
      containerIdMap: { web: 'container-1' },
    });

    await composable.startContainer('web');

    expect(composable.actionInProgress.value).toBeNull();
    expect(error.value).toBe('start failed');

    // subsequent successful action clears the error
    mocks.startContainer.mockResolvedValueOnce({ message: 'ok' });
    await composable.startContainer('web');
    expect(error.value).toBeNull();
  });

  it('builds skipped-policy tooltip fallback and pluralized variants', async () => {
    const now = Date.now();
    const { composable } = await mountActionsHarness({
      containerMetaMap: {
        web: {
          updatePolicy: {
            skipTags: [],
            skipDigests: ['sha256:1', 'sha256:2'],
          },
        },
        api: {
          updatePolicy: {
            skipTags: [],
            skipDigests: [],
            snoozeUntil: new Date(now + 60_000).toISOString(),
          },
        },
      },
    });

    expect(composable.containerPolicyTooltip('web', 'skipped')).toBe(
      'Skipped updates policy active (2 entries)',
    );
    expect(composable.containerPolicyTooltip('web', 'snoozed')).toBe('Updates snoozed');
    expect(composable.containerPolicyTooltip('api', 'skipped')).toBe(
      'Skipped updates policy active',
    );
    expect(composable.containerPolicyTooltip('api', 'snoozed')).toContain('Updates snoozed until');
  });

  it('derives maturity list-policy state and tooltip', async () => {
    const now = Date.now();
    const { composable } = await mountActionsHarness({
      containerMetaMap: {
        web: {
          updateAvailable: false,
          updateDetectedAt: new Date(now - daysToMs(2)).toISOString(),
          updateKind: {
            kind: 'tag',
            remoteValue: '2.0.0',
          },
          updatePolicy: {
            maturityMode: 'mature',
            maturityMinAgeDays: 7,
          },
        },
        api: {
          updateAvailable: false,
          updateDetectedAt: new Date(now - daysToMs(10)).toISOString(),
          updateKind: {
            kind: 'tag',
            remoteValue: '5.0.0',
          },
          updatePolicy: {
            maturityMode: 'mature',
            maturityMinAgeDays: 7,
          },
        },
      },
    });

    expect(composable.getContainerListPolicyState('web')).toMatchObject({
      maturityMode: 'mature',
      maturityMinAgeDays: 7,
      maturityBlocked: true,
    });
    expect(composable.getContainerListPolicyState('api')).toMatchObject({
      maturityMode: 'mature',
      maturityMinAgeDays: 7,
      maturityBlocked: false,
    });
    expect(composable.containerPolicyTooltip('web', 'maturity')).toContain('Mature-only policy');
    expect(composable.containerPolicyTooltip('api', 'maturity')).toBe(
      'Mature-only policy active (7 days minimum age)',
    );
  });

  it('normalizes unknown maturity mode strings and falls back to generic maturity tooltip text', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
      containerMetaMap: {
        web: {
          updatePolicy: {
            maturityMode: '  experimental  ',
            skipTags: [],
            skipDigests: [],
          },
        },
      },
    });

    expect(composable.selectedMaturityMode.value).toBeUndefined();
    expect(composable.selectedHasMaturityPolicy.value).toBe(false);
    expect(composable.getContainerListPolicyState('web')).toEqual({
      snoozed: false,
      skipped: false,
      skipCount: 0,
      maturityBlocked: false,
    });
    expect(composable.containerPolicyTooltip('web', 'maturity')).toBe('Maturity policy active');
  });

  it('memoizes list policy state for repeated row reads', async () => {
    const dateNowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValue(Date.parse('2026-03-15T12:00:00.000Z'));
    try {
      const { composable } = await mountActionsHarness({
        containerMetaMap: {
          web: {
            updateAvailable: false,
            updateDetectedAt: '2026-03-14T12:00:00.000Z',
            updateKind: {
              kind: 'tag',
              remoteValue: '2.0.0',
            },
            updatePolicy: {
              maturityMode: 'mature',
              maturityMinAgeDays: 7,
              snoozeUntil: '2026-03-16T00:00:00.000Z',
            },
          },
        },
      });

      dateNowSpy.mockClear();

      const firstState = composable.getContainerListPolicyState('web');
      const secondState = composable.getContainerListPolicyState('web');
      const maturityTooltip = composable.containerPolicyTooltip('web', 'maturity');
      const snoozeTooltip = composable.containerPolicyTooltip('web', 'snoozed');

      expect(firstState).toBe(secondState);
      expect(maturityTooltip).toContain('Mature-only policy');
      expect(snoozeTooltip).toContain('Updates snoozed until');
      expect(dateNowSpy).toHaveBeenCalledTimes(2);
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('guards selected skip policy arrays and returns values when arrays are present', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, containerMetaMap } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
      containerMetaMap: {
        web: {
          updatePolicy: {
            skipTags: 'stable',
            skipDigests: null,
          },
        },
      },
    });

    expect(composable.selectedSkipTags.value).toEqual([]);
    expect(composable.selectedSkipDigests.value).toEqual([]);

    containerMetaMap.value = {
      web: {
        updatePolicy: {
          skipTags: ['stable'],
          skipDigests: ['sha256:1'],
        },
      },
    };
    await nextTick();

    expect(composable.selectedSkipTags.value).toEqual(['stable']);
    expect(composable.selectedSkipDigests.value).toEqual(['sha256:1']);
  });

  it('handles invalid detected-at timestamps and the allow-all maturity tooltip branch', async () => {
    const { composable } = await mountActionsHarness({
      containerMetaMap: {
        web: {
          updateAvailable: false,
          updateDetectedAt: 'not-a-date',
          updateKind: {
            kind: 'tag',
            remoteValue: '2.0.0',
          },
          updatePolicy: {
            maturityMode: 'mature',
            maturityMinAgeDays: 7,
          },
        },
        api: {
          updatePolicy: {
            maturityMode: 'all',
            maturityMinAgeDays: 14,
          },
        },
      },
    });

    expect(composable.getContainerListPolicyState('web')).toMatchObject({
      maturityMode: 'mature',
      maturityMinAgeDays: 7,
      maturityBlocked: true,
    });
    expect(composable.getContainerListPolicyState('web')).not.toHaveProperty('updateDetectedAt');
    expect(composable.containerPolicyTooltip('api', 'maturity')).toBe(
      'Maturity policy allows all updates',
    );
  });

  it('preserves detected-at metadata when list policy has skips but no maturity mode', async () => {
    const detectedAt = '2026-03-14T12:00:00.000Z';
    const { composable } = await mountActionsHarness({
      containerMetaMap: {
        web: {
          updateAvailable: false,
          updateDetectedAt: detectedAt,
          updateKind: {
            kind: 'tag',
            remoteValue: '2.0.0',
          },
          updatePolicy: {
            skipTags: ['stable'],
          },
        },
      },
    });

    expect(composable.getContainerListPolicyState('web')).toMatchObject({
      skipped: true,
      skipCount: 1,
      updateDetectedAt: detectedAt,
      maturityBlocked: false,
    });
    expect(composable.getContainerListPolicyState('web')).not.toHaveProperty('maturityMode');
  });

  it('uses singular maturity and skipped tooltip wording when min age and skip count are one', async () => {
    const now = Date.now();
    const { composable } = await mountActionsHarness({
      containerMetaMap: {
        web: {
          updateAvailable: false,
          updateDetectedAt: new Date(now - 12 * 60 * 60 * 1000).toISOString(),
          updateKind: {
            kind: 'digest',
            remoteValue: 'sha256:new',
          },
          updatePolicy: {
            maturityMode: 'mature',
            maturityMinAgeDays: 1,
            skipTags: [],
            skipDigests: ['sha256:old'],
          },
        },
        api: {
          updateAvailable: false,
          updateDetectedAt: new Date(now - daysToMs(2)).toISOString(),
          updateKind: {
            kind: 'digest',
            remoteValue: 'sha256:newer',
          },
          updatePolicy: {
            maturityMode: 'mature',
            maturityMinAgeDays: 1,
          },
        },
      },
    });

    expect(composable.containerPolicyTooltip('web', 'maturity')).toBe(
      'Mature-only policy blocks updates younger than 1 day',
    );
    expect(composable.containerPolicyTooltip('api', 'maturity')).toBe(
      'Mature-only policy active (1 day minimum age)',
    );
    expect(composable.containerPolicyTooltip('web', 'skipped')).toBe(
      'Skipped updates policy active (1 entry)',
    );
  });

  it('wires confirm stop/restart/force-update dialogs to their accept handlers', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
      containerIdMap: { web: 'container-1' },
    });

    composable.confirmStop('web');
    composable.confirmRestart('web');
    composable.confirmForceUpdate('web');

    expect(mocks.confirmRequire).toHaveBeenCalledTimes(3);
    const [stopCall, restartCall, forceCall] = mocks.confirmRequire.mock.calls.map(
      (call) => call[0] as { header: string; accept?: () => Promise<unknown> },
    );

    expect(stopCall.header).toBe('Stop Container');
    expect(restartCall.header).toBe('Restart Container');
    expect(forceCall.header).toBe('Force Update');

    await stopCall.accept?.();
    await restartCall.accept?.();
    await forceCall.accept?.();

    expect(mocks.stopContainer).toHaveBeenCalledWith('container-1');
    expect(mocks.restartContainer).toHaveBeenCalledWith('container-1');
    expect(mocks.updateContainerPolicy).toHaveBeenCalledWith('container-1', 'clear', {});
    expect(mocks.updateContainer).toHaveBeenCalledWith('container-1');
  });

  it('wires update confirmation dialog to update accept handler', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web', newTag: '1.1.0' });
    const { composable } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
      containerIdMap: { web: 'container-1' },
    });

    composable.confirmUpdate('web');

    expect(mocks.confirmRequire).toHaveBeenCalledTimes(1);
    const confirmCall = mocks.confirmRequire.mock.calls[0][0] as {
      header: string;
      acceptLabel: string;
      accept?: () => Promise<unknown>;
    };
    expect(confirmCall.header).toBe('Update Container');
    expect(confirmCall.acceptLabel).toBe('Update');

    await confirmCall.accept?.();
    expect(mocks.updateContainer).toHaveBeenCalledWith('container-1');
  });

  it('wires rollback confirmation dialog to rollback accept handler', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
      containerIdMap: { web: 'container-1' },
    });

    composable.confirmRollback('backup-1');

    expect(mocks.confirmRequire).toHaveBeenCalledTimes(1);
    const confirmCall = mocks.confirmRequire.mock.calls[0][0] as {
      header: string;
      accept?: () => Promise<unknown>;
    };
    expect(confirmCall.header).toBe('Rollback Container');

    await confirmCall.accept?.();
    expect(mocks.rollback).toHaveBeenCalledWith('container-1', 'backup-1');
  });

  it('uses latest-backup messaging when rollback confirmation has no explicit backup id', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
      containerIdMap: { web: 'container-1' },
    });

    composable.confirmRollback();

    expect(mocks.confirmRequire).toHaveBeenCalledTimes(1);
    const confirmCall = mocks.confirmRequire.mock.calls[0][0] as { message: string };
    expect(confirmCall.message).toContain('latest backup image');
  });

  it('does not open rollback confirmation when no container is selected', async () => {
    const { composable } = await mountActionsHarness({
      selectedContainer: null,
      selectedContainerId: undefined,
    });

    composable.confirmRollback('backup-1');

    expect(mocks.confirmRequire).not.toHaveBeenCalled();
  });

  it('covers helper formatting and status-style branches', async () => {
    const { composable } = await mountActionsHarness();

    expect(composable.formatTimestamp(undefined)).toBe('Unknown');
    expect(composable.formatTimestamp('invalid-date')).toBe('invalid-date');
    expect(composable.formatOperationPhase(42)).toBe('unknown');
    expect(composable.formatOperationStatus('  IN_PROGRESS  ')).toBe('in progress');
    expect(composable.formatRollbackReason('ROLLED-BACK')).toBe('rolled back');
    expect(composable.getOperationStatusStyle('succeeded')).toEqual({
      backgroundColor: 'var(--dd-success-muted)',
      color: 'var(--dd-success)',
    });
    expect(composable.getOperationStatusStyle('rolled-back')).toEqual({
      backgroundColor: 'var(--dd-warning-muted)',
      color: 'var(--dd-warning)',
    });
    expect(composable.getOperationStatusStyle('failed')).toEqual({
      backgroundColor: 'var(--dd-danger-muted)',
      color: 'var(--dd-danger)',
    });
    expect(composable.getOperationStatusStyle('queued')).toEqual({
      backgroundColor: 'var(--dd-info-muted)',
      color: 'var(--dd-info)',
    });
    expect(composable.getOperationStatusStyle(undefined)).toEqual({
      backgroundColor: 'var(--dd-info-muted)',
      color: 'var(--dd-info)',
    });
    expect(
      composable.getTriggerKey({
        id: 'trigger-id',
        type: 'slack',
        name: 'notify',
      } as ApiContainerTrigger),
    ).toBe('trigger-id');
    expect(
      composable.getTriggerKey({
        type: 'slack',
        name: 'notify',
      } as ApiContainerTrigger),
    ).toBe('slack.notify');
  });

  it('handles action-tab detail load guards and API failures', async () => {
    vi.useFakeTimers();
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, activeDetailTab, selectedContainerId } = await mountActionsHarness({
      activeDetailTab: 'actions',
      selectedContainer: container,
      selectedContainerId: '',
    });
    await flushPromises();

    expect(composable.detailTriggers.value).toEqual([]);
    expect(composable.detailBackups.value).toEqual([]);
    expect(composable.detailUpdateOperations.value).toEqual([]);
    expect(composable.updateOperationsError.value).toBeNull();

    mocks.getContainerTriggers.mockRejectedValueOnce(new Error('trigger load failed'));
    mocks.getBackups.mockRejectedValueOnce(new Error('backup load failed'));
    mocks.getContainerUpdateOperations.mockRejectedValueOnce(new Error('ops load failed'));

    selectedContainerId.value = 'container-1';
    activeDetailTab.value = 'overview';
    await nextTick();
    activeDetailTab.value = 'actions';
    await nextTick();
    vi.advanceTimersByTime(ACTION_TAB_DETAIL_REFRESH_DEBOUNCE_MS);
    await flushPromises();

    expect(composable.triggerError.value).toBe('trigger load failed');
    expect(composable.rollbackError.value).toBe('backup load failed');
    expect(composable.updateOperationsError.value).toBe('ops load failed');
  });

  it('clears action-tab detail data when refresh runs without a selected container id', async () => {
    vi.useFakeTimers();
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, activeDetailTab, selectedContainerId } = await mountActionsHarness({
      activeDetailTab: 'overview',
      selectedContainer: container,
      selectedContainerId: container.id,
    });

    composable.detailBackups.value = [{ id: 'stale-backup' }];
    composable.detailUpdateOperations.value = [{ id: 'stale-operation' }];
    composable.updateOperationsError.value = 'stale error';
    mocks.getContainerTriggers.mockClear();
    mocks.getBackups.mockClear();
    mocks.getContainerUpdateOperations.mockClear();

    selectedContainerId.value = '';
    activeDetailTab.value = 'actions';
    await nextTick();
    vi.advanceTimersByTime(ACTION_TAB_DETAIL_REFRESH_DEBOUNCE_MS);
    await flushPromises();

    expect(mocks.getContainerTriggers).not.toHaveBeenCalled();
    expect(mocks.getBackups).not.toHaveBeenCalled();
    expect(mocks.getContainerUpdateOperations).not.toHaveBeenCalled();
    expect(composable.detailBackups.value).toEqual([]);
    expect(composable.detailUpdateOperations.value).toEqual([]);
    expect(composable.updateOperationsError.value).toBeNull();
  });

  it('debounces rapid action-tab detail refresh triggers into one API batch', async () => {
    vi.useFakeTimers();
    const web = makeContainer({ id: 'container-1', name: 'web' });
    const api = makeContainer({ id: 'container-2', name: 'api' });
    const { activeDetailTab, selectedContainer, selectedContainerId } = await mountActionsHarness({
      activeDetailTab: 'overview',
      selectedContainer: web,
      selectedContainerId: web.id,
    });

    mocks.getContainerTriggers.mockClear();
    mocks.getBackups.mockClear();
    mocks.getContainerUpdateOperations.mockClear();

    activeDetailTab.value = 'actions';
    await nextTick();
    selectedContainer.value = api;
    selectedContainerId.value = api.id;
    await nextTick();
    selectedContainer.value = web;
    selectedContainerId.value = web.id;
    await nextTick();

    expect(mocks.getContainerTriggers).not.toHaveBeenCalled();
    expect(mocks.getBackups).not.toHaveBeenCalled();
    expect(mocks.getContainerUpdateOperations).not.toHaveBeenCalled();

    vi.advanceTimersByTime(ACTION_TAB_DETAIL_REFRESH_DEBOUNCE_MS);
    await flushPromises();

    expect(mocks.getContainerTriggers).toHaveBeenCalledTimes(1);
    expect(mocks.getBackups).toHaveBeenCalledTimes(1);
    expect(mocks.getContainerUpdateOperations).toHaveBeenCalledTimes(1);
    expect(mocks.getContainerTriggers).toHaveBeenCalledWith('container-1');
    expect(mocks.getBackups).toHaveBeenCalledWith('container-1');
    expect(mocks.getContainerUpdateOperations).toHaveBeenCalledWith('container-1');
  });

  it('handles preview guard, success, and failure flows', async () => {
    const { composable, selectedContainerId } = await mountActionsHarness({
      selectedContainer: null,
      selectedContainerId: undefined,
    });

    composable.previewLoading.value = true;
    await composable.runContainerPreview();
    expect(mocks.previewContainer).not.toHaveBeenCalled();

    composable.previewLoading.value = false;
    await composable.runContainerPreview();
    expect(mocks.previewContainer).not.toHaveBeenCalled();

    selectedContainerId.value = 'container-1';
    mocks.previewContainer.mockResolvedValueOnce({
      dryRun: true,
      currentImage: 'nginx:1.0',
      compose: {
        files: ['   '],
        service: '   ',
        writableFile: '   ',
        patch: '   ',
      },
    });
    await composable.runContainerPreview();
    expect(composable.detailComposePreview.value).toBeNull();

    mocks.previewContainer.mockResolvedValueOnce({
      dryRun: true,
      currentImage: 'nginx:1.0',
      compose: {
        files: { unexpected: true },
        writableFile: ' /opt/stack/compose.yml ',
        willWrite: true,
        patch: '   ',
      },
    });
    await composable.runContainerPreview();
    expect(composable.detailComposePreview.value).toEqual({
      files: [],
      writableFile: '/opt/stack/compose.yml',
      willWrite: true,
    });

    mocks.previewContainer.mockResolvedValueOnce({
      dryRun: true,
      currentImage: 'nginx:1.0',
      compose: {
        files: ['/opt/stack/compose.yml'],
        service: 'web',
      },
    });
    await composable.runContainerPreview();
    expect(composable.detailComposePreview.value).toEqual({
      files: ['/opt/stack/compose.yml'],
      service: 'web',
    });

    mocks.previewContainer.mockResolvedValueOnce({
      dryRun: true,
      currentImage: 'nginx:1.0',
      compose: {
        files: ['/opt/stack/compose.yml', '/opt/stack/compose.override.yml'],
        service: 'web',
        willWrite: false,
        patch: '@@ -1,3 +1,3 @@',
      },
    });
    await composable.runContainerPreview();
    expect(composable.detailPreview.value).toEqual({
      dryRun: true,
      currentImage: 'nginx:1.0',
      compose: {
        files: ['/opt/stack/compose.yml', '/opt/stack/compose.override.yml'],
        service: 'web',
        willWrite: false,
        patch: '@@ -1,3 +1,3 @@',
      },
    });
    expect(composable.detailComposePreview.value).toEqual({
      files: ['/opt/stack/compose.yml', '/opt/stack/compose.override.yml'],
      service: 'web',
      willWrite: false,
      patch: '@@ -1,3 +1,3 @@',
      writableFile: undefined,
    });

    mocks.previewContainer.mockRejectedValueOnce(new Error('preview failed'));
    await composable.runContainerPreview();
    expect(composable.detailPreview.value).toBeNull();
    expect(composable.detailComposePreview.value).toBeNull();
    expect(composable.previewError.value).toBe('preview failed');
  });

  it('covers rollback guard and failure/latest-backup branches', async () => {
    const { composable, selectedContainerId } = await mountActionsHarness({
      selectedContainer: null,
      selectedContainerId: undefined,
    });

    await composable.rollbackToBackup('backup-1');
    expect(mocks.rollback).not.toHaveBeenCalled();

    selectedContainerId.value = 'container-1';
    mocks.rollback.mockRejectedValueOnce(new Error('rollback failed'));
    await composable.rollbackToBackup('backup-1');
    expect(composable.rollbackError.value).toBe('rollback failed');

    mocks.rollback.mockResolvedValueOnce({});
    await composable.rollbackToBackup();
    expect(composable.rollbackMessage.value).toBe('Rollback completed from latest backup');
  });

  it('covers policy-action guards, failures, and action variants', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, selectedContainer, selectedContainerId, containerIdMap } =
      await mountActionsHarness({
        selectedContainer: null,
        selectedContainerId: undefined,
        containerIdMap: {},
      });

    await composable.skipCurrentForSelected();
    await composable.snoozeSelected(1);
    await composable.unsnoozeSelected();
    await composable.clearSkipsSelected();
    await composable.clearPolicySelected();
    await composable.removeSkipTagSelected('keep');
    expect(mocks.updateContainerPolicy).not.toHaveBeenCalled();

    selectedContainer.value = container;
    selectedContainerId.value = container.id;
    await composable.skipCurrentForSelected();
    expect(mocks.updateContainerPolicy).not.toHaveBeenCalled();

    containerIdMap.value = { web: 'container-1' };
    mocks.updateContainerPolicy.mockRejectedValueOnce(new Error('policy failed'));
    await composable.skipCurrentForSelected();
    expect(composable.policyError.value).toBe('policy failed');
    expect(composable.skippedUpdates.value.has('web')).toBe(false);

    await composable.snoozeSelected(1);
    await composable.snoozeSelected(2);
    await composable.unsnoozeSelected();
    await composable.clearSkipsSelected();
    await composable.clearPolicySelected();
    await composable.removeSkipDigestSelected('sha256:1');
    await composable.removeSkipTagSelected('');

    const actions = mocks.updateContainerPolicy.mock.calls.map((call) => call[1]);
    expect(actions).toEqual(
      expect.arrayContaining(['snooze', 'unsnooze', 'clear-skips', 'clear', 'remove-skip']),
    );

    composable.snoozeDateInput.value = '2026-13-40';
    await composable.snoozeSelectedUntilDate();
    expect(composable.policyError.value).toBe('Select a valid snooze date');

    selectedContainer.value = null;
    composable.snoozeDateInput.value = '2026-03-15';
    await composable.snoozeSelectedUntilDate();
  });

  it('hydrates snooze input from selected policy and returns empty inactive policy state', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, containerMetaMap } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
      containerMetaMap: {
        web: {
          updatePolicy: {
            snoozeUntil: '2026-03-12T12:00:00.000Z',
            skipTags: [],
            skipDigests: [],
          },
        },
      },
    });
    await nextTick();

    expect(composable.snoozeDateInput.value).toBe('2026-03-12');

    containerMetaMap.value = {
      web: {
        updatePolicy: {
          snoozeUntil: 'not-a-date',
          skipTags: [],
          skipDigests: [],
        },
      },
    };
    await nextTick();

    expect(composable.snoozeDateInput.value).toBe('');
    expect(composable.getContainerListPolicyState('web')).toEqual({
      snoozed: false,
      skipped: false,
      skipCount: 0,
      maturityBlocked: false,
    });
  });

  it('returns empty policy state when metadata has no update-policy object', async () => {
    const { composable } = await mountActionsHarness({
      containerMetaMap: {
        web: {},
      },
    });

    expect(composable.getContainerListPolicyState('web')).toEqual({
      snoozed: false,
      skipped: false,
      skipCount: 0,
      maturityBlocked: false,
    });
  });

  it('exposes selected skip arrays and supports direct update/scan action handlers', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, containerMetaMap } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
      containers: [container],
      containerIdMap: { web: 'container-1' },
      containerMetaMap: {
        web: {
          updatePolicy: {
            skipTags: ['v1', 'v2'],
            skipDigests: ['sha256:abc'],
          },
        },
      },
    });

    expect(composable.selectedSkipTags.value).toEqual(['v1', 'v2']);
    expect(composable.selectedSkipDigests.value).toEqual(['sha256:abc']);

    containerMetaMap.value = {
      web: {
        updatePolicy: {
          skipTags: { invalid: true },
          skipDigests: null,
        },
      },
    };
    await nextTick();

    expect(composable.selectedSkipTags.value).toEqual([]);
    expect(composable.selectedSkipDigests.value).toEqual([]);

    mocks.updateContainer.mockClear();
    mocks.scanContainer.mockClear();
    await composable.updateContainer('web');
    await composable.scanContainer('web');
    expect(mocks.updateContainer).toHaveBeenCalledWith('container-1');
    expect(mocks.scanContainer).toHaveBeenCalledWith('container-1');
  });

  it('falls back for non-object selected policies and skips action-tab refresh when not on actions tab', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable } = await mountActionsHarness({
      activeDetailTab: 'overview',
      selectedContainer: container,
      selectedContainerId: container.id,
      containers: [container],
      containerIdMap: { web: 'container-1' },
      containerMetaMap: {
        web: {
          updatePolicy: 'invalid',
        },
      },
    });

    expect(composable.selectedUpdatePolicy.value).toEqual({});
    expect(composable.selectedSkipTags.value).toEqual([]);
    expect(composable.selectedSkipDigests.value).toEqual([]);
    expect(composable.getContainerListPolicyState('missing')).toEqual({
      snoozed: false,
      skipped: false,
      skipCount: 0,
      maturityBlocked: false,
    });

    mocks.getContainerTriggers.mockClear();
    mocks.getBackups.mockClear();
    mocks.getContainerUpdateOperations.mockClear();
    await composable.skipUpdate('web');
    expect(mocks.updateContainerPolicy).toHaveBeenCalledWith('container-1', 'skip-current', {});
    expect(mocks.getContainerTriggers).not.toHaveBeenCalled();
    expect(mocks.getBackups).not.toHaveBeenCalled();
    expect(mocks.getContainerUpdateOperations).not.toHaveBeenCalled();
  });

  it('refreshes actions-tab detail data after action execution and skip updates', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable } = await mountActionsHarness({
      activeDetailTab: 'actions',
      selectedContainer: container,
      selectedContainerId: container.id,
      containers: [container],
      containerIdMap: { web: 'container-1' },
    });
    mocks.getContainerTriggers.mockClear();
    mocks.getBackups.mockClear();
    mocks.getContainerUpdateOperations.mockClear();

    await composable.startContainer('web');
    expect(mocks.startContainer).toHaveBeenCalledWith('container-1');
    expect(mocks.getContainerTriggers).toHaveBeenCalledTimes(1);
    expect(mocks.getBackups).toHaveBeenCalledTimes(1);
    expect(mocks.getContainerUpdateOperations).toHaveBeenCalledTimes(1);

    mocks.getContainerTriggers.mockClear();
    mocks.getBackups.mockClear();
    mocks.getContainerUpdateOperations.mockClear();

    await composable.skipUpdate('web');
    expect(mocks.updateContainerPolicy).toHaveBeenCalledWith('container-1', 'skip-current', {});
    expect(mocks.getContainerTriggers).toHaveBeenCalledTimes(1);
    expect(mocks.getBackups).toHaveBeenCalledTimes(1);
    expect(mocks.getContainerUpdateOperations).toHaveBeenCalledTimes(1);
  });

  it('does not mark skip-update as applied when policy update fails', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable } = await mountActionsHarness({
      activeDetailTab: 'actions',
      selectedContainer: container,
      selectedContainerId: container.id,
      containerIdMap: {},
    });
    mocks.getContainerTriggers.mockClear();
    mocks.getBackups.mockClear();
    mocks.getContainerUpdateOperations.mockClear();

    await composable.skipUpdate('web');

    expect(composable.skippedUpdates.value.has('web')).toBe(false);
    expect(mocks.getContainerTriggers).not.toHaveBeenCalled();
    expect(mocks.getBackups).not.toHaveBeenCalled();
    expect(mocks.getContainerUpdateOperations).not.toHaveBeenCalled();
  });

  it('skips grouped updates when already in progress or when no container is eligible', async () => {
    const updatable = makeContainer({ id: 'container-1', name: 'web', newTag: '1.1.0' });
    const blocked = makeContainer({
      id: 'container-2',
      name: 'api',
      newTag: '2.0.0',
      bouncer: 'blocked',
    });
    const unchanged = makeContainer({ id: 'container-3', name: 'worker', newTag: null });
    const { composable } = await mountActionsHarness({
      containers: [updatable, blocked, unchanged],
      containerIdMap: { web: 'container-1', api: 'container-2', worker: 'container-3' },
    });

    composable.groupUpdateInProgress.value = new Set(['group-1']);
    await composable.updateAllInGroup({ key: 'group-1', containers: [updatable] });
    expect(mocks.updateContainer).not.toHaveBeenCalled();

    composable.groupUpdateInProgress.value = new Set();
    await composable.updateAllInGroup({ key: 'group-2', containers: [blocked, unchanged] });
    expect(mocks.updateContainer).not.toHaveBeenCalled();
  });

  it('handles delete guard and delete failure paths', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, containerIdMap, error } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
      containerIdMap: {},
    });

    composable.confirmDelete('web');
    let confirmOptions = mocks.confirmRequire.mock.calls.at(-1)?.[0] as { accept?: () => unknown };
    const guardedResult = await confirmOptions.accept?.();
    expect(guardedResult).toBe(false);
    expect(mocks.deleteContainer).not.toHaveBeenCalled();

    containerIdMap.value = { web: 'container-1' };
    mocks.deleteContainer.mockRejectedValueOnce(new Error('delete failed'));
    composable.confirmDelete('web');
    confirmOptions = mocks.confirmRequire.mock.calls.at(-1)?.[0] as { accept?: () => unknown };
    const failedResult = await confirmOptions.accept?.();
    expect(failedResult).toBe(false);
    expect(error.value).toBe('delete failed');
  });

  it('deletes non-selected containers without closing the selected detail views', async () => {
    const web = makeContainer({ id: 'container-1', name: 'web' });
    const api = makeContainer({ id: 'container-2', name: 'api' });
    const { composable, closeFullPage, closePanel, loadContainers } = await mountActionsHarness({
      selectedContainer: api,
      selectedContainerId: api.id,
      containerIdMap: { web: web.id, api: api.id },
    });

    composable.confirmDelete('web');
    const confirmOptions = mocks.confirmRequire.mock.calls.at(-1)?.[0] as {
      accept?: () => unknown;
    };
    const result = await confirmOptions.accept?.();

    expect(result).toBe(true);
    expect(mocks.deleteContainer).toHaveBeenCalledWith('container-1');
    expect(closeFullPage).not.toHaveBeenCalled();
    expect(closePanel).not.toHaveBeenCalled();
    expect(loadContainers).toHaveBeenCalledTimes(1);
  });

  it('skips overlapping poll cycles when a pending-action poll is still in flight', async () => {
    vi.useFakeTimers();
    const web = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, containers, loadContainers } = await mountActionsHarness({
      containers: [web],
      containerIdMap: { web: 'container-1' },
    });

    let resolvePoll: (() => void) | undefined;
    const inFlightPoll = new Promise<void>((resolve) => {
      resolvePoll = resolve;
    });
    let loadCallCount = 0;
    loadContainers.mockImplementation(() => {
      loadCallCount += 1;
      if (loadCallCount === 1) {
        containers.value = [];
        return Promise.resolve();
      }
      if (loadCallCount === 2) {
        return inFlightPoll;
      }
      return Promise.resolve();
    });

    await composable.startContainer('web');
    expect(composable.actionPending.value.has('web')).toBe(true);

    vi.advanceTimersByTime(PENDING_ACTIONS_POLL_INTERVAL_MS);
    await flushPromises();
    expect(loadCallCount).toBe(2);

    vi.advanceTimersByTime(PENDING_ACTIONS_POLL_INTERVAL_MS);
    await flushPromises();
    expect(loadCallCount).toBe(2);

    resolvePoll?.();
    await flushPromises();
  });

  it('stops pending-action polling when the harness is unmounted', async () => {
    vi.useFakeTimers();
    const web = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, containers, loadContainers } = await mountActionsHarness({
      containers: [web],
      containerIdMap: { web: 'container-1' },
    });
    loadContainers.mockImplementation(async () => {
      containers.value = [];
    });

    await composable.startContainer('web');
    expect(composable.actionPending.value.has('web')).toBe(true);

    const wrapper = mountedWrappers[mountedWrappers.length - 1];
    wrapper.unmount();

    loadContainers.mockClear();
    vi.advanceTimersByTime(PENDING_ACTIONS_POLL_INTERVAL_MS * 3);
    await flushPromises();

    expect(loadContainers).not.toHaveBeenCalled();
  });

  it('fails closed for action handlers when container actions are disabled', async () => {
    mocks.containerActionsEnabled.value = false;
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, error } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
      containerIdMap: { web: 'container-1' },
    });

    await composable.startContainer('web');
    expect(mocks.startContainer).not.toHaveBeenCalled();
    expect(error.value).toBe('Container actions disabled by server configuration');

    await composable.runAssociatedTrigger({ type: 'slack', name: 'notify' });
    expect(mocks.runTrigger).not.toHaveBeenCalled();
    expect(composable.triggerError.value).toBe(
      'Container actions disabled by server configuration',
    );

    await composable.skipCurrentForSelected();
    expect(mocks.updateContainerPolicy).not.toHaveBeenCalled();
    expect(composable.policyError.value).toBe('Container actions disabled by server configuration');

    error.value = null;
    await composable.updateAllInGroup({
      key: 'group-1',
      containers: [makeContainer({ id: 'container-2', name: 'api', newTag: '2.0.0' })],
    });
    expect(mocks.updateContainer).not.toHaveBeenCalled();
    expect(error.value).toBe('Container actions disabled by server configuration');

    await composable.rollbackToBackup('backup-1');
    expect(mocks.rollback).not.toHaveBeenCalled();
    expect(composable.rollbackError.value).toBe(
      'Container actions disabled by server configuration',
    );

    composable.confirmDelete('web');
    const confirmOptions = mocks.confirmRequire.mock.calls.at(-1)?.[0] as {
      accept?: () => unknown;
    };
    const result = await confirmOptions.accept?.();
    expect(result).toBe(false);
    expect(mocks.deleteContainer).not.toHaveBeenCalled();
    expect(error.value).toBe('Container actions disabled by server configuration');
  });
});
