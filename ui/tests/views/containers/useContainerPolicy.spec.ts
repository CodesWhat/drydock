import { effectScope, nextTick, ref } from 'vue';
import type { Container } from '@/types/container';
import { useContainerPolicy } from '@/views/containers/useContainerPolicy';

vi.mock('@/composables/useToast', () => ({
  useToast: () => ({
    toasts: { value: [] },
    addToast: vi.fn(),
    dismissToast: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('@/services/container', () => ({
  updateContainerPolicy: vi.fn(),
}));

function makeContainer(overrides: Partial<Container> = {}): Container {
  return {
    id: 'container-1',
    identityKey: '::local::web',
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

function createPolicyHarness(
  options: {
    containerActionsDisabledReason?: string;
    containerActionsEnabled?: boolean;
    containerIdMap?: Record<string, string>;
    containerMetaMap?: Record<string, unknown>;
    selectedContainer?: Container | null;
  } = {},
) {
  const scope = effectScope();
  const selectedContainer = ref<Container | null>(options.selectedContainer ?? null);
  const containerMetaMap = ref<Record<string, unknown>>(options.containerMetaMap ?? {});
  const containerIdMap = ref<Record<string, string>>(options.containerIdMap ?? {});
  const skippedUpdates = ref(new Set<string>());
  const containerActionsEnabled = ref(options.containerActionsEnabled ?? true);
  const containerActionsDisabledReason = ref(
    options.containerActionsDisabledReason ?? 'Actions are disabled',
  );
  const loadContainers = vi.fn().mockResolvedValue(undefined);
  const refreshActionTabData = vi.fn().mockResolvedValue(undefined);

  let composable: ReturnType<typeof useContainerPolicy> | undefined;
  scope.run(() => {
    composable = useContainerPolicy({
      selectedContainer,
      containerMetaMap,
      containerIdMap,
      loadContainers,
      skippedUpdates,
      containerActionsEnabled,
      containerActionsDisabledReason,
      refreshActionTabData,
    });
  });

  if (!composable) {
    throw new Error('Policy harness did not initialize');
  }

  return {
    composable,
    containerActionsDisabledReason,
    containerActionsEnabled,
    containerIdMap,
    containerMetaMap,
    loadContainers,
    refreshActionTabData,
    scope,
    selectedContainer,
    skippedUpdates,
  };
}

describe('useContainerPolicy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves policy state from a name-keyed meta entry and builds the expected tooltips', () => {
    const harness = createPolicyHarness({
      containerMetaMap: {
        web: {
          updateAvailable: false,
          updateDetectedAt: '2026-04-13T10:00:00.000Z',
          updateKind: { kind: 'digest' },
          updatePolicy: {
            maturityMode: 'all',
            skipTags: ['latest'],
            skipDigests: [],
            snoozeUntil: '2026-04-14T12:00:00.000Z',
          },
        },
      },
    });

    const state = harness.composable.getContainerListPolicyState({
      id: 'container-1',
      name: 'web',
    });

    expect(state).toEqual(
      expect.objectContaining({
        maturityBlocked: false,
        maturityMode: 'all',
        skipped: true,
        skipCount: 1,
        snoozed: true,
        snoozeUntil: '2026-04-14T12:00:00.000Z',
        updateDetectedAt: '2026-04-13T10:00:00.000Z',
      }),
    );
    expect(
      harness.composable.containerPolicyTooltip({ id: 'container-1', name: 'web' }, 'skipped'),
    ).toBe('Skipped updates policy active (1 entry)');
    expect(
      harness.composable.containerPolicyTooltip({ id: 'container-1', name: 'web' }, 'maturity'),
    ).toBe('Maturity policy allows all updates');

    harness.scope.stop();
  });

  it('uses the direct string key and does not mark maturity blocked when updateAvailable is not false', () => {
    const harness = createPolicyHarness({
      containerMetaMap: {
        digestOnly: {
          updateAvailable: true,
          updateDetectedAt: '2026-04-13T10:00:00.000Z',
          updateKind: { kind: 'digest' },
          updatePolicy: {
            maturityMode: 'mature',
            maturityMinAgeDays: 7,
          },
        },
      },
    });

    const state = harness.composable.getContainerListPolicyState('digestOnly');

    expect(state).toEqual(
      expect.objectContaining({
        maturityBlocked: false,
        maturityMode: 'mature',
        maturityMinAgeDays: 7,
      }),
    );
    expect(harness.composable.containerPolicyTooltip('digestOnly', 'maturity')).toBe(
      'Mature-only policy active (7 days minimum age)',
    );

    harness.scope.stop();
  });

  it('blocks mature-only updates when a suppressed digest update is still recent', () => {
    const harness = createPolicyHarness({
      containerMetaMap: {
        tagged: {
          updateAvailable: false,
          updateDetectedAt: '2026-04-13T10:00:00.000Z',
          updateKind: { kind: 'tag' },
          updatePolicy: {
            maturityMode: 'mature',
            maturityMinAgeDays: 7,
          },
        },
      },
    });

    const state = harness.composable.getContainerListPolicyState({
      id: 'container-2',
      name: 'tagged',
    });

    expect(state).toEqual(
      expect.objectContaining({
        maturityBlocked: true,
        maturityMode: 'mature',
        maturityMinAgeDays: 7,
      }),
    );
    expect(
      harness.composable.containerPolicyTooltip({ id: 'container-2', name: 'tagged' }, 'maturity'),
    ).toBe('Mature-only policy blocks updates younger than 7 days');

    harness.scope.stop();
  });

  it('syncs selected policy state from name and id lookups as the selection changes', async () => {
    const harness = createPolicyHarness({
      selectedContainer: makeContainer({ id: 'web-id', name: 'web' }),
      containerMetaMap: {
        web: {
          updatePolicy: {
            skipTags: ['latest'],
            skipDigests: ['sha256:abc'],
            snoozeUntil: '2026-04-14T12:00:00.000Z',
            maturityMode: 'mature',
            maturityMinAgeDays: 9,
          },
        },
        'api-id': {
          updatePolicy: {
            skipTags: [],
            skipDigests: ['sha256:def'],
            maturityMode: 'all',
            maturityMinAgeDays: 4,
          },
        },
      },
    });

    expect(harness.composable.selectedUpdatePolicy.value).toEqual(
      expect.objectContaining({
        skipTags: ['latest'],
        skipDigests: ['sha256:abc'],
        snoozeUntil: '2026-04-14T12:00:00.000Z',
        maturityMode: 'mature',
        maturityMinAgeDays: 9,
      }),
    );
    expect(harness.composable.selectedSkipTags.value).toEqual(['latest']);
    expect(harness.composable.selectedSkipDigests.value).toEqual(['sha256:abc']);
    expect(harness.composable.selectedSnoozeUntil.value).toBe('2026-04-14T12:00:00.000Z');
    expect(harness.composable.selectedMaturityMode.value).toBe('mature');
    expect(harness.composable.selectedHasMaturityPolicy.value).toBe(true);
    expect(harness.composable.selectedMaturityMinAgeDays.value).toBe(9);
    expect(harness.composable.snoozeDateInput.value).toBe('2026-04-14');
    expect(harness.composable.maturityModeInput.value).toBe('mature');
    expect(harness.composable.maturityMinAgeDaysInput.value).toBe(9);

    harness.selectedContainer.value = makeContainer({ id: 'api-id', name: 'api' });
    await nextTick();

    expect(harness.composable.selectedUpdatePolicy.value).toEqual(
      expect.objectContaining({
        skipTags: [],
        skipDigests: ['sha256:def'],
        maturityMode: 'all',
        maturityMinAgeDays: 4,
      }),
    );
    expect(harness.composable.selectedSkipTags.value).toEqual([]);
    expect(harness.composable.selectedSkipDigests.value).toEqual(['sha256:def']);
    expect(harness.composable.selectedSnoozeUntil.value).toBeUndefined();
    expect(harness.composable.selectedMaturityMode.value).toBe('all');
    expect(harness.composable.selectedHasMaturityPolicy.value).toBe(true);
    expect(harness.composable.selectedMaturityMinAgeDays.value).toBe(4);
    expect(harness.composable.snoozeDateInput.value).toBe('');
    expect(harness.composable.maturityModeInput.value).toBe('all');
    expect(harness.composable.maturityMinAgeDaysInput.value).toBe(4);

    harness.scope.stop();
  });
});
