import { computed, type Ref, ref, watch } from 'vue';
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

function deriveContainerListPolicyState(meta: unknown): ContainerListPolicyState {
  if (!meta || typeof meta !== 'object') {
    return EMPTY_CONTAINER_POLICY_STATE;
  }
  const metaRecord = meta as Record<string, unknown>;
  const updatePolicy = metaRecord.updatePolicy;
  if (!updatePolicy || typeof updatePolicy !== 'object') {
    return EMPTY_CONTAINER_POLICY_STATE;
  }

  const policy = updatePolicy as Record<string, unknown>;
  const skipCount =
    normalizePolicyEntries(policy.skipTags).length +
    normalizePolicyEntries(policy.skipDigests).length;
  const maturityMode = normalizeMaturityMode(policy.maturityMode);
  const maturityMinAgeDays = resolveMaturityMinAgeDays(policy.maturityMinAgeDays);
  const updateDetectedAt = normalizeUpdateDetectedAt(metaRecord.updateDetectedAt);
  const updateDetectedAtMs = updateDetectedAt ? Date.parse(updateDetectedAt) : Number.NaN;
  const hasSuppressedUpdateCandidate = Boolean(
    metaRecord.updateAvailable === false &&
      metaRecord.updateKind &&
      typeof metaRecord.updateKind === 'object' &&
      (metaRecord.updateKind as Record<string, unknown>).kind &&
      ((metaRecord.updateKind as Record<string, unknown>).kind === 'tag' ||
        (metaRecord.updateKind as Record<string, unknown>).kind === 'digest'),
  );

  const rawSnoozeUntil = typeof policy.snoozeUntil === 'string' ? policy.snoozeUntil : undefined;
  const snoozeUntilMs = rawSnoozeUntil ? new Date(rawSnoozeUntil).getTime() : Number.NaN;
  const snoozed = Number.isFinite(snoozeUntilMs) && snoozeUntilMs > Date.now();
  const maturityBlocked =
    maturityMode === 'mature' &&
    hasSuppressedUpdateCandidate &&
    (!Number.isFinite(updateDetectedAtMs) ||
      Date.now() - updateDetectedAtMs < maturityMinAgeDaysToMilliseconds(maturityMinAgeDays));

  if (!snoozed && skipCount === 0 && !maturityMode) {
    return EMPTY_CONTAINER_POLICY_STATE;
  }

  if (maturityMode) {
    return {
      snoozed,
      skipped: skipCount > 0,
      skipCount,
      snoozeUntil: snoozed ? rawSnoozeUntil : undefined,
      ...(updateDetectedAt ? { updateDetectedAt } : {}),
      maturityBlocked,
      maturityMode,
      maturityMinAgeDays,
    };
  }

  return {
    snoozed,
    skipped: skipCount > 0,
    skipCount,
    snoozeUntil: snoozed ? rawSnoozeUntil : undefined,
    ...(updateDetectedAt ? { updateDetectedAt } : {}),
    maturityBlocked,
  };
}

function buildContainerPolicyTooltip(
  state: ContainerListPolicyState,
  kind: 'snoozed' | 'skipped' | 'maturity',
): string {
  if (kind === 'snoozed') {
    return state.snoozeUntil
      ? `Updates snoozed until ${new Date(state.snoozeUntil).toLocaleString()}`
      : 'Updates snoozed';
  }
  if (kind === 'maturity') {
    if (state.maturityMode === 'mature') {
      const minAgeDays = state.maturityMinAgeDays;
      return state.maturityBlocked
        ? `Mature-only policy blocks updates younger than ${minAgeDays} day${minAgeDays === 1 ? '' : 's'}`
        : `Mature-only policy active (${minAgeDays} day${minAgeDays === 1 ? '' : 's'} minimum age)`;
    }
    if (state.maturityMode === 'all') {
      return 'Maturity policy allows all updates';
    }
    return 'Maturity policy active';
  }
  if (state.skipCount <= 0) {
    return 'Skipped updates policy active';
  }
  return `Skipped updates policy active (${state.skipCount} entr${state.skipCount === 1 ? 'y' : 'ies'})`;
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
    const msg = errorMessage(e, 'Failed to update policy');
    args.policyError.value = msg;
    const toast = useToast();
    toast.error(`Policy update failed: ${args.name}`, msg);
    return false;
  } finally {
    args.policyInProgress.value = null;
  }
}

