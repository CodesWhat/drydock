import { computed, type Ref, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useToast } from '../../composables/useToast';
import { updateContainerPolicy } from '../../services/container';
import type { Container } from '../../types/container';
import { errorMessage } from '../../utils/error';
import {
  DEFAULT_MATURITY_MIN_AGE_DAYS,
  MATURITY_MIN_AGE_DAYS_MAX,
  MATURITY_MIN_AGE_DAYS_MIN,
  maturityMinAgeDaysToMilliseconds,
  normalizeMaturityMode,
  parseMaturityMinAgeDays,
  resolveMaturityMinAgeDays,
} from '../../utils/maturity-policy';

type ContainerListPolicyState = {
  snoozed: boolean;
  skipped: boolean;
  skipCount: number;
  snoozeUntil?: string;
  maturityBlocked: boolean;
  updateDetectedAt?: string;
} & (
  | {
      maturityMode?: undefined;
      maturityMinAgeDays?: undefined;
    }
  | {
      maturityMode: 'all' | 'mature';
      maturityMinAgeDays: number;
    }
);

type ContainerPolicyTarget = string | Pick<Container, 'id' | 'name'>;
type DeclarativePolicyField = 'maturityMode' | 'maturityMinAgeDays' | 'skipTags' | 'skipDigests';

const DECLARATIVE_POLICY_FIELDS: DeclarativePolicyField[] = [
  'maturityMode',
  'maturityMinAgeDays',
  'skipTags',
  'skipDigests',
];

interface UseContainerPolicyInput {
  selectedContainer: Readonly<Ref<Container | null | undefined>>;
  containerMetaMap: Readonly<Ref<Record<string, unknown>>>;
  containerIdMap: Readonly<Ref<Record<string, string>>>;
  loadContainers: () => Promise<void>;
  skippedUpdates: Ref<Set<string>>;
  containerActionsEnabled: Readonly<Ref<boolean>>;
  containerActionsDisabledReason: Readonly<Ref<string>>;
  refreshActionTabData: () => Promise<void>;
}

const EMPTY_CONTAINER_POLICY_STATE: ContainerListPolicyState = {
  snoozed: false,
  skipped: false,
  skipCount: 0,
  maturityBlocked: false,
};

