import { ref } from 'vue';
import ContainerSelectionBar from '@/components/containers/ContainerSelectionBar.vue';
import {
  resetContainerSelectionState,
  useContainerSelection,
} from '@/composables/useContainerSelection';
import { resetDependencyGraphState } from '@/composables/useDependencyGraph';
import type { Container } from '@/types/container';
import { mountWithPlugins } from '../../helpers/mount';

const mocked = vi.hoisted(() => ({
  context: null as any,
}));

vi.mock('@/components/containers/containersViewTemplateContext', () => ({
  useContainersViewTemplateContext: () => mocked.context,
}));

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'c-1',
    identityKey: 'c-1',
    name: 'alpha',
    image: 'nginx',
    icon: 'docker',
    currentTag: '1.0.0',
    newTag: null,
    status: 'running',
    registry: 'dockerhub',
    registryName: '',
    registryUrl: '',
    updateKind: null,
    bouncer: 'safe',
    server: 'local-main',
    isDigestPinned: false,
    details: { ports: [], volumes: [], env: [], labels: [] },
    ...overrides,
  } as Container;
}

function makeContext(overrides: Record<string, unknown> = {}) {
  const filteredContainers = ref<Container[]>([]);
  const containerActionsEnabled = ref(true);
  const confirmBulkUpdate = vi.fn();
  const context = {
    filteredContainers,
    containerActionsEnabled,
    confirmBulkUpdate,
    isContainerUpdateInProgress: () => false,
    isContainerUpdateQueued: () => false,
    isContainerRowLocked: () => false,
    updateMode: ref('manual'),
    ...overrides,
  } as any;

  return { context, filteredContainers, containerActionsEnabled, confirmBulkUpdate };
}

function mountBar() {
  return mountWithPlugins(ContainerSelectionBar);
}

function bar() {
  return document.body.querySelector('[data-test="container-selection-bar"]');
}

let activeWrapper: ReturnType<typeof mountBar> | null = null;

describe('ContainerSelectionBar', () => {
  beforeEach(() => {
    resetContainerSelectionState();
    resetDependencyGraphState();
  });

  afterEach(() => {
    activeWrapper?.unmount();
    activeWrapper = null;
    resetContainerSelectionState();
  });

  it('falls back to manual update mode when the context does not supply one', () => {
    const { context, filteredContainers } = makeContext({ updateMode: undefined });
    filteredContainers.value = [makeContainer({ newTag: '2.0.0' })];
    mocked.context = context;
    useContainerSelection().toggle('c-1');

    activeWrapper = mountBar();

    expect(bar()?.textContent).toContain('1 container selected');
  });

  it('renders nothing when nothing is selected', () => {
    mocked.context = makeContext().context;

    activeWrapper = mountBar();

    expect(bar()).toBeNull();
  });

  it('renders nothing when container actions are disabled, even with a selection', () => {
    const { context, containerActionsEnabled, filteredContainers } = makeContext();
    containerActionsEnabled.value = false;
    filteredContainers.value = [makeContainer({ newTag: '2.0.0' })];
    mocked.context = context;
    useContainerSelection().toggle('c-1');

    activeWrapper = mountBar();

    expect(bar()).toBeNull();
  });

  it('shows the selected count', () => {
    const { context, filteredContainers } = makeContext();
    filteredContainers.value = [makeContainer({ newTag: '2.0.0' })];
    mocked.context = context;
    useContainerSelection().toggle('c-1');

    activeWrapper = mountBar();

    expect(bar()?.textContent).toContain('1 container selected');
  });

  it('dispatches a plan with the selected ready container on Update', async () => {
    const { context, filteredContainers, confirmBulkUpdate } = makeContext();
    filteredContainers.value = [makeContainer({ newTag: '2.0.0' })];
    mocked.context = context;
    useContainerSelection().toggle('c-1');

    activeWrapper = mountBar();
    const updateBtn = bar()?.querySelector<HTMLButtonElement>(
      '[data-test="container-selection-update"]',
    );
    updateBtn?.click();
    await activeWrapper.vm.$nextTick();

    expect(confirmBulkUpdate).toHaveBeenCalledTimes(1);
    const plan = confirmBulkUpdate.mock.calls[0][0];
    expect(plan.dispatch.map((entry: { id: string }) => entry.id)).toEqual(['c-1']);
  });

  it('disables Update when nothing is dispatchable', () => {
    const { context, filteredContainers } = makeContext();
    filteredContainers.value = [makeContainer({ newTag: null })];
    mocked.context = context;
    useContainerSelection().toggle('c-1');

    activeWrapper = mountBar();
    const updateBtn = bar()?.querySelector<HTMLButtonElement>(
      '[data-test="container-selection-update"]',
    );

    expect(updateBtn?.disabled).toBe(true);
  });

  it('treats a bouncer-blocked row as blocked, not dispatchable', () => {
    const { context, filteredContainers } = makeContext();
    filteredContainers.value = [makeContainer({ newTag: '2.0.0', bouncer: 'blocked' })];
    mocked.context = context;
    useContainerSelection().toggle('c-1');

    activeWrapper = mountBar();
    const updateBtn = bar()?.querySelector<HTMLButtonElement>(
      '[data-test="container-selection-update"]',
    );

    expect(updateBtn?.disabled).toBe(true);
  });

  it('clears the selection on Clear', async () => {
    const { context, filteredContainers } = makeContext();
    filteredContainers.value = [makeContainer({ newTag: '2.0.0' })];
    mocked.context = context;
    const { toggle, count } = useContainerSelection();
    toggle('c-1');

    activeWrapper = mountBar();
    const clearBtn = bar()?.querySelector<HTMLButtonElement>(
      '[data-test="container-selection-clear"]',
    );
    clearBtn?.click();
    await activeWrapper.vm.$nextTick();

    expect(count.value).toBe(0);
    expect(bar()).toBeNull();
  });

  it('clears the selection on unmount', () => {
    const { context, filteredContainers } = makeContext();
    filteredContainers.value = [makeContainer({ newTag: '2.0.0' })];
    mocked.context = context;
    const { toggle, count } = useContainerSelection();
    toggle('c-1');

    activeWrapper = mountBar();
    activeWrapper.unmount();
    activeWrapper = null;

    expect(count.value).toBe(0);
  });
});
