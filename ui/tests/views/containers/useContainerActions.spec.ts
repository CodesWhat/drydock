import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { defineComponent, h, type Ref, ref } from 'vue';
import type { ApiContainerTrigger } from '@/types/api';
import type { Container } from '@/types/container';
import { useContainerActions } from '@/views/containers/useContainerActions';

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

  it('updates all eligible containers in a group', async () => {
    const c1 = makeContainer({ id: 'container-1', name: 'web', newTag: '1.1.0', bouncer: 'safe' });
    const c2 = makeContainer({
      id: 'container-2',
      name: 'api',
      newTag: '2.0.0',
      bouncer: 'blocked',
    });
    const c3 = makeContainer({ id: 'container-3', name: 'worker', newTag: null, bouncer: 'safe' });

    const { composable } = await mountActionsHarness({
      containers: [c1, c2, c3],
      containerIdMap: {
        web: 'container-1',
        api: 'container-2',
        worker: 'container-3',
      },
    });

    await composable.updateAllInGroup({
      key: 'group-1',
      containers: [c1, c2, c3],
    });

    expect(mocks.updateContainer).toHaveBeenCalledTimes(1);
    expect(mocks.updateContainer).toHaveBeenCalledWith('container-1');
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

    vi.advanceTimersByTime(2000);
    await flushPromises();

    expect(loadContainers).toHaveBeenCalledTimes(2);
    expect(composable.actionPending.value.has('web')).toBe(false);

    vi.advanceTimersByTime(4000);
    await flushPromises();
    expect(loadContainers).toHaveBeenCalledTimes(2);
  });
});