function toDateInputValue(timestamp: string | undefined): string {
  if (!timestamp) {
    return '';
  }
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveSnoozeUntilFromInput(dateInput: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    return undefined;
  }
  const parsed = new Date(`${dateInput}T23:59:59`);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

function normalizePolicyEntries(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function normalizeUpdateDetectedAt(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return undefined;
  }
  return new Date(parsed).toISOString();
}

function resolveContainerPolicyTargetKey(target: ContainerPolicyTarget): string {
  if (typeof target === 'string') {
    return target;
  }
  return target.id || target.name;
}

function resolveContainerPolicyMeta(
  containerMetaMap: Record<string, unknown>,
  target: ContainerPolicyTarget,
): unknown {
  if (typeof target === 'string') {
    return containerMetaMap[target];
  }
  return containerMetaMap[target.id] ?? containerMetaMap[target.name];
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function isSuppressedUpdateKind(value: unknown): value is 'tag' | 'digest' {
  return value === 'tag' || value === 'digest';
}

function hasSuppressedUpdateCandidate(metaRecord: Record<string, unknown>): boolean {
  if (metaRecord.updateAvailable !== false) {
    return false;
  }
  const updateKind = asRecord(metaRecord.updateKind);
  return isSuppressedUpdateKind(updateKind?.kind);
}

function buildContainerListPolicyStateFromPolicy(
  metaRecord: Record<string, unknown>,
  policy: Record<string, unknown>,
): ContainerListPolicyState {
  const skipCount =
    normalizePolicyEntries(policy.skipTags).length +
    normalizePolicyEntries(policy.skipDigests).length;
  const maturityMode = normalizeMaturityMode(policy.maturityMode);
  const maturityMinAgeDays = resolveMaturityMinAgeDays(policy.maturityMinAgeDays);
  const updateDetectedAt = normalizeUpdateDetectedAt(metaRecord.updateDetectedAt);
  const updateDetectedAtMs = updateDetectedAt ? Date.parse(updateDetectedAt) : Number.NaN;
  const rawSnoozeUntil = typeof policy.snoozeUntil === 'string' ? policy.snoozeUntil : undefined;
  const snoozeUntilMs = rawSnoozeUntil ? new Date(rawSnoozeUntil).getTime() : Number.NaN;
  const snoozed = Number.isFinite(snoozeUntilMs) && snoozeUntilMs > Date.now();
  const maturityBlocked =
    maturityMode === 'mature' &&
    hasSuppressedUpdateCandidate(metaRecord) &&
    (!Number.isFinite(updateDetectedAtMs) ||
      Date.now() - updateDetectedAtMs < maturityMinAgeDaysToMilliseconds(maturityMinAgeDays));

  if (!snoozed && skipCount === 0 && !maturityMode) {
    return EMPTY_CONTAINER_POLICY_STATE;
  }

  const state: ContainerListPolicyState = {
    snoozed,
    skipped: skipCount > 0,
    skipCount,
    snoozeUntil: snoozed ? rawSnoozeUntil : undefined,
    ...(updateDetectedAt ? { updateDetectedAt } : {}),
    maturityBlocked,
  };

  if (!maturityMode) {
    return state;
  }

  return {
    ...state,
    maturityMode,
    maturityMinAgeDays,
  };
}

function deriveContainerListPolicyState(meta: unknown): ContainerListPolicyState {
  const metaRecord = asRecord(meta);
  if (!metaRecord) {
    return EMPTY_CONTAINER_POLICY_STATE;
  }
  const policy = asRecord(metaRecord.updatePolicy);
  if (!policy) {
    return EMPTY_CONTAINER_POLICY_STATE;
  }
  return buildContainerListPolicyStateFromPolicy(metaRecord, policy);
}

type PolicyTranslateFn = (key: string, params?: Record<string, unknown>) => string;

function formatPolicyEntryCount(skipCount: number, t: PolicyTranslateFn): string {
  return skipCount === 1
    ? t('containerComponents.policy.entryCountSingular', { count: skipCount })
    : t('containerComponents.policy.entryCountPlural', { count: skipCount });
}

function buildSnoozedPolicyTooltip(state: ContainerListPolicyState, t: PolicyTranslateFn): string {
  return state.snoozeUntil
    ? t('containerComponents.policy.tooltips.snoozedUntil', {
        date: new Date(state.snoozeUntil).toLocaleString(),
      })
    : t('containerComponents.policy.tooltips.snoozed');
}

function buildMaturityPolicyTooltip(state: ContainerListPolicyState, t: PolicyTranslateFn): string {
  if (state.maturityMode === 'mature') {
    const minAgeDays = state.maturityMinAgeDays;
    if (state.maturityBlocked) {
      return minAgeDays === 1
        ? t('containerComponents.policy.tooltips.maturityBlockedSingular', { days: minAgeDays })
        : t('containerComponents.policy.tooltips.maturityBlockedPlural', { days: minAgeDays });
    }
    return minAgeDays === 1
      ? t('containerComponents.policy.tooltips.maturityActiveSingular', { days: minAgeDays })
      : t('containerComponents.policy.tooltips.maturityActivePlural', { days: minAgeDays });
  }
  if (state.maturityMode === 'all') {
    return t('containerComponents.policy.tooltips.maturityAllowAll');
  }
  return t('containerComponents.policy.tooltips.maturityGeneric');
}

function buildSkippedPolicyTooltip(state: ContainerListPolicyState, t: PolicyTranslateFn): string {
  if (state.skipCount <= 0) {
    return t('containerComponents.policy.tooltips.skippedGeneric');
  }
  return t('containerComponents.policy.tooltips.skippedWithCount', {
    count: formatPolicyEntryCount(state.skipCount, t),
  });
}

function buildContainerPolicyTooltip(
  state: ContainerListPolicyState,
  kind: 'snoozed' | 'skipped' | 'maturity',
  t: PolicyTranslateFn,
): string {
  if (kind === 'snoozed') {
    return buildSnoozedPolicyTooltip(state, t);
  }
  if (kind === 'maturity') {
    return buildMaturityPolicyTooltip(state, t);
  }
  return buildSkippedPolicyTooltip(state, t);
}

async function runForSelectedContainer(
  selectedContainer: Readonly<Ref<Container | null | undefined>>,
  run: (container: Pick<Container, 'id' | 'name'>) => Promise<void>,
) {
  const container = selectedContainer.value;
  if (!container) {
    return;
  }
  await run(container);
}

async function applyPolicyState(args: {
  containerActionsEnabled: boolean;
  containerActionsDisabledReason: string;
  containerIdMap: Record<string, string>;
  containerId?: string;
  name: string;
  action: string;
  payload: Record<string, unknown>;
  message: string;
  policyInProgress: Ref<string | null>;
  policyMessage: Ref<string | null>;
  policyError: Ref<string | null>;
  loadContainers: () => Promise<void>;
  t: PolicyTranslateFn;
}): Promise<boolean> {
  if (!args.containerActionsEnabled) {
    args.policyMessage.value = null;
    args.policyError.value = args.containerActionsDisabledReason;
    return false;
  }
  const containerId = args.containerId ?? args.containerIdMap[args.name];
  if (!containerId || args.policyInProgress.value) {
    return false;
  }
  args.policyInProgress.value = `${args.action}:${args.name}`;
  args.policyError.value = null;
  try {
    await updateContainerPolicy(containerId, args.action, args.payload);
    args.policyMessage.value = args.message;
    const toast = useToast();
    toast.success(args.message);
    await args.loadContainers();
    return true;
  } catch (e: unknown) {
    const msg = errorMessage(e, args.t('containerComponents.policy.toasts.failedDetail'));
    args.policyError.value = msg;
    const toast = useToast();
    toast.error(args.t('containerComponents.policy.toasts.failedTitle', { name: args.name }), msg);
    return false;
  } finally {
    args.policyInProgress.value = null;
  }
}

type SelectedPolicyActionsArgs = {
  selectedContainer: Readonly<Ref<Container | null | undefined>>;
  skippedUpdates: Ref<Set<string>>;
  applyPolicy: (
    target: ContainerPolicyTarget,
    action: string,
    payload: Record<string, unknown>,
    message: string,
  ) => Promise<boolean>;
  refreshActionTabData: () => Promise<void>;
  policyError: Ref<string | null>;
  snoozeDateInput: Ref<string>;
  maturityMinAgeDaysInput: Ref<number>;
  t: PolicyTranslateFn;
};

function createSkipCurrentForSelectedAction(args: SelectedPolicyActionsArgs) {
  return async function skipCurrentForSelected() {
    await runForSelectedContainer(args.selectedContainer, async (container) => {
      const applied = await args.applyPolicy(
        container,
        'skip-current',
        {},
        args.t('containerComponents.policy.toasts.skipped', { name: container.name }),
      );
      if (applied) {
        args.skippedUpdates.value.add(resolveContainerPolicyTargetKey(container));
        await args.refreshActionTabData();
      }
    });
  };
}

function createSnoozeSelectedAction(args: SelectedPolicyActionsArgs) {
  return async function snoozeSelected(days: number) {
    await runForSelectedContainer(args.selectedContainer, async (container) => {
      await args.applyPolicy(
        container,
        'snooze',
        { days },
        days === 1
          ? args.t('containerComponents.policy.toasts.snoozedSingular', { days })
          : args.t('containerComponents.policy.toasts.snoozedPlural', { days }),
      );
    });
  };
}

function createSnoozeSelectedUntilDateAction(args: SelectedPolicyActionsArgs) {
  return async function snoozeSelectedUntilDate() {
    const snoozeUntil = resolveSnoozeUntilFromInput(args.snoozeDateInput.value);
    if (!snoozeUntil) {
      args.policyError.value = args.t('containerComponents.policy.validation.snoozeDate');
      return;
    }
    await runForSelectedContainer(args.selectedContainer, async (container) => {
      await args.applyPolicy(
        container,
        'snooze',
        { snoozeUntil },
        args.t('containerComponents.policy.toasts.snoozedUntil', {
          date: args.snoozeDateInput.value,
        }),
      );
    });
  };
}

function createUnsnoozeSelectedAction(args: SelectedPolicyActionsArgs) {
  return async function unsnoozeSelected() {
    await runForSelectedContainer(args.selectedContainer, async (container) => {
      await args.applyPolicy(
        container,
        'unsnooze',
        {},
        args.t('containerComponents.policy.toasts.unsnooze'),
      );
    });
  };
}

function createClearSkipsSelectedAction(args: SelectedPolicyActionsArgs) {
  return async function clearSkipsSelected() {
    await runForSelectedContainer(args.selectedContainer, async (container) => {
      args.skippedUpdates.value.delete(resolveContainerPolicyTargetKey(container));
      await args.applyPolicy(
        container,
        'clear-skips',
        {},
        args.t('containerComponents.policy.toasts.clearSkips'),
      );
    });
  };
}

function createClearPolicySelectedAction(args: SelectedPolicyActionsArgs) {
  return async function clearPolicySelected() {
    await runForSelectedContainer(args.selectedContainer, async (container) => {
      args.skippedUpdates.value.delete(resolveContainerPolicyTargetKey(container));
      await args.applyPolicy(
        container,
        'clear',
        {},
        args.t('containerComponents.policy.toasts.clearPolicy'),
      );
    });
  };
}

function createSetMaturityPolicySelectedAction(args: SelectedPolicyActionsArgs) {
  return async function setMaturityPolicySelected(mode: 'all' | 'mature') {
    const minAgeDays = parseMaturityMinAgeDays(args.maturityMinAgeDaysInput.value);
    if (minAgeDays === undefined) {
      args.policyError.value = args.t('containerComponents.policy.validation.maturityAge', {
        min: MATURITY_MIN_AGE_DAYS_MIN,
        max: MATURITY_MIN_AGE_DAYS_MAX,
      });
      return;
    }
    await runForSelectedContainer(args.selectedContainer, async (container) => {
      await args.applyPolicy(
        container,
        'set-maturity-policy',
        { mode, minAgeDays },
        mode === 'mature'
          ? minAgeDays === 1
            ? args.t('containerComponents.policy.toasts.setMatureSingular', { days: minAgeDays })
            : args.t('containerComponents.policy.toasts.setMaturePlural', { days: minAgeDays })
          : args.t('containerComponents.policy.toasts.setAll'),
      );
    });
  };
}

function createClearMaturityPolicySelectedAction(args: SelectedPolicyActionsArgs) {
  return async function clearMaturityPolicySelected() {
    await runForSelectedContainer(args.selectedContainer, async (container) => {
      await args.applyPolicy(
        container,
        'clear-maturity-policy',
        {},
        args.t('containerComponents.policy.toasts.clearMaturity'),
      );
    });
  };
}

function createRevertPolicySelectedAction(args: SelectedPolicyActionsArgs) {
  return async function revertPolicySelected(field?: DeclarativePolicyField) {
    await runForSelectedContainer(args.selectedContainer, async (container) => {
      await args.applyPolicy(
        container,
        'revert-to-declarative',
        field ? { field } : {},
        field
          ? args.t('containerComponents.policy.toasts.revertField', { field })
          : args.t('containerComponents.policy.toasts.revertAll'),
      );
    });
  };
}

function createRemoveSkipSelectedAction(args: SelectedPolicyActionsArgs) {
  return async function removeSkipSelected(kind: 'tag' | 'digest', value: string) {
    if (!value) {
      return;
    }
    await runForSelectedContainer(args.selectedContainer, async (container) => {
      args.skippedUpdates.value.delete(resolveContainerPolicyTargetKey(container));
      await args.applyPolicy(
        container,
        'remove-skip',
        { kind, value },
        args.t('containerComponents.policy.toasts.removeSkip', { kind, value }),
      );
    });
  };
}

function createSelectedPolicyActions(args: SelectedPolicyActionsArgs) {
  const removeSkipSelected = createRemoveSkipSelectedAction(args);
  return {
    clearPolicySelected: createClearPolicySelectedAction(args),
    clearMaturityPolicySelected: createClearMaturityPolicySelectedAction(args),
    clearSkipsSelected: createClearSkipsSelectedAction(args),
    removeSkipDigestSelected: async (value: string) => removeSkipSelected('digest', value),
    removeSkipTagSelected: async (value: string) => removeSkipSelected('tag', value),
    revertPolicySelected: createRevertPolicySelectedAction(args),
    setMaturityPolicySelected: createSetMaturityPolicySelectedAction(args),
    skipCurrentForSelected: createSkipCurrentForSelectedAction(args),
    snoozeSelected: createSnoozeSelectedAction(args),
    snoozeSelectedUntilDate: createSnoozeSelectedUntilDateAction(args),
    unsnoozeSelected: createUnsnoozeSelectedAction(args),
  };
}

function createSelectedPolicyState(input: UseContainerPolicyInput) {
  const selectedPolicyMeta = computed<Record<string, unknown>>(() => {
    const selectedId = input.selectedContainer.value?.id;
    const selectedName = input.selectedContainer.value?.name;
    if (!selectedId && !selectedName) return {};
    return (
      asRecord(
        (selectedId ? input.containerMetaMap.value[selectedId] : undefined) ??
          (selectedName ? input.containerMetaMap.value[selectedName] : undefined),
      ) ?? {}
    );
  });
  const selectedUpdatePolicy = computed<Record<string, unknown>>(() => {
    return asRecord(selectedPolicyMeta.value.updatePolicy) ?? {};
  });

  const selectedPolicyOverrides = computed<Record<string, unknown>>(
    () => asRecord(selectedPolicyMeta.value.updatePolicyOverrides) ?? {},
  );
  const selectedPolicyDeclarative = computed<Record<string, unknown>>(
    () => asRecord(selectedPolicyMeta.value.updatePolicyDeclarative) ?? {},
  );
  const selectedPolicyOverrideFields = computed<Set<DeclarativePolicyField>>(
    () =>
      new Set(
        DECLARATIVE_POLICY_FIELDS.filter((field) =>
          Object.hasOwn(selectedPolicyOverrides.value, field),
        ),
      ),
  );
  const selectedPolicyOverriddenFields = computed<Set<DeclarativePolicyField>>(() => {
    const baseline: Record<DeclarativePolicyField, unknown> = {
      maturityMode: 'all',
      maturityMinAgeDays: DEFAULT_MATURITY_MIN_AGE_DAYS,
      skipTags: [],
      skipDigests: [],
    };
    for (const tierName of ['env', 'label']) {
      const tier = asRecord(selectedPolicyDeclarative.value[tierName]);
      for (const field of DECLARATIVE_POLICY_FIELDS) {
        if (tier && Object.hasOwn(tier, field)) baseline[field] = tier[field];
      }
    }
    const normalizeForComparison = (field: DeclarativePolicyField, value: unknown) => {
      if (field === 'maturityMode') return normalizeMaturityMode(value) ?? 'all';
      if (field === 'maturityMinAgeDays') return resolveMaturityMinAgeDays(value);
      return [...new Set(normalizePolicyEntries(value))].sort();
    };
    return new Set(
      [...selectedPolicyOverrideFields.value].filter(
        (field) =>
          JSON.stringify(normalizeForComparison(field, selectedPolicyOverrides.value[field])) !==
          JSON.stringify(normalizeForComparison(field, baseline[field])),
      ),
    );
  });

  const selectedSkipTags = computed<string[]>(() =>
    Array.isArray(selectedUpdatePolicy.value.skipTags) ? selectedUpdatePolicy.value.skipTags : [],
  );
  const selectedSkipDigests = computed<string[]>(() =>
    Array.isArray(selectedUpdatePolicy.value.skipDigests)
      ? selectedUpdatePolicy.value.skipDigests
      : [],
  );
  const selectedMaturityMode = computed<'all' | 'mature' | undefined>(() =>
    normalizeMaturityMode(selectedUpdatePolicy.value.maturityMode),
  );
  const selectedMaturityMinAgeDays = computed<number>(() =>
    resolveMaturityMinAgeDays(selectedUpdatePolicy.value.maturityMinAgeDays),
  );
  const selectedHasMaturityPolicy = computed<boolean>(
    () => selectedMaturityMode.value !== undefined,
  );
  const selectedSnoozeUntil = computed<string | undefined>(
    () => selectedUpdatePolicy.value.snoozeUntil as string | undefined,
  );

  const snoozeDateInput = ref('');
  const maturityModeInput = ref<'all' | 'mature'>('all');
  const maturityMinAgeDaysInput = ref<number>(DEFAULT_MATURITY_MIN_AGE_DAYS);

  watch(
    () => selectedSnoozeUntil.value,
    (snoozeUntil) => {
      snoozeDateInput.value = toDateInputValue(snoozeUntil);
    },
    { immediate: true },
  );

  watch(
    () => selectedMaturityMode.value,
    (mode) => {
      maturityModeInput.value = mode ?? 'all';
    },
    { immediate: true },
  );

  watch(
    () => selectedMaturityMinAgeDays.value,
    (minAgeDays) => {
      maturityMinAgeDaysInput.value = minAgeDays;
    },
    { immediate: true },
  );

  return {
    maturityMinAgeDaysInput,
    maturityModeInput,
    selectedHasMaturityPolicy,
    selectedMaturityMinAgeDays,
    selectedMaturityMode,
    selectedPolicyOverriddenFields,
    selectedPolicyOverrideFields,
    selectedSkipDigests,
    selectedSkipTags,
    selectedSnoozeUntil,
    selectedUpdatePolicy,
    snoozeDateInput,
  };
}

function createContainerPolicyStateAccessors(
  containerMetaMap: Readonly<Ref<Record<string, unknown>>>,
  t: PolicyTranslateFn,
) {
  const policyStateCache = new Map<
    string,
    {
      meta: unknown;
      state: ContainerListPolicyState;
    }
  >();
  let cachedMetaMapRef = containerMetaMap.value;

  function getContainerListPolicyState(target: ContainerPolicyTarget): ContainerListPolicyState {
    const currentMetaMap = containerMetaMap.value;
    if (currentMetaMap !== cachedMetaMapRef) {
      policyStateCache.clear();
      cachedMetaMapRef = currentMetaMap;
    }

    const key = resolveContainerPolicyTargetKey(target);
    const currentMeta = resolveContainerPolicyMeta(currentMetaMap, target);
    const cached = policyStateCache.get(key);
    if (cached && cached.meta === currentMeta) {
      return cached.state;
    }

    const state = deriveContainerListPolicyState(currentMeta);
    policyStateCache.set(key, { meta: currentMeta, state });
    return state;
  }

  function containerPolicyTooltip(
    target: ContainerPolicyTarget,
    kind: 'snoozed' | 'skipped' | 'maturity',
  ): string {
    const state = getContainerListPolicyState(target);
    return buildContainerPolicyTooltip(state, kind, t);
  }

  return {
    containerPolicyTooltip,
    getContainerListPolicyState,
  };
}

export function useContainerPolicy(input: UseContainerPolicyInput) {
  const { t } = useI18n();
  const policyInProgress = ref<string | null>(null);
  const policyMessage = ref<string | null>(null);
  const policyError = ref<string | null>(null);

  async function applyPolicy(
    target: ContainerPolicyTarget,
    action: string,
    payload: Record<string, unknown> = {},
    message: string,
  ) {
    const name = typeof target === 'string' ? target : target.name;
    return applyPolicyState({
      containerActionsEnabled: input.containerActionsEnabled.value,
      containerActionsDisabledReason: input.containerActionsDisabledReason.value,
      containerIdMap: input.containerIdMap.value,
      containerId: typeof target === 'string' ? undefined : target.id,
      name,
      action,
      payload,
      message,
      policyInProgress,
      policyMessage,
      policyError,
      loadContainers: input.loadContainers,
      t,
    });
  }

  const {
    maturityMinAgeDaysInput,
    maturityModeInput,
    selectedHasMaturityPolicy,
    selectedMaturityMinAgeDays,
    selectedMaturityMode,
    selectedPolicyOverriddenFields,
    selectedPolicyOverrideFields,
    selectedSkipDigests,
    selectedSkipTags,
    selectedSnoozeUntil,
    selectedUpdatePolicy,
    snoozeDateInput,
  } = createSelectedPolicyState(input);

  const {
    clearPolicySelected,
    clearMaturityPolicySelected,
    clearSkipsSelected,
    removeSkipDigestSelected,
    removeSkipTagSelected,
    revertPolicySelected,
    setMaturityPolicySelected,
    skipCurrentForSelected,
    snoozeSelected,
    snoozeSelectedUntilDate,
    unsnoozeSelected,
  } = createSelectedPolicyActions({
    selectedContainer: input.selectedContainer,
    skippedUpdates: input.skippedUpdates,
    applyPolicy,
    refreshActionTabData: input.refreshActionTabData,
    policyError,
    snoozeDateInput,
    maturityMinAgeDaysInput,
    t,
  });

  function resetPolicyMessages() {
    policyMessage.value = null;
    policyError.value = null;
  }

  const { containerPolicyTooltip, getContainerListPolicyState } =
    createContainerPolicyStateAccessors(input.containerMetaMap, t);

  return {
    applyPolicy,
    clearPolicySelected,
    clearMaturityPolicySelected,
    clearSkipsSelected,
    containerPolicyTooltip,
    getContainerListPolicyState,
    maturityMinAgeDaysInput,
    maturityModeInput,
    policyError,
    policyInProgress,
    policyMessage,
    removeSkipDigestSelected,
    removeSkipTagSelected,
    revertPolicySelected,
    resetPolicyMessages,
    selectedHasMaturityPolicy,
    selectedMaturityMinAgeDays,
    selectedMaturityMode,
    selectedPolicyOverriddenFields,
    selectedPolicyOverrideFields,
    selectedSkipDigests,
    selectedSkipTags,
    selectedSnoozeUntil,
    selectedUpdatePolicy,
    setMaturityPolicySelected,
    skipCurrentForSelected,
    snoozeDateInput,
    snoozeSelected,
    snoozeSelectedUntilDate,
    unsnoozeSelected,
  };
}