function createSelectedPolicyActions(args: {
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
}) {
  async function skipCurrentForSelected() {
    await runForSelectedContainer(args.selectedContainer, async (container) => {
      const applied = await args.applyPolicy(
        container,
        'skip-current',
        {},
        `Skipped current update for ${container.name}`,
      );
      if (applied) {
        args.skippedUpdates.value.add(resolveContainerPolicyTargetKey(container));
        await args.refreshActionTabData();
      }
    });
  }

  async function snoozeSelected(days: number) {
    await runForSelectedContainer(args.selectedContainer, async (container) => {
      await args.applyPolicy(
        container,
        'snooze',
        { days },
        `Snoozed updates for ${days} day${days === 1 ? '' : 's'}`,
      );
    });
  }

  async function snoozeSelectedUntilDate() {
    const snoozeUntil = resolveSnoozeUntilFromInput(args.snoozeDateInput.value);
    if (!snoozeUntil) {
      args.policyError.value = 'Select a valid snooze date';
      return;
    }
    await runForSelectedContainer(args.selectedContainer, async (container) => {
      await args.applyPolicy(
        container,
        'snooze',
        { snoozeUntil },
        `Snoozed until ${args.snoozeDateInput.value}`,
      );
    });
  }

  async function unsnoozeSelected() {
    await runForSelectedContainer(args.selectedContainer, async (container) => {
      await args.applyPolicy(container, 'unsnooze', {}, 'Snooze cleared');
    });
  }

  async function clearSkipsSelected() {
    await runForSelectedContainer(args.selectedContainer, async (container) => {
      args.skippedUpdates.value.delete(resolveContainerPolicyTargetKey(container));
      await args.applyPolicy(container, 'clear-skips', {}, 'Skipped updates cleared');
    });
  }

  async function clearPolicySelected() {
    await runForSelectedContainer(args.selectedContainer, async (container) => {
      args.skippedUpdates.value.delete(resolveContainerPolicyTargetKey(container));
      await args.applyPolicy(container, 'clear', {}, 'Update policy cleared');
    });
  }

  async function setMaturityPolicySelected(mode: 'all' | 'mature') {
    const minAgeDays = parseMaturityMinAgeDays(args.maturityMinAgeDaysInput.value);
    if (minAgeDays === undefined) {
      args.policyError.value = `Enter a maturity age between ${MATURITY_MIN_AGE_DAYS_MIN} and ${MATURITY_MIN_AGE_DAYS_MAX} days`;
      return;
    }
    await runForSelectedContainer(args.selectedContainer, async (container) => {
      await args.applyPolicy(
        container,
        'set-maturity-policy',
        { mode, minAgeDays },
        mode === 'mature'
          ? `Maturity policy set to mature-only (${minAgeDays} day${minAgeDays === 1 ? '' : 's'})`
          : 'Maturity policy set to allow all updates',
      );
    });
  }

  async function clearMaturityPolicySelected() {
    await runForSelectedContainer(args.selectedContainer, async (container) => {
      await args.applyPolicy(container, 'clear-maturity-policy', {}, 'Maturity policy cleared');
    });
  }

  async function removeSkipSelected(kind: 'tag' | 'digest', value: string) {
    if (!value) {
      return;
    }
    await runForSelectedContainer(args.selectedContainer, async (container) => {
      args.skippedUpdates.value.delete(resolveContainerPolicyTargetKey(container));
      await args.applyPolicy(
        container,
        'remove-skip',
        { kind, value },
        `Removed skipped ${kind} ${value}`,
      );
    });
  }

  async function removeSkipTagSelected(value: string) {
    await removeSkipSelected('tag', value);
  }

  async function removeSkipDigestSelected(value: string) {
    await removeSkipSelected('digest', value);
  }

  return {
    clearPolicySelected,
    clearMaturityPolicySelected,
    clearSkipsSelected,
    removeSkipDigestSelected,
    removeSkipTagSelected,
    setMaturityPolicySelected,
    skipCurrentForSelected,
    snoozeSelected,
    snoozeSelectedUntilDate,
    unsnoozeSelected,
  };
}

export function useContainerPolicy(input: UseContainerPolicyInput) {
  const policyInProgress = ref<string | null>(null);
  const policyMessage = ref<string | null>(null);
  const policyError = ref<string | null>(null);

  const selectedUpdatePolicy = computed<Record<string, unknown>>(() => {
    const selectedId = input.selectedContainer.value?.id;
    const selectedName = input.selectedContainer.value?.name;
    if (!selectedId && !selectedName) {
      return {};
    }
    const meta =
      (selectedId ? input.containerMetaMap.value[selectedId] : undefined) ??
      (selectedName ? input.containerMetaMap.value[selectedName] : undefined);
    if (!meta || typeof meta !== 'object') {
      return {};
    }
    const updatePolicy = (meta as Record<string, unknown>).updatePolicy;
    return updatePolicy && typeof updatePolicy === 'object'
      ? (updatePolicy as Record<string, unknown>)
      : {};
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
    });
  }

  const {
    clearPolicySelected,
    clearMaturityPolicySelected,
    clearSkipsSelected,
    removeSkipDigestSelected,
    removeSkipTagSelected,
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
  });

  const policyStateCache = new Map<
    string,
    {
      meta: unknown;
      state: ContainerListPolicyState;
    }
  >();
  let cachedMetaMapRef = input.containerMetaMap.value;

  function resetPolicyMessages() {
    policyMessage.value = null;
    policyError.value = null;
  }

  function getContainerListPolicyState(target: ContainerPolicyTarget): ContainerListPolicyState {
    const currentMetaMap = input.containerMetaMap.value;
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
    return buildContainerPolicyTooltip(state, kind);
  }

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
    resetPolicyMessages,
    selectedHasMaturityPolicy,
    selectedMaturityMinAgeDays,
    selectedMaturityMode,
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
