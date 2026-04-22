import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { computed, defineComponent, h, nextTick, type Ref, ref } from 'vue';
import {
  OPERATION_DISPLAY_HOLD_MS,
  useOperationDisplayHold,
} from '@/composables/useOperationDisplayHold';
import { useUpdateBatches } from '@/composables/useUpdateBatches';
import type { ApiContainerTrigger, ApiContainerUpdateOperation } from '@/types/api';
import type { Container } from '@/types/container';
import { daysToMs } from '@/utils/maturity-policy';
import {
  ACTION_TAB_DETAIL_REFRESH_DEBOUNCE_MS,
  isPendingUpdateSettled,
  PENDING_ACTIONS_POLL_INTERVAL_MS,
  prunePendingActionsState,
  useContainerActions,
} from '@/views/containers/useContainerActions';

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn(),
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
  updateContainers: vi.fn(),
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
  updateContainers: mocks.updateContainers,
}));

vi.mock('@/services/preview', () => ({
  previewContainer: mocks.previewContainer,
}));

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    success: mocks.toastSuccess,
    error: mocks.toastError,
    info: mocks.toastInfo,
    warning: vi.fn(),
    toasts: { value: [] },
    addToast: vi.fn(),
    dismissToast: vi.fn(),
  }),
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
  const defaultId = overrides.id ?? 'container-1';
  const defaultName = overrides.name ?? 'web';
  return {
    id: defaultId,
    identityKey: overrides.identityKey ?? `::local::${defaultName}`,
    name: defaultName,
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
    useOperationDisplayHold().clearAllOperationDisplayHolds();
    useUpdateBatches().batches.value = new Map();
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
    mocks.updateContainers.mockImplementation(async (containerIds: string[]) => ({
      message: 'Container update requests processed',
      accepted: containerIds.map((containerId) => ({
        containerId,
        containerName: containerId,
        operationId: `op-${containerId}`,
      })),
      rejected: [],
    }));
    mocks.previewContainer.mockResolvedValue({});
  });

  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount();
    }
    vi.useRealTimers();
  });

  it('treats matching live containers as settled when no snapshot was recorded', () => {
    const lifecycleObserved = ref(new Set(['web']));

    expect(
      isPendingUpdateSettled({
        pendingKey: 'web',
        now: Date.now(),
        startTime: Date.now(),
        liveContainer: makeContainer({ id: 'container-1', name: 'web', status: 'running' }),
        actionPendingLifecycleObserved: lifecycleObserved,
      }),
    ).toBe(true);
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
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Trigger ran: agent-1.slack.notify');
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
    composable.skippedUpdates.value.add('container-1');
    mocks.getBackups.mockClear();
    mocks.getContainerUpdateOperations.mockClear();
    loadContainers.mockClear();

    await composable.rollbackToBackup('backup-1');

    expect(mocks.rollback).toHaveBeenCalledWith('container-1', 'backup-1');
    expect(composable.rollbackMessage.value).toBe('Rollback completed from selected backup');
    expect(composable.skippedUpdates.value.has('container-1')).toBe(false);
    expect(loadContainers).toHaveBeenCalledTimes(1);
    expect(mocks.getBackups).toHaveBeenCalledTimes(1);
    expect(mocks.getContainerUpdateOperations).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Rollback completed from selected backup');
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
    expect(composable.skippedUpdates.value.has('container-1')).toBe(true);
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
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Update started: web');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Scan triggered: web');

    mocks.updateContainer.mockClear();
    mocks.scanContainer.mockClear();
    await composable.updateContainer('api');
    await composable.scanContainer('api');
    expect(mocks.updateContainer).not.toHaveBeenCalled();
    expect(mocks.scanContainer).not.toHaveBeenCalled();
  });

  it('runs action handlers for object targets and falls back to target names when ids are omitted', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
      containerIdMap: { web: 'container-1' },
    });

    await composable.startContainer({
      id: 'container-1',
      identityKey: '::local::web',
      name: 'web',
    });
    await composable.scanContainer({
      id: 'container-1',
      identityKey: '::local::web',
      name: 'web',
    });
    composable.confirmForceUpdate({
      name: 'web',
    } as unknown as Parameters<typeof composable.confirmForceUpdate>[0]);
    const forceCall = mocks.confirmRequire.mock.calls.at(-1)?.[0] as {
      accept?: () => Promise<unknown>;
    };
    await forceCall.accept?.();

    expect(mocks.startContainer).toHaveBeenCalledWith('container-1');
    expect(mocks.scanContainer).toHaveBeenCalledWith('container-1');
    expect(mocks.updateContainerPolicy).toHaveBeenCalledWith('container-1', 'clear', {});
    expect(mocks.updateContainer).toHaveBeenCalledWith('container-1');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Started: web');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Scan triggered: web');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Force update started: web');
  });

  it('refreshes container state instead of surfacing an error when update reports no update available', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web', newTag: '1.1.0' });
    const { composable, error, loadContainers } = await mountActionsHarness({
      containers: [container],
      selectedContainer: container,
      selectedContainerId: container.id,
      containerIdMap: { web: 'container-1' },
    });
    mocks.updateContainer.mockRejectedValueOnce(
      new Error('No update available for this container'),
    );
    loadContainers.mockClear();

    await composable.updateContainer('web');

    expect(mocks.updateContainer).toHaveBeenCalledWith('container-1');
    expect(loadContainers).toHaveBeenCalledTimes(1);
    expect(error.value).toBeNull();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastInfo).toHaveBeenCalledWith('Already up to date: web');
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith('Update started: web');
  });

  it('surfaces non-stale update errors that only contain the no-update text as a substring', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web', newTag: '1.1.0' });
    const { composable, error, loadContainers } = await mountActionsHarness({
      containers: [container],
      selectedContainer: container,
      selectedContainerId: container.id,
      containerIdMap: { web: 'container-1' },
    });
    mocks.updateContainer.mockRejectedValueOnce(
      new Error('Proxy error: No update available for this container'),
    );
    loadContainers.mockClear();

    await composable.updateContainer('web');

    expect(mocks.updateContainer).toHaveBeenCalledWith('container-1');
    expect(loadContainers).toHaveBeenCalledTimes(1);
    expect(error.value).toBe('Proxy error: No update available for this container');
    expect(mocks.toastError).toHaveBeenCalledWith(
      'Update failed: web',
      'Proxy error: No update available for this container',
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith('Update started: web');
  });

  it.each([
    null,
    undefined,
    { code: 'E_UNKNOWN' },
  ])('treats %p update failures as normal errors instead of stale-update refreshes', async (rejection) => {
    const container = makeContainer({ id: 'container-1', name: 'web', newTag: '1.1.0' });
    const { composable, error, loadContainers } = await mountActionsHarness({
      containers: [container],
      selectedContainer: container,
      selectedContainerId: container.id,
      containerIdMap: { web: 'container-1' },
    });
    mocks.updateContainer.mockRejectedValueOnce(rejection);
    loadContainers.mockClear();

    await composable.updateContainer('web');

    expect(mocks.updateContainer).toHaveBeenCalledWith('container-1');
    expect(loadContainers).toHaveBeenCalledTimes(1);
    expect(error.value).toBe('Action failed for web');
    expect(mocks.toastError).toHaveBeenCalledWith('Update failed: web', 'Action failed for web');
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith('Update started: web');
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
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Deleted: web');
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

    expect(mocks.updateContainers).toHaveBeenCalledWith(['container-1', 'container-2']);
    expect(mocks.updateContainer).not.toHaveBeenCalled();
    expect(loadContainers).toHaveBeenCalledTimes(1);
    expect(useUpdateBatches().getBatch('group-1')).toEqual({
      frozenTotal: 2,
      startedAt: expect.any(Number),
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Started updates for 2 containers in group-1');
  });

  it('sends grouped update-all through the bulk update endpoint', async () => {
    const c1 = makeContainer({ id: 'container-1', name: 'web', newTag: '1.1.0', bouncer: 'safe' });
    const c2 = makeContainer({ id: 'container-2', name: 'api', newTag: '2.0.0', bouncer: 'safe' });
    mocks.updateContainers.mockResolvedValue({
      message: 'Container update requests processed',
      accepted: [
        { containerId: 'container-1', containerName: 'web', operationId: 'op-1' },
        { containerId: 'container-2', containerName: 'api', operationId: 'op-2' },
      ],
      rejected: [],
    });

    const { composable } = await mountActionsHarness({
      containers: [c1, c2],
      containerIdMap: {
        web: 'container-1',
        api: 'container-2',
      },
    });

    await composable.updateAllInGroup({
      key: 'group-1',
      containers: [c1, c2],
    });

    expect(mocks.updateContainers).toHaveBeenCalledWith(['container-1', 'container-2']);
    expect(mocks.updateContainer).not.toHaveBeenCalled();
  });

  it('freezes grouped update ids and skips containers renamed during the batch', async () => {
    const web = makeContainer({ id: 'container-1', name: 'web', newTag: '1.1.0', bouncer: 'safe' });
    const api = makeContainer({ id: 'container-2', name: 'api', newTag: '2.0.0', bouncer: 'safe' });
    const { composable, containerIdMap, containers, loadContainers } = await mountActionsHarness({
      containers: [web, api],
      containerIdMap: {
        web: 'container-1',
        api: 'container-2',
      },
    });
    loadContainers.mockClear();

    mocks.updateContainers.mockImplementation(async (containerIds: string[]) => {
      if (containerIds.includes('container-1')) {
        containerIdMap.value = {
          web: 'container-1-new',
          api: 'container-2-new',
          'api-old-1773933154786': 'container-2',
        };
        containers.value = [
          makeContainer({ id: 'container-1-new', name: 'web', newTag: null }),
          makeContainer({
            id: 'container-2',
            name: 'api-old-1773933154786',
            newTag: '2.0.0',
            bouncer: 'safe',
          }),
          makeContainer({ id: 'container-2-new', name: 'api', newTag: '2.0.0', bouncer: 'safe' }),
        ];
      }
      return {
        message: 'Container update requests processed',
        accepted: containerIds.map((containerId) => ({
          containerId,
          containerName: containerId,
          operationId: `op-${containerId}`,
        })),
        rejected: [],
      };
    });

    await composable.updateAllInGroup({
      key: 'group-1',
      containers: [web, api],
    });

    expect(mocks.updateContainers).toHaveBeenCalledWith(['container-1', 'container-2']);
    expect(loadContainers).toHaveBeenCalledTimes(1);
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
    mocks.updateContainers.mockRejectedValue(new Error('update failed'));
    loadContainers.mockClear();

    await composable.updateAllInGroup({
      key: 'group-1',
      containers: [c1, c2],
    });

    expect(mocks.updateContainers).toHaveBeenCalledWith(['container-1', 'container-2']);
    expect(loadContainers).not.toHaveBeenCalled();
    expect(useUpdateBatches().getBatch('group-1')).toBeUndefined();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
  });

  it('refreshes grouped updates when stale rows report no update available and only counts successful updates', async () => {
    const stale = makeContainer({
      id: 'container-1',
      name: 'web',
      newTag: '1.1.0',
      bouncer: 'safe',
    });
    const fresh = makeContainer({
      id: 'container-2',
      name: 'api',
      newTag: '2.0.0',
      bouncer: 'safe',
    });
    const { composable, error, loadContainers } = await mountActionsHarness({
      containers: [stale, fresh],
      containerIdMap: {
        web: 'container-1',
        api: 'container-2',
      },
    });
    mocks.updateContainers.mockResolvedValue({
      message: 'Container update requests processed',
      accepted: [{ containerId: 'container-2', containerName: 'api', operationId: 'op-2' }],
      rejected: [
        {
          containerId: 'container-1',
          containerName: 'web',
          statusCode: 400,
          message: 'No update available for this container',
        },
      ],
    });
    loadContainers.mockClear();

    await composable.updateAllInGroup({
      key: 'group-1',
      containers: [stale, fresh],
    });

    expect(mocks.updateContainers).toHaveBeenCalledWith(['container-1', 'container-2']);
    expect(loadContainers).toHaveBeenCalledTimes(1);
    expect(error.value).toBeNull();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Started update for 1 container in group-1');
  });

  it('surfaces non-stale grouped update rejections as toast errors', async () => {
    const web = makeContainer({
      id: 'container-1',
      name: 'web',
      newTag: '1.1.0',
      bouncer: 'safe',
    });
    const api = makeContainer({
      id: 'container-2',
      name: 'api',
      newTag: '2.0.0',
      bouncer: 'safe',
    });
    const { composable } = await mountActionsHarness({
      containers: [web, api],
      containerIdMap: {
        web: 'container-1',
        api: 'container-2',
      },
    });
    mocks.updateContainers.mockResolvedValue({
      message: 'Container update requests processed',
      accepted: [{ containerId: 'container-1', containerName: 'web', operationId: 'op-1' }],
      rejected: [
        {
          containerId: 'container-2',
          containerName: 'api',
          statusCode: 500,
          message: 'registry timeout',
        },
      ],
    });

    await composable.updateAllInGroup({
      key: 'group-1',
      containers: [web, api],
    });

    expect(mocks.toastError).toHaveBeenCalledWith('Failed to update api: registry timeout');
  });

  it('does not show a grouped update success toast when no requests were accepted', async () => {
    const web = makeContainer({
      id: 'container-1',
      name: 'web',
      newTag: '1.1.0',
      bouncer: 'safe',
    });
    const { composable, loadContainers } = await mountActionsHarness({
      containers: [web],
      containerIdMap: { web: 'container-1' },
    });
    mocks.updateContainers.mockResolvedValue({
      message: 'Container update requests processed',
      accepted: [],
      rejected: [
        {
          containerId: 'container-1',
          containerName: 'web',
          statusCode: 400,
          message: 'No update available for this container',
        },
      ],
    });

    await composable.updateAllInGroup({
      key: 'group-1',
      containers: [web],
    });

    expect(loadContainers).toHaveBeenCalledTimes(1);
    expect(mocks.toastSuccess).not.toHaveBeenCalledWith(expect.stringContaining('Started update'));
    expect(useUpdateBatches().getBatch('group-1')).toBeUndefined();
  });

  it('tracks pending actions and polls until container reappears', async () => {
    vi.useFakeTimers();
    const web = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, containers, loadContainers } = await mountActionsHarness({
      containers: [web],
      containerIdMap: { web: 'container-1' },
    });

    // loadContainers is called during startContainer's onAccepted → simulate disappearance
    loadContainers.mockImplementation(async () => {
      containers.value = [];
    });

    await composable.startContainer('web');
    expect(composable.actionPending.value.has('web')).toBe(true);

    // Poll tick: prunePendingActions runs against in-memory state (no loadContainers call)
    // Container is absent → still pending (presence mode waits for reappearance)
    vi.advanceTimersByTime(PENDING_ACTIONS_POLL_INTERVAL_MS);
    await flushPromises();
    expect(composable.actionPending.value.has('web')).toBe(true);

    // Simulate SSE patch: container reappears in-memory
    containers.value = [web];
    await nextTick();

    // watch(containers) fires prunePendingActions → container present → settled
    expect(composable.actionPending.value.has('web')).toBe(false);

    // Poll stops after settling — no further loadContainers calls
    loadContainers.mockClear();
    vi.advanceTimersByTime(PENDING_ACTIONS_POLL_INTERVAL_MS * 2);
    await flushPromises();
    expect(loadContainers).not.toHaveBeenCalled();
  });

  it('captures the pending snapshot by container name when the mapped id is stale', async () => {
    const liveWeb = makeContainer({ id: 'container-1-new', name: 'web' });
    const { composable, containers, loadContainers } = await mountActionsHarness({
      containers: [liveWeb],
      containerIdMap: { web: 'container-1' },
    });
    loadContainers.mockImplementation(async () => {
      containers.value = [];
    });

    await composable.startContainer('web');

    expect(composable.actionPending.value.get('web')).toEqual(
      expect.objectContaining({ id: 'container-1-new', name: 'web' }),
    );
  });

  it('reports pending containers as still updating after the request completes', async () => {
    vi.useFakeTimers();
    const web = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, containers, loadContainers } = await mountActionsHarness({
      containers: [web],
      containerIdMap: { web: 'container-1' },
    });
    loadContainers.mockImplementation(async () => {
      containers.value = [];
    });

    await composable.startContainer(web);

    expect(composable.actionInProgress.value.size).toBe(0);
    expect(composable.actionPending.value.has('container-1')).toBe(true);
    expect(composable.isContainerUpdateInProgress(web)).toBe(true);
  });

  it('matches pending updates for string targets by snapshot name when the pending key is a container id', async () => {
    const web = makeContainer({ id: 'container-1', name: 'web' });
    const { composable } = await mountActionsHarness({
      containers: [web],
    });

    composable.actionPending.value.set('container-1', web);

    expect(composable.isContainerUpdateInProgress('web')).toBe(true);
  });

  it('does not match unrelated live in-progress updates for string targets', async () => {
    const api = makeContainer({
      id: 'container-2',
      name: 'api',
      updateOperation: {
        id: 'op-2',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-11T12:00:00.000Z',
      },
    });
    const { composable } = await mountActionsHarness({
      containers: [api],
    });

    expect(composable.isContainerUpdateInProgress('web')).toBe(false);
  });

  it('treats stale update actions without a stale message as a quiet no-op when reload is disabled', async () => {
    const web = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, loadContainers } = await mountActionsHarness({
      containers: [web],
      containerIdMap: { web: 'container-1' },
    });
    const action = vi.fn().mockRejectedValue(new Error('No update available for this container'));

    const result = await composable.executeAction('web', action, {
      reloadContainers: false,
      treatNoUpdateAsStale: true,
    });

    expect(result).toBe(false);
    expect(loadContainers).not.toHaveBeenCalled();
    expect(mocks.toastInfo).not.toHaveBeenCalled();
  });

  it('skips reload when a non-stale update action fails and reload is disabled', async () => {
    const web = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, loadContainers, error } = await mountActionsHarness({
      containers: [web],
      containerIdMap: { web: 'container-1' },
    });
    const action = vi.fn().mockRejectedValue(new Error('update exploded'));

    const result = await composable.executeAction('web', action, {
      reloadContainers: false,
    });

    expect(result).toBe(false);
    expect(error.value).toBe('update exploded');
    expect(loadContainers).not.toHaveBeenCalled();
  });

  it('reports live containers with an in-progress update operation as still updating', async () => {
    const web = makeContainer({
      id: 'container-1',
      name: 'web',
      status: 'stopped',
      updateOperation: {
        id: 'op-1',
        status: 'in-progress',
        phase: 'old-stopped',
        updatedAt: '2026-04-01T12:00:00.000Z',
        fromVersion: '1.0.0',
        toVersion: '1.1.0',
      },
    });
    const { composable } = await mountActionsHarness({
      containers: [web],
      selectedContainer: web,
      selectedContainerId: web.id,
      containerIdMap: { web: web.id },
    });

    expect(composable.isContainerUpdateInProgress(web)).toBe(true);
    expect(composable.isContainerUpdateInProgress('web')).toBe(true);
  });

  it('keeps update rows pending across a stale first refresh until the container is running again', async () => {
    vi.useFakeTimers();
    const web = makeContainer({ id: 'container-1', name: 'web', status: 'running' });
    const stoppedDuringUpdate = makeContainer({
      id: 'container-1',
      name: 'web',
      status: 'stopped',
      updateOperation: {
        id: 'op-1',
        status: 'in-progress',
        phase: 'old-stopped',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    });
    const runningAgain = makeContainer({ id: 'container-1', name: 'web', status: 'running' });
    const { composable, containers, loadContainers } = await mountActionsHarness({
      containers: [web],
      selectedContainer: web,
      selectedContainerId: web.id,
      containerIdMap: { web: web.id },
    });
    // loadContainers is still called during updateContainer's onAccepted
    loadContainers.mockImplementation(async () => {
      containers.value = [makeContainer({ id: 'container-1', name: 'web', status: 'running' })];
    });

    await composable.updateContainer('web');

    expect(composable.actionPending.value.has('web')).toBe(true);
    expect(composable.isContainerUpdateInProgress('web')).toBe(true);

    // Simulate SSE patch: container goes to stopped+in-progress (update in flight)
    containers.value = [stoppedDuringUpdate];
    await nextTick();

    // watch(containers) fires → lifecycle signal observed → still pending
    expect(composable.actionPending.value.has('web')).toBe(true);
    expect(composable.isContainerUpdateInProgress('web')).toBe(true);

    // Simulate SSE patch: container back to running (update complete)
    containers.value = [runningAgain];
    await nextTick();

    // watch(containers) fires → container present + status matches snapshot → settled
    expect(composable.actionPending.value.has('web')).toBe(false);
    expect(composable.isContainerUpdateInProgress('web')).toBe(false);
  });

  it('keeps update rows pending when the container disappears mid-update and settles once it returns', async () => {
    vi.useFakeTimers();
    const web = makeContainer({
      id: 'container-1',
      name: 'web',
      newTag: '1.1.0',
      status: 'running',
    });
    const runningAgain = makeContainer({ id: 'container-1', name: 'web', status: 'running' });
    const { composable, containers, loadContainers } = await mountActionsHarness({
      containers: [web],
      selectedContainer: web,
      selectedContainerId: web.id,
      containerIdMap: { web: web.id },
    });
    // loadContainers is still called during updateContainer's onAccepted
    loadContainers.mockImplementation(async () => {
      containers.value = [makeContainer({ id: 'container-1', name: 'web', status: 'running' })];
    });

    await composable.updateContainer('web');

    expect(composable.actionPending.value.has('web')).toBe(true);

    // Simulate SSE patch: container removed mid-update
    containers.value = [];
    await nextTick();

    // watch fires → container absent → lifecycle signal observed, still pending (update mode requires lifecycle)
    expect(composable.actionPending.value.has('web')).toBe(true);
    expect(composable.isContainerUpdateInProgress('web')).toBe(true);

    // Simulate SSE patch: container reappears running
    containers.value = [runningAgain];
    await nextTick();

    // watch fires → container present + lifecycle observed → settled
    expect(composable.actionPending.value.has('web')).toBe(false);
    expect(composable.isContainerUpdateInProgress('web')).toBe(false);
  });

  it('keeps update rows pending until the container status matches the original snapshot again', async () => {
    vi.useFakeTimers();
    const web = makeContainer({
      id: 'container-1',
      name: 'web',
      newTag: '1.1.0',
      status: 'running',
    });
    const stoppedAfterReplace = makeContainer({
      id: 'container-1',
      name: 'web',
      status: 'stopped',
    });
    const runningAgain = makeContainer({ id: 'container-1', name: 'web', status: 'running' });
    const { composable, containers, loadContainers } = await mountActionsHarness({
      containers: [web],
      selectedContainer: web,
      selectedContainerId: web.id,
      containerIdMap: { web: web.id },
    });
    // loadContainers is still called during updateContainer's onAccepted
    loadContainers.mockImplementation(async () => {
      containers.value = [makeContainer({ id: 'container-1', name: 'web', status: 'running' })];
    });

    await composable.updateContainer('web');

    expect(composable.actionPending.value.has('web')).toBe(true);

    // Simulate SSE patch: container replaced with stopped version
    containers.value = [stoppedAfterReplace];
    await nextTick();

    // watch fires → status differs from snapshot (running) → lifecycle signal observed, still pending
    expect(composable.actionPending.value.has('web')).toBe(true);
    expect(composable.isContainerUpdateInProgress('web')).toBe(true);

    // Simulate SSE patch: container running again
    containers.value = [runningAgain];
    await nextTick();

    // watch fires → status matches snapshot + lifecycle observed → settled
    expect(composable.actionPending.value.has('web')).toBe(false);
    expect(composable.isContainerUpdateInProgress('web')).toBe(false);
  });

  it('relies on live backend operation state for grouped updates instead of local pending tracking', async () => {
    vi.useFakeTimers();
    const web = makeContainer({
      id: 'container-1',
      name: 'web',
      newTag: '1.1.0',
      status: 'running',
    });
    const { composable, containers, loadContainers } = await mountActionsHarness({
      containers: [web],
      containerIdMap: { web: web.id },
    });
    let loadCallCount = 0;
    loadContainers.mockImplementation(async () => {
      loadCallCount += 1;
      containers.value =
        loadCallCount === 1
          ? [
              makeContainer({
                id: 'container-1',
                name: 'web',
                status: 'stopped',
                updateOperation: {
                  id: 'op-2',
                  status: 'in-progress',
                  phase: 'health-gate',
                  updatedAt: '2026-04-01T12:01:00.000Z',
                },
              }),
            ]
          : [makeContainer({ id: 'container-1', name: 'web', status: 'running' })];
    });

    await composable.updateAllInGroup({
      key: 'group-1',
      containers: [web],
    });

    expect(composable.actionPending.value.has('container-1')).toBe(false);
    expect(composable.isContainerUpdateInProgress('web')).toBe(true);
  });

  it('reuses existing pending start timestamps when the same action is queued again', async () => {
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

    containers.value = [web];
    await composable.startContainer('web');
    expect(composable.actionPending.value.has('web')).toBe(true);
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

    expect(composable.actionInProgress.value.size).toBe(0);
    expect(error.value).toBe('start failed');
    expect(mocks.toastError).toHaveBeenCalledWith('Update failed: web', 'start failed');

    // subsequent successful action clears the error
    mocks.startContainer.mockResolvedValueOnce({ message: 'ok' });
    await composable.startContainer('web');
    expect(error.value).toBeNull();
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Started: web');
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
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Stopped: web');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Restarted: web');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Force update started: web');
  });

  it('wires confirm handlers for object targets and falls back to names when ids are omitted', async () => {
    const web = makeContainer({ id: 'container-1', name: 'web', newTag: '1.1.0' });
    const api = makeContainer({ id: 'container-2', name: 'api' });
    const { composable, closeFullPage, closePanel, loadContainers } = await mountActionsHarness({
      selectedContainer: api,
      selectedContainerId: api.id,
      containerIdMap: { web: web.id, api: api.id },
    });

    composable.confirmStop({ id: web.id, identityKey: web.identityKey, name: web.name });
    composable.confirmRestart({ id: web.id, identityKey: web.identityKey, name: web.name });
    composable.confirmUpdate({ id: web.id, identityKey: web.identityKey, name: web.name });
    composable.confirmDelete({ name: web.name } as unknown as Parameters<
      typeof composable.confirmDelete
    >[0]);

    expect(mocks.confirmRequire).toHaveBeenCalledTimes(4);
    const [stopCall, restartCall, updateCall, deleteCall] = mocks.confirmRequire.mock.calls.map(
      (call) => call[0] as { header: string; accept?: () => Promise<unknown> },
    );

    expect(stopCall.header).toBe('Stop Container');
    expect(restartCall.header).toBe('Restart Container');
    expect(updateCall.header).toBe('Update Container');
    expect(deleteCall.header).toBe('Delete Container');

    await stopCall.accept?.();
    await restartCall.accept?.();
    await updateCall.accept?.();
    const deleted = await deleteCall.accept?.();

    expect(deleted).toBe(true);
    expect(mocks.stopContainer).toHaveBeenCalledWith(web.id);
    expect(mocks.restartContainer).toHaveBeenCalledWith(web.id);
    expect(mocks.updateContainer).toHaveBeenCalledWith(web.id);
    expect(mocks.deleteContainer).toHaveBeenCalledWith(web.id);
    expect(closeFullPage).not.toHaveBeenCalled();
    expect(closePanel).not.toHaveBeenCalled();
    expect(loadContainers).toHaveBeenCalledTimes(4);
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
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Update started: web');
  });

  it('shows tag change details in update confirmation for tag updates', async () => {
    const container = makeContainer({
      id: 'container-1',
      name: 'web',
      currentTag: 'v6',
      newTag: 'v7',
      updateKind: 'major',
    });
    const { composable } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
      containerIdMap: { web: 'container-1' },
    });

    composable.confirmUpdate('web');

    const confirmCall = mocks.confirmRequire.mock.calls[0][0] as { message: string };
    expect(confirmCall.message).toContain(':v6');
    expect(confirmCall.message).toContain(':v7');
    expect(confirmCall.message).toContain('major');
  });

  it('shows digest change details in update confirmation for digest updates', async () => {
    const container = makeContainer({
      id: 'container-1',
      name: 'web',
      currentTag: 'latest',
      newTag: 'latest',
      updateKind: 'digest',
    });
    const { composable } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
      containerIdMap: { web: 'container-1' },
    });

    composable.confirmUpdate('web');

    const confirmCall = mocks.confirmRequire.mock.calls[0][0] as { message: string };
    expect(confirmCall.message).toContain(':latest');
    expect(confirmCall.message).toContain('digest');
    expect(confirmCall.message).not.toContain(':v');
  });

  it('falls back to the generic update confirmation when container details are missing', async () => {
    const { composable } = await mountActionsHarness({
      selectedContainer: null,
      selectedContainerId: undefined,
      containerIdMap: { web: 'container-1' },
    });

    composable.confirmUpdate('web');

    const confirmCall = mocks.confirmRequire.mock.calls[0][0] as { message: string };
    expect(confirmCall.message).toBe(
      'Update web now? This will apply the latest discovered image.',
    );
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

  it('opens clear-policy confirmation only when a container is selected and wires accept', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, selectedContainer, selectedContainerId } = await mountActionsHarness({
      selectedContainer: null,
      selectedContainerId: undefined,
      containerIdMap: { web: 'container-1' },
    });

    composable.confirmClearPolicy();
    expect(mocks.confirmRequire).not.toHaveBeenCalled();

    selectedContainer.value = container;
    selectedContainerId.value = container.id;
    composable.confirmClearPolicy();

    expect(mocks.confirmRequire).toHaveBeenCalledTimes(1);
    const confirmCall = mocks.confirmRequire.mock.calls[0][0] as {
      header: string;
      message: string;
      acceptLabel: string;
      accept?: () => Promise<unknown>;
    };
    expect(confirmCall.header).toBe('Clear Update Policy');
    expect(confirmCall.message).toContain('Clear all update policy for web?');
    expect(confirmCall.acceptLabel).toBe('Clear Policy');

    await confirmCall.accept?.();
    expect(mocks.updateContainerPolicy).toHaveBeenCalledWith('container-1', 'clear', {});
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
    composable.detailUpdateOperations.value = [
      {
        id: 'stale-operation',
        status: 'in-progress',
        phase: 'prepare',
        createdAt: '2026-03-01T00:00:00Z',
        updatedAt: '2026-03-01T00:00:00Z',
      } satisfies ApiContainerUpdateOperation,
    ];
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
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Rollback completed from latest backup');
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
    expect(mocks.updateContainerPolicy).toHaveBeenCalledWith('container-1', 'skip-current', {});
    mocks.updateContainerPolicy.mockClear();
    composable.skippedUpdates.value.clear();

    containerIdMap.value = { web: 'container-1' };
    mocks.updateContainerPolicy.mockRejectedValueOnce(new Error('policy failed'));
    await composable.skipCurrentForSelected();
    expect(composable.policyError.value).toBe('policy failed');
    expect(composable.skippedUpdates.value.has('container-1')).toBe(false);

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

  it('prefers selected container ids when resolving selected update policy metadata', async () => {
    const container = makeContainer({ id: 'container-1', name: 'web' });
    const { composable } = await mountActionsHarness({
      selectedContainer: container,
      selectedContainerId: container.id,
      containers: [container],
      containerIdMap: { web: 'container-1' },
      containerMetaMap: {
        'container-1': {
          updatePolicy: {
            skipTags: ['by-id'],
            skipDigests: ['sha256:by-id'],
          },
        },
      },
    });

    expect(composable.selectedUpdatePolicy.value).toEqual({
      skipTags: ['by-id'],
      skipDigests: ['sha256:by-id'],
    });
    expect(composable.selectedSkipTags.value).toEqual(['by-id']);
    expect(composable.selectedSkipDigests.value).toEqual(['sha256:by-id']);
  });

  it('falls back to selected container names when selected ids are missing', async () => {
    const selectedContainer = {
      ...makeContainer({ name: 'web' }),
      id: undefined,
    } as unknown as Container;
    const { composable } = await mountActionsHarness({
      selectedContainer,
      selectedContainerId: undefined,
      containerIdMap: { web: 'container-1' },
      containerMetaMap: {
        web: {
          updatePolicy: {
            skipTags: ['by-name'],
          },
        },
      },
    });

    expect(composable.selectedUpdatePolicy.value).toEqual({
      skipTags: ['by-name'],
    });

    await composable.skipCurrentForSelected();

    expect(mocks.updateContainerPolicy).toHaveBeenCalledWith('container-1', 'skip-current', {});
    expect(composable.skippedUpdates.value.has('web')).toBe(true);
  });

  it('returns an empty selected update policy when the selected container has no id or name', async () => {
    const { composable } = await mountActionsHarness({
      selectedContainer: {
        id: undefined,
        name: '',
      } as unknown as Container,
      selectedContainerId: undefined,
      containerMetaMap: {
        web: {
          updatePolicy: {
            skipTags: ['ignored'],
          },
        },
      },
    });

    expect(composable.selectedUpdatePolicy.value).toEqual({});
  });

  it('guards selected update policy name fallback when only an id is present', async () => {
    const { composable } = await mountActionsHarness({
      selectedContainer: {
        id: 'container-1',
        name: '',
      } as unknown as Container,
      selectedContainerId: 'container-1',
      containerMetaMap: {},
    });

    expect(composable.selectedUpdatePolicy.value).toEqual({});
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
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Started: web');
    expect(mocks.getContainerTriggers).toHaveBeenCalledTimes(1);
    expect(mocks.getBackups).toHaveBeenCalledTimes(1);
    expect(mocks.getContainerUpdateOperations).toHaveBeenCalledTimes(1);

    mocks.getContainerTriggers.mockClear();
    mocks.getBackups.mockClear();
    mocks.getContainerUpdateOperations.mockClear();

    await composable.skipUpdate(container);
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
    const updatable = makeContainer({
      id: 'container-1',
      name: 'web',
      newTag: '1.1.0',
      updateOperation: {
        id: 'op-1',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-11T12:00:00.000Z',
      },
    });
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

    await composable.updateAllInGroup({ key: 'group-1', containers: [updatable] });
    expect(mocks.updateContainers).not.toHaveBeenCalled();

    await composable.updateAllInGroup({ key: 'group-2', containers: [blocked, unchanged] });
    expect(mocks.updateContainers).not.toHaveBeenCalled();
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
    expect(mocks.toastError).toHaveBeenCalledWith('Delete failed: web', 'delete failed');
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
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Deleted: web');
  });

  it('skips overlapping poll cycles when a pending-action poll is still in flight', async () => {
    vi.useFakeTimers();
    const web = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, containers, loadContainers } = await mountActionsHarness({
      containers: [web],
      containerIdMap: { web: 'container-1' },
    });
    // loadContainers is called during startContainer's onAccepted
    loadContainers.mockImplementation(async () => {
      containers.value = [];
    });

    await composable.startContainer('web');
    expect(composable.actionPending.value.has('web')).toBe(true);

    // Poll ticks use in-memory state — no loadContainers call during prune
    loadContainers.mockClear();
    vi.advanceTimersByTime(PENDING_ACTIONS_POLL_INTERVAL_MS);
    await flushPromises();
    expect(loadContainers).not.toHaveBeenCalled();

    // Still pending because container is absent; poll runs again
    vi.advanceTimersByTime(PENDING_ACTIONS_POLL_INTERVAL_MS);
    await flushPromises();
    expect(loadContainers).not.toHaveBeenCalled();
    expect(composable.actionPending.value.has('web')).toBe(true);

    // Container reappears via SSE patch → watch fires → settled
    containers.value = [web];
    await nextTick();
    expect(composable.actionPending.value.has('web')).toBe(false);
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

  it('updates each container in a group by its own id when names collide across hosts', async () => {
    const localNode = makeContainer({
      id: 'container-1',
      name: 'tdarr_node',
      newTag: '2.0.0',
      server: 'Datavault',
    });
    const remoteNode = makeContainer({
      id: 'container-2',
      name: 'tdarr_node',
      newTag: '2.0.0',
      server: 'Tmvault',
    });
    const { composable } = await mountActionsHarness({
      containers: [localNode, remoteNode],
      containerIdMap: { tdarr_node: 'container-2' },
    });

    await composable.updateAllInGroup({
      key: 'tdarr-stack',
      containers: [localNode, remoteNode],
    });

    expect(mocks.updateContainers).toHaveBeenCalledWith(['container-1', 'container-2']);
  });

  it('tracks in-progress actions by container id when names collide across hosts', async () => {
    const localNode = makeContainer({
      id: 'container-1',
      name: 'tdarr_node',
      server: 'Datavault',
    });
    const remoteNode = makeContainer({
      id: 'container-2',
      name: 'tdarr_node',
      server: 'Tmvault',
    });
    const { composable } = await mountActionsHarness({
      containers: [localNode, remoteNode],
      containerIdMap: { tdarr_node: 'container-2' },
    });

    let resolveFirst: (() => void) | undefined;
    let resolveSecond: (() => void) | undefined;
    const action = vi.fn((id: string) => {
      return new Promise<void>((resolve) => {
        if (id === 'container-1') {
          resolveFirst = resolve;
        } else if (id === 'container-2') {
          resolveSecond = resolve;
        }
      });
    });

    const first = composable.executeAction(localNode, action, {
      reloadContainers: false,
    });
    await nextTick();

    expect(composable.actionInProgress.value.has('container-1')).toBe(true);

    const second = composable.executeAction(remoteNode, action, {
      reloadContainers: false,
    });
    await nextTick();

    expect(action).toHaveBeenCalledTimes(2);
    expect(composable.actionInProgress.value.has('container-2')).toBe(true);

    resolveFirst?.();
    resolveSecond?.();
    await Promise.all([first, second]);
  });

  it('keeps pending update state scoped to the targeted container when names collide across hosts', async () => {
    const localNode = makeContainer({
      id: 'container-1',
      identityKey: 'shared-agent::watcher-a::tdarr_node',
      name: 'tdarr_node',
      newTag: '2.0.0',
      server: 'shared-agent',
    });
    const remoteNode = makeContainer({
      id: 'container-2',
      identityKey: 'shared-agent::watcher-b::tdarr_node',
      name: 'tdarr_node',
      newTag: '2.0.0',
      server: 'shared-agent',
    });
    const { composable, containers, loadContainers } = await mountActionsHarness({
      containers: [localNode, remoteNode],
    });
    loadContainers.mockImplementation(async () => {
      containers.value = [remoteNode];
    });

    await composable.updateContainer(localNode);

    expect(composable.actionPending.value.has('container-1')).toBe(true);
    expect(composable.isContainerUpdateInProgress(localNode)).toBe(true);
    expect(composable.isContainerUpdateInProgress(remoteNode)).toBe(false);
  });

  it('matches pending replacement updates by identity key instead of another watcher behind the same agent', async () => {
    vi.useFakeTimers();
    const localNode = makeContainer({
      id: 'container-1',
      identityKey: 'shared-agent::watcher-a::docker-socket-proxy',
      name: 'docker-socket-proxy',
      newTag: '2.0.0',
      server: 'shared-agent',
      status: 'running',
    });
    const remoteNode = makeContainer({
      id: 'container-2',
      identityKey: 'shared-agent::watcher-b::docker-socket-proxy',
      name: 'docker-socket-proxy',
      newTag: '2.0.0',
      server: 'shared-agent',
      status: 'running',
    });
    const localReplacement = makeContainer({
      id: 'container-1-new',
      identityKey: localNode.identityKey,
      name: 'docker-socket-proxy',
      server: 'shared-agent',
      status: 'running',
    });
    const { composable, containers, loadContainers } = await mountActionsHarness({
      containers: [localNode, remoteNode],
    });
    // loadContainers is called during updateContainer's onAccepted; simulate localNode disappearing
    loadContainers.mockImplementation(async () => {
      containers.value = [remoteNode];
    });

    await composable.updateContainer(localNode);

    // localNode is gone; remoteNode has same name but different identityKey → still pending for localNode
    // Poll ticks prune against in-memory state — no loadContainers calls
    loadContainers.mockClear();
    for (let i = 0; i < 3; i += 1) {
      vi.advanceTimersByTime(PENDING_ACTIONS_POLL_INTERVAL_MS);
      await flushPromises();
    }
    expect(loadContainers).not.toHaveBeenCalled();

    expect(composable.actionPending.value.has('container-1')).toBe(true);
    expect(composable.isContainerUpdateInProgress(localNode)).toBe(true);
    expect(composable.isContainerUpdateInProgress(remoteNode)).toBe(false);

    // Simulate SSE patch: localReplacement appears with same identityKey as localNode
    containers.value = [remoteNode, localReplacement];
    await nextTick();

    // watch fires → identity key matched → lifecycle signal observed + settled
    expect(composable.actionPending.value.has('container-1')).toBe(false);
    expect(composable.isContainerUpdateInProgress(localNode)).toBe(false);
  });

  it('tracks queued containers during sequential group update', async () => {
    const proxyA = makeContainer({
      id: 'container-a',
      name: 'socket-proxy',
      newTag: '2.0.0',
      server: 'Datavault',
    });
    const proxyB = makeContainer({
      id: 'container-b',
      name: 'socket-proxy',
      newTag: '2.0.0',
      server: 'Tmvault',
    });
    const proxyC = makeContainer({
      id: 'container-c',
      name: 'socket-proxy',
      newTag: '2.0.0',
      server: 'Mediavault',
    });
    const { composable } = await mountActionsHarness({
      containers: [proxyA, proxyB, proxyC],
      containerIdMap: {
        'socket-proxy': 'container-a',
      },
    });

    let resolveBatch: (() => void) | undefined;
    mocks.updateContainers.mockImplementation(
      (containerIds: string[]) =>
        new Promise((resolve) => {
          resolveBatch = () =>
            resolve({
              message: 'Container update requests processed',
              accepted: containerIds.map((containerId) => ({
                containerId,
                containerName: containerId,
                operationId: `op-${containerId}`,
              })),
              rejected: [],
            });
        }),
    );

    const updatePromise = composable.updateAllInGroup({
      key: 'proxy-stack',
      containers: [proxyA, proxyB, proxyC],
    });
    await nextTick();

    expect(composable.isContainerUpdateInProgress(proxyA)).toBe(true);
    expect(composable.isContainerUpdateQueued(proxyB)).toBe(false);
    expect(composable.isContainerUpdateQueued(proxyC)).toBe(false);
    expect(composable.isContainerUpdateQueued(proxyA)).toBe(false);

    resolveBatch?.();
    await flushPromises();

    expect(composable.isContainerUpdateInProgress(proxyA)).toBe(true);
    expect(composable.isContainerUpdateQueued(proxyB)).toBe(false);
    expect(composable.isContainerUpdateQueued(proxyC)).toBe(false);
    expect(composable.isContainerUpdateQueued(proxyA)).toBe(false);
    await updatePromise;

    expect(useUpdateBatches().getBatch('proxy-stack')).toEqual({
      frozenTotal: 3,
      startedAt: expect.any(Number),
    });
  });

  it('keeps later group updates queued when requests resolve before the first refresh', async () => {
    const proxyA = makeContainer({
      id: 'container-a',
      name: 'socket-proxy',
      newTag: '2.0.0',
      server: 'Datavault',
    });
    const proxyB = makeContainer({
      id: 'container-b',
      name: 'socket-proxy',
      newTag: '2.0.0',
      server: 'Tmvault',
    });
    const proxyC = makeContainer({
      id: 'container-c',
      name: 'socket-proxy',
      newTag: '2.0.0',
      server: 'Mediavault',
    });
    const { composable, loadContainers } = await mountActionsHarness({
      containers: [proxyA, proxyB, proxyC],
      containerIdMap: {
        'socket-proxy': 'container-a',
      },
    });

    let resolveLoadContainers: (() => void) | undefined;
    loadContainers.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveLoadContainers = resolve;
        }),
    );
    mocks.updateContainers.mockResolvedValue({
      message: 'Container update requests processed',
      accepted: [
        { containerId: 'container-a', containerName: 'container-a', operationId: 'op-a' },
        { containerId: 'container-b', containerName: 'container-b', operationId: 'op-b' },
        { containerId: 'container-c', containerName: 'container-c', operationId: 'op-c' },
      ],
      rejected: [],
    });

    const updatePromise = composable.updateAllInGroup({
      key: 'proxy-stack',
      containers: [proxyA, proxyB, proxyC],
    });
    await flushPromises();

    expect(composable.isContainerUpdateInProgress(proxyA)).toBe(true);
    expect(composable.isContainerUpdateQueued(proxyA)).toBe(false);
    expect(composable.isContainerUpdateInProgress(proxyB)).toBe(false);
    expect(composable.isContainerUpdateQueued(proxyB)).toBe(false);
    expect(composable.isContainerUpdateInProgress(proxyC)).toBe(false);
    expect(composable.isContainerUpdateQueued(proxyC)).toBe(false);
    expect(useUpdateBatches().getBatch('proxy-stack')).toBeUndefined();

    resolveLoadContainers?.();
    await updatePromise;
  });

  it('falls back to timestamp-based batch ids when crypto.randomUUID is unavailable', async () => {
    const proxyA = makeContainer({
      id: 'container-a',
      name: 'socket-proxy-a',
      newTag: '2.0.0',
    });
    const proxyB = makeContainer({
      id: 'container-b',
      name: 'socket-proxy-b',
      newTag: '2.0.0',
    });
    const { composable } = await mountActionsHarness({
      containers: [proxyA, proxyB],
    });

    vi.stubGlobal('crypto', { randomUUID: undefined });
    try {
      await composable.updateAllInGroup({
        key: 'proxy-stack',
        containers: [proxyA, proxyB],
      });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(mocks.updateContainers).toHaveBeenCalledWith(['container-a', 'container-b']);
  });

  it('clears group update queue on error', async () => {
    const proxyA = makeContainer({
      id: 'container-a',
      name: 'socket-proxy',
      newTag: '2.0.0',
      server: 'Datavault',
    });
    const proxyB = makeContainer({
      id: 'container-b',
      name: 'socket-proxy',
      newTag: '2.0.0',
      server: 'Tmvault',
    });
    const { composable } = await mountActionsHarness({
      containers: [proxyA, proxyB],
      containerIdMap: {
        'socket-proxy': 'container-a',
      },
    });

    mocks.updateContainers.mockRejectedValue(new Error('update failed'));

    await composable.updateAllInGroup({
      key: 'proxy-stack',
      containers: [proxyA, proxyB],
    });

    expect(useUpdateBatches().getBatch('proxy-stack')).toBeUndefined();
  });

  it('returns false for isContainerUpdateQueued when target is a string', async () => {
    const { composable } = await mountActionsHarness({});
    expect(composable.isContainerUpdateQueued('some-container-name')).toBe(false);
  });

  it('returns false for malformed targets that do not resolve to a pending action identity', async () => {
    const { composable } = await mountActionsHarness({});

    expect(
      composable.isContainerUpdateInProgress({
        id: '',
        name: '',
        server: '',
        updateOperation: undefined,
      } as Container),
    ).toBe(false);
  });

  it('derives persisted queued and updating phases from backend operation status after reload', async () => {
    const proxyA = makeContainer({
      id: 'container-a',
      name: 'socket-proxy-a',
      newTag: null,
      updateOperation: {
        id: 'op-a',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:00.000Z',
        batchId: 'batch-1',
        queuePosition: 1,
        queueTotal: 2,
      },
    });
    const proxyB = makeContainer({
      id: 'container-b',
      name: 'socket-proxy-b',
      newTag: null,
      updateOperation: {
        id: 'op-b',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:00.000Z',
        batchId: 'batch-1',
        queuePosition: 2,
        queueTotal: 2,
      },
    });
    const { composable } = await mountActionsHarness({
      containers: [proxyA, proxyB],
      containerIdMap: {
        'socket-proxy-a': 'container-a',
        'socket-proxy-b': 'container-b',
      },
    });

    expect(composable.isContainerUpdateInProgress(proxyA)).toBe(false);
    expect(composable.isContainerUpdateQueued(proxyA)).toBe(true);
    expect(composable.isContainerUpdateInProgress(proxyB)).toBe(false);
    expect(composable.isContainerUpdateQueued(proxyB)).toBe(true);
  });

  it('treats a standalone queued update operation as updating when no other active update exists', async () => {
    const queued = makeContainer({
      id: 'container-a',
      name: 'socket-proxy-a',
      updateOperation: {
        id: 'op-a',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    });
    const { composable } = await mountActionsHarness({
      containers: [queued],
    });

    expect(composable.isContainerUpdateQueued(queued)).toBe(false);
    expect(composable.isContainerUpdateInProgress(queued)).toBe(true);
  });

  it('keeps a standalone queued update operation queued when another container is already updating', async () => {
    const updating = makeContainer({
      id: 'container-head',
      name: 'socket-proxy-head',
      updateOperation: {
        id: 'op-head',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    });
    const queued = makeContainer({
      id: 'container-a',
      name: 'socket-proxy-a',
      updateOperation: {
        id: 'op-a',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    });
    const { composable } = await mountActionsHarness({
      containers: [updating, queued],
    });

    expect(composable.isContainerUpdateQueued(queued)).toBe(true);
    expect(composable.isContainerUpdateInProgress(queued)).toBe(false);
  });

  it('treats a held terminal operation as updating and keeps later queued work queued', async () => {
    vi.useFakeTimers();
    const held = makeContainer({
      id: 'container-head',
      name: 'socket-proxy-head',
    });
    const queued = makeContainer({
      id: 'container-a',
      name: 'socket-proxy-a',
      updateOperation: {
        id: 'op-a',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:01.000Z',
      },
    });
    const { composable, containers } = await mountActionsHarness({
      containers: [held, queued],
    });
    const { holdOperationDisplay, scheduleHeldOperationRelease } = useOperationDisplayHold();

    holdOperationDisplay({
      operationId: 'op-head',
      containerId: 'container-head',
      containerName: 'socket-proxy-head',
      operation: {
        id: 'op-head',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    });
    scheduleHeldOperationRelease({ operationId: 'op-head' });

    containers.value = [makeContainer({ id: 'container-head', name: 'socket-proxy-head' }), queued];
    await flushPromises();

    expect(composable.isContainerUpdateInProgress(containers.value[0]!)).toBe(true);
    expect(composable.isContainerUpdateQueued(containers.value[0]!)).toBe(false);
    expect(composable.isContainerUpdateQueued(queued)).toBe(true);
    expect(composable.isContainerUpdateInProgress(queued)).toBe(false);

    vi.advanceTimersByTime(OPERATION_DISPLAY_HOLD_MS);
    await flushPromises();

    expect(composable.isContainerUpdateInProgress(containers.value[0]!)).toBe(false);
    expect(composable.isContainerUpdateQueued(queued)).toBe(false);
    expect(composable.isContainerUpdateInProgress(queued)).toBe(true);
  });

  it('keeps a standalone queued update operation queued when a persisted batch head already owns the slot', async () => {
    const persistedBatchHead = makeContainer({
      id: 'container-head',
      name: 'socket-proxy-head',
      updateOperation: {
        id: 'op-head',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:00.000Z',
        batchId: 'batch-1',
        queuePosition: 1,
        queueTotal: 2,
      },
    });
    const standaloneQueued = makeContainer({
      id: 'container-a',
      name: 'socket-proxy-a',
      updateOperation: {
        id: 'op-a',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:01.000Z',
      },
    });
    const { composable } = await mountActionsHarness({
      containers: [persistedBatchHead, standaloneQueued],
    });

    expect(composable.isContainerUpdateInProgress(persistedBatchHead)).toBe(false);
    expect(composable.isContainerUpdateQueued(persistedBatchHead)).toBe(true);
    expect(composable.isContainerUpdateQueued(standaloneQueued)).toBe(true);
    expect(composable.isContainerUpdateInProgress(standaloneQueued)).toBe(false);
  });

  it('treats only the oldest standalone queued update operation as updating before any active update exists', async () => {
    const queuedHead = makeContainer({
      id: 'container-head',
      name: 'socket-proxy-head',
      updateOperation: {
        id: 'op-head',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    });
    const queuedTail = makeContainer({
      id: 'container-tail',
      name: 'socket-proxy-tail',
      updateOperation: {
        id: 'op-tail',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:01.000Z',
      },
    });
    const { composable } = await mountActionsHarness({
      containers: [queuedTail, queuedHead],
    });

    expect(composable.isContainerUpdateQueued(queuedHead)).toBe(false);
    expect(composable.isContainerUpdateInProgress(queuedHead)).toBe(true);
    expect(composable.isContainerUpdateQueued(queuedTail)).toBe(true);
    expect(composable.isContainerUpdateInProgress(queuedTail)).toBe(false);
  });

  it('treats targets carrying their own in-progress operation as updating', async () => {
    const ghost = makeContainer({
      id: 'ghost-a',
      name: 'ghost-proxy-a',
      updateOperation: {
        id: 'op-ghost-a',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-01T12:00:00.000Z',
      },
    });
    const { composable } = await mountActionsHarness({
      containers: [],
    });

    expect(composable.isContainerUpdateInProgress(ghost)).toBe(true);
    expect(composable.isContainerUpdateQueued(ghost)).toBe(false);
  });

  it('ignores queued sequence entries from other groups when determining a local queue head', async () => {
    const proxyA = makeContainer({
      id: 'container-a',
      name: 'socket-proxy-a',
      newTag: '2.0.0',
    });
    const proxyB = makeContainer({
      id: 'container-b',
      name: 'socket-proxy-b',
      newTag: '2.0.0',
    });
    const worker = makeContainer({
      id: 'container-c',
      name: 'worker',
      newTag: '2.0.0',
    });
    const { composable } = await mountActionsHarness({
      containers: [proxyA, proxyB, worker],
    });

    const resolvers: Array<() => void> = [];
    mocks.updateContainer.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const proxyUpdatePromise = composable.updateAllInGroup({
      key: 'proxy-stack',
      containers: [proxyA, proxyB],
    });
    await nextTick();

    const workerUpdatePromise = composable.updateAllInGroup({
      key: 'worker-stack',
      containers: [worker],
    });
    await nextTick();

    expect(composable.isContainerUpdateInProgress(proxyA)).toBe(true);
    expect(composable.isContainerUpdateQueued(proxyB)).toBe(false);
    expect(composable.isContainerUpdateInProgress(worker)).toBe(true);

    resolvers[0]?.();
    await flushPromises();
    resolvers[1]?.();
    await flushPromises();
    resolvers[2]?.();

    await Promise.all([proxyUpdatePromise, workerUpdatePromise]);
  });

  it('keeps standalone queued updates queued while a local bulk-update head is active', async () => {
    const proxyA = makeContainer({
      id: 'container-a',
      name: 'socket-proxy-a',
      newTag: '2.0.0',
    });
    const proxyB = makeContainer({
      id: 'container-b',
      name: 'socket-proxy-b',
      newTag: '2.0.0',
    });
    const standaloneQueued = makeContainer({
      id: 'container-c',
      name: 'socket-proxy-c',
      updateOperation: {
        id: 'op-c',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:01.000Z',
      },
    });
    const { composable } = await mountActionsHarness({
      containers: [proxyA, proxyB, standaloneQueued],
    });

    const resolvers: Array<() => void> = [];
    mocks.updateContainer.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const proxyUpdatePromise = composable.updateAllInGroup({
      key: 'proxy-stack',
      containers: [proxyA, proxyB],
    });
    await nextTick();

    expect(composable.isContainerUpdateInProgress(proxyA)).toBe(true);
    expect(composable.isContainerUpdateQueued(proxyB)).toBe(false);
    expect(composable.isContainerUpdateQueued(standaloneQueued)).toBe(true);
    expect(composable.isContainerUpdateInProgress(standaloneQueued)).toBe(false);

    resolvers[0]?.();
    await flushPromises();
    resolvers[1]?.();
    await proxyUpdatePromise;
  });

  it('prefers in-progress persisted batch entries when choosing the head position', async () => {
    const queued = makeContainer({
      id: 'container-a',
      name: 'socket-proxy-a',
      updateOperation: {
        id: 'op-a',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:00.000Z',
        batchId: 'batch-1',
        queuePosition: 1,
        queueTotal: 2,
      },
    });
    const inProgress = makeContainer({
      id: 'container-b',
      name: 'socket-proxy-b',
      updateOperation: {
        id: 'op-b',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-01T12:00:00.000Z',
        batchId: 'batch-1',
        queuePosition: 2,
        queueTotal: 2,
      },
    });
    const { composable } = await mountActionsHarness({
      containers: [queued, inProgress],
    });

    expect(composable.isContainerUpdateQueued(queued)).toBe(true);
    expect(composable.isContainerUpdateQueued(inProgress)).toBe(false);
  });

  it('keeps the earliest in-progress persisted batch entry as the head position', async () => {
    const inProgressHead = makeContainer({
      id: 'container-a',
      name: 'socket-proxy-a',
      updateOperation: {
        id: 'op-a',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-01T12:00:00.000Z',
        batchId: 'batch-1',
        queuePosition: 1,
        queueTotal: 3,
      },
    });
    const inProgressLater = makeContainer({
      id: 'container-b',
      name: 'socket-proxy-b',
      updateOperation: {
        id: 'op-b',
        status: 'in-progress',
        phase: 'health-gate',
        updatedAt: '2026-04-01T12:00:00.000Z',
        batchId: 'batch-1',
        queuePosition: 2,
        queueTotal: 3,
      },
    });
    const queued = makeContainer({
      id: 'container-c',
      name: 'socket-proxy-c',
      updateOperation: {
        id: 'op-c',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:00.000Z',
        batchId: 'batch-1',
        queuePosition: 3,
        queueTotal: 3,
      },
    });
    const { composable } = await mountActionsHarness({
      containers: [inProgressHead, inProgressLater, queued],
    });

    expect(composable.isContainerUpdateInProgress(inProgressHead)).toBe(true);
    expect(composable.isContainerUpdateInProgress(inProgressLater)).toBe(true);
    expect(composable.isContainerUpdateQueued(queued)).toBe(true);
  });

  it('ignores unrelated persisted batch entries when determining queued state', async () => {
    const head = makeContainer({
      id: 'container-head',
      name: 'socket-proxy-head',
      updateOperation: {
        id: 'op-head',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:00.000Z',
        batchId: 'batch-1',
        queuePosition: 1,
        queueTotal: 2,
      },
    });
    const queued = makeContainer({
      id: 'container-a',
      name: 'socket-proxy-a',
      updateOperation: {
        id: 'op-a',
        status: 'queued',
        phase: 'queued',
        updatedAt: '2026-04-01T12:00:00.000Z',
        batchId: 'batch-1',
        queuePosition: 2,
        queueTotal: 2,
      },
    });
    const otherBatch = makeContainer({
      id: 'container-b',
      name: 'socket-proxy-b',
      updateOperation: {
        id: 'op-b',
        status: 'in-progress',
        phase: 'pulling',
        updatedAt: '2026-04-01T12:00:00.000Z',
        batchId: 'batch-2',
        queuePosition: 1,
        queueTotal: 1,
      },
    });
    const noSequence = makeContainer({
      id: 'container-c',
      name: 'socket-proxy-c',
    });
    const { composable } = await mountActionsHarness({
      containers: [head, queued, otherBatch, noSequence],
    });

    expect(composable.isContainerUpdateInProgress(head)).toBe(false);
    expect(composable.isContainerUpdateQueued(head)).toBe(true);
    expect(composable.isContainerUpdateQueued(queued)).toBe(true);
  });

  it('clears pending action state when the stored snapshot no longer has an id', async () => {
    vi.useFakeTimers();
    const web = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, containers, loadContainers } = await mountActionsHarness({
      containers: [web],
      containerIdMap: { web: 'container-1' },
    });
    // loadContainers is called during startContainer's onAccepted; simulate container disappearing
    loadContainers.mockImplementation(async () => {
      containers.value = [];
    });

    await composable.startContainer('web');
    expect(composable.actionPending.value.has('web')).toBe(true);

    // Replace snapshot with one that has an empty id (but valid identityKey ::local::web)
    composable.actionPending.value.set('web', makeContainer({ id: '', name: 'web' }));

    // Simulate SSE patch: container reappears — prune finds it by identityKey and clears pending
    containers.value = [makeContainer({ id: 'container-1', name: 'web' })];
    await nextTick();

    expect(composable.actionPending.value.has('web')).toBe(false);
  });

  it('times out malformed pending-action identities that cannot be re-matched during polling', async () => {
    vi.useFakeTimers();
    const web = makeContainer({ id: 'container-1', name: 'web' });
    const malformedSnapshot = makeContainer({ id: '', name: '', server: '' });
    const { composable, containers, loadContainers } = await mountActionsHarness({
      containers: [web],
      containerIdMap: { web: 'container-1' },
    });
    loadContainers.mockImplementation(async () => {
      containers.value = [makeContainer({ id: '', name: '', server: '' })];
    });

    await composable.startContainer('web');
    composable.actionPending.value.set('web', malformedSnapshot);

    vi.advanceTimersByTime(30001);
    await flushPromises();

    expect(composable.actionPending.value.has('web')).toBe(false);
  });

  it('clears pending action state when the stored snapshot entry disappears before polling', async () => {
    vi.useFakeTimers();
    const web = makeContainer({ id: 'container-1', name: 'web' });
    const { composable, loadContainers } = await mountActionsHarness({
      containers: [web],
      containerIdMap: { web: 'container-1' },
    });
    loadContainers.mockResolvedValue(undefined);

    await composable.startContainer('web');
    composable.actionPending.value.delete('web');

    vi.advanceTimersByTime(PENDING_ACTIONS_POLL_INTERVAL_MS);
    await flushPromises();
    expect(loadContainers).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(PENDING_ACTIONS_POLL_INTERVAL_MS);
    await flushPromises();

    expect(loadContainers).toHaveBeenCalledTimes(1);
  });

  it('prunes timed-out pending actions when the snapshot entry is missing', () => {
    const actionPending = ref(new Map<string, Container>());
    const actionPendingStartTimes = ref(new Map<string, number>([['web', 0]]));
    const actionPendingLifecycleModes = ref(new Map([['web', 'presence' as const]]));
    const actionPendingLifecycleObserved = ref(new Set<string>());
    const stopPendingActionsPolling = vi.fn();

    prunePendingActionsState({
      now: PENDING_ACTIONS_POLL_INTERVAL_MS + 1,
      containers: ref([]),
      actionPending,
      actionPendingStartTimes,
      actionPendingLifecycleModes,
      actionPendingLifecycleObserved,
      pollTimeout: 0,
      stopPendingActionsPolling,
    });

    expect(actionPendingStartTimes.value.has('web')).toBe(false);
    expect(stopPendingActionsPolling).toHaveBeenCalledTimes(1);
  });

  it('ignores live containers that have neither action nor identity keys', () => {
    const snapshot = makeContainer({
      id: 'container-1',
      name: 'web',
      identityKey: 'local::docker::web',
    });
    const liveContainer = makeContainer({
      id: '',
      name: '',
      identityKey: '',
    });
    const actionPending = ref(new Map<string, Container>([['web', snapshot]]));
    const actionPendingStartTimes = ref(new Map<string, number>([['web', 0]]));
    const actionPendingLifecycleModes = ref(new Map([['web', 'presence' as const]]));
    const actionPendingLifecycleObserved = ref(new Set<string>());
    const stopPendingActionsPolling = vi.fn();

    prunePendingActionsState({
      now: 1,
      containers: ref([liveContainer]),
      actionPending,
      actionPendingStartTimes,
      actionPendingLifecycleModes,
      actionPendingLifecycleObserved,
      pollTimeout: PENDING_ACTIONS_POLL_INTERVAL_MS,
      stopPendingActionsPolling,
    });

    expect(actionPending.value.has('web')).toBe(true);
    expect(actionPendingStartTimes.value.has('web')).toBe(true);
    expect(stopPendingActionsPolling).not.toHaveBeenCalled();
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
