import { computed, ref } from 'vue';
import { i18n } from '../boot/i18n';
import { getContainerGroups } from '../services/container';
import {
  createGroupPolicy,
  deleteGroupPolicy,
  type GroupPolicy,
  type GroupPolicyBody,
  GroupPolicyHttpError,
  type GroupPolicyMaturityMode,
  type GroupPolicyUpdateMode,
  listGroupPolicies,
  replaceGroupPolicy,
} from '../services/group-policy';
import { isNotificationProvider } from '../services/notification-editor';
import { getAllTriggers } from '../services/trigger';
import { errorMessage } from '../utils/error';

type GroupPolicyFailureKind =
  | 'validation'
  | 'conflict'
  | 'exists'
  | 'forbidden'
  | 'notFound'
  | 'unknown';

type GroupPolicyFailureField =
  | 'form'
  | 'group'
  | 'maturityMode'
  | 'maturityMinAgeDays'
  | 'skipTags'
  | 'skipDigests'
  | 'updateMode'
  | 'exclude';

interface GroupPolicyFailure {
  kind: GroupPolicyFailureKind;
  message: string;
  field: GroupPolicyFailureField;
}

type GroupPolicyOutcome =
  | { ok: true; members: number; warnings: string[]; changed: boolean }
  | { ok: false; failure: GroupPolicyFailure };

interface GroupPolicyRow {
  group: string;
  policy: GroupPolicy | undefined;
  memberCount: number;
  /** Agent names, `null` for the controller. Only known for groups that have a policy. */
  agents: (string | null)[];
}

interface GroupPolicyDraft {
  maturityMode: '' | GroupPolicyMaturityMode;
  minAgeDays: string;
  skipTags: string;
  skipDigests: string;
  updateMode: '' | GroupPolicyUpdateMode;
  exclude: string;
}

/** Group names are exact keys, so edge whitespace is shown as a visible mark. */
function visibleGroupName(name: string): string {
  return name.replace(/^\s+|\s+$/g, (edge) => '␣'.repeat(edge.length));
}

function isValidGroupName(name: string): boolean {
  return name.trim() !== '';
}

function isValidMinAgeDays(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '') {
    return true;
  }
  const days = Number(trimmed);
  return /^\d+$/.test(trimmed) && days >= 1 && days <= 365;
}

function parseListText(text: string): string[] {
  const entries = text
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  return [...new Set(entries)];
}

function draftFromPolicy(policy: GroupPolicy | undefined): GroupPolicyDraft {
  const { updatePolicy, actions } = policy ?? { updatePolicy: {}, actions: {} };
  return {
    maturityMode: updatePolicy.maturityMode ?? '',
    minAgeDays:
      updatePolicy.maturityMinAgeDays === undefined ? '' : String(updatePolicy.maturityMinAgeDays),
    skipTags: (updatePolicy.skipTags ?? []).join('\n'),
    skipDigests: (updatePolicy.skipDigests ?? []).join('\n'),
    updateMode: actions.updateMode ?? '',
    exclude: (actions.exclude ?? []).join('\n'),
  };
}

function buildGroupPolicyBody(draft: GroupPolicyDraft): GroupPolicyBody {
  const skipTags = parseListText(draft.skipTags);
  const skipDigests = parseListText(draft.skipDigests);
  const exclude = parseListText(draft.exclude);
  const minAge = draft.minAgeDays.trim();
  return {
    updatePolicy: {
      ...(draft.maturityMode ? { maturityMode: draft.maturityMode } : {}),
      ...(minAge ? { maturityMinAgeDays: Number(minAge) } : {}),
      ...(skipTags.length > 0 ? { skipTags } : {}),
      ...(skipDigests.length > 0 ? { skipDigests } : {}),
    },
    actions: {
      ...(draft.updateMode ? { updateMode: draft.updateMode } : {}),
      ...(exclude.length > 0 ? { exclude } : {}),
    },
  };
}

/**
 * The server reports a validation failure as one message. The field it names is read back
 * out of that message so the editor can put the text next to the input it is about.
 */
function groupPolicyFailureField(message: string): GroupPolicyFailureField {
  if (/maturityMinAgeDays/.test(message)) return 'maturityMinAgeDays';
  if (/maturityMode/.test(message)) return 'maturityMode';
  if (/skipTags/.test(message)) return 'skipTags';
  if (/skipDigests/.test(message)) return 'skipDigests';
  if (/updateMode/.test(message)) return 'updateMode';
  if (/trigger reference|exclude/.test(message)) return 'exclude';
  if (/group name/i.test(message)) return 'group';
  return 'form';
}

function failureFromError(
  error: unknown,
  operation: 'create' | 'save' | 'remove',
): GroupPolicyFailure {
  const message = errorMessage(error, i18n.global.t('groupPolicyEditor.errors.unknown'));
  if (error instanceof GroupPolicyHttpError) {
    if (error.status === 400) {
      return { kind: 'validation', message, field: groupPolicyFailureField(message) };
    }
    if (error.status === 409) {
      return operation === 'create'
        ? { kind: 'exists', message, field: 'group' }
        : { kind: 'conflict', message, field: 'form' };
    }
    if (error.status === 401 || error.status === 403) {
      return { kind: 'forbidden', message, field: 'form' };
    }
    if (error.status === 404) {
      return { kind: 'notFound', message, field: 'form' };
    }
  }
  return { kind: 'unknown', message, field: 'form' };
}

/** Callers only sort unique names, so equal names never reach the comparator. */
function compareNames(a: string, b: string): number {
  return a < b ? -1 : 1;
}

function useGroupPolicies() {
  const policies = ref<GroupPolicy[]>([]);
  const groups = ref<{ name: string; count: number }[]>([]);
  const triggerSuggestions = ref<string[]>([]);
  const loading = ref(false);
  const loadError = ref('');
  const saving = ref(false);
  const writeForbidden = ref(false);

  const rows = computed<GroupPolicyRow[]>(() => {
    const byName = new Map<string, GroupPolicyRow>();
    for (const group of groups.value) {
      byName.set(group.name, {
        group: group.name,
        policy: undefined,
        memberCount: group.count,
        agents: [],
      });
    }
    for (const policy of policies.value) {
      byName.set(policy.group, {
        group: policy.group,
        policy,
        memberCount: policy.members.count,
        agents: policy.members.agents,
      });
    }
    return [...byName.values()].sort((a, b) => compareNames(a.group, b.group));
  });

  async function load() {
    loading.value = true;
    loadError.value = '';
    try {
      const [loadedPolicies, loadedGroups, triggers] = await Promise.all([
        listGroupPolicies(),
        getContainerGroups(),
        getAllTriggers().catch(() => []),
      ]);
      policies.value = loadedPolicies;
      groups.value = loadedGroups.flatMap((group) =>
        group.name === null ? [] : [{ name: group.name, count: group.containerCount }],
      );
      triggerSuggestions.value = [
        ...new Set(
          triggers.filter((trigger) => !isNotificationProvider(trigger.type)).map((t) => t.id),
        ),
      ].sort(compareNames);
    } catch (error: unknown) {
      policies.value = [];
      groups.value = [];
      triggerSuggestions.value = [];
      loadError.value = errorMessage(error, i18n.global.t('groupPolicyEditor.errors.load'));
    } finally {
      loading.value = false;
    }
  }

  async function write(
    operation: 'create' | 'save' | 'remove',
    run: () => ReturnType<typeof createGroupPolicy>,
  ): Promise<GroupPolicyOutcome> {
    if (saving.value) {
      return {
        ok: false,
        failure: {
          kind: 'unknown',
          message: i18n.global.t('groupPolicyEditor.errors.unknown'),
          field: 'form',
        },
      };
    }
    saving.value = true;
    try {
      const result = await run();
      await load();
      return {
        ok: true,
        members: result.applied.members,
        warnings: result.warnings,
        changed: result.changed ?? true,
      };
    } catch (error: unknown) {
      const failure = failureFromError(error, operation);
      if (failure.kind === 'forbidden') {
        writeForbidden.value = true;
      }
      return { ok: false, failure };
    } finally {
      saving.value = false;
    }
  }

  return {
    rows,
    triggerSuggestions,
    loading,
    loadError,
    saving,
    writeForbidden,
    load,
    create: (group: string, body: GroupPolicyBody) =>
      write('create', () => createGroupPolicy(group, body)),
    update: (policy: GroupPolicy, body: GroupPolicyBody) =>
      write('save', () => replaceGroupPolicy(policy.id, policy.revision, body)),
    remove: (policy: GroupPolicy) =>
      write('remove', () => deleteGroupPolicy(policy.id, policy.revision)),
  };
}

export {
  buildGroupPolicyBody,
  draftFromPolicy,
  failureFromError,
  type GroupPolicyDraft,
  type GroupPolicyFailure,
  type GroupPolicyFailureField,
  type GroupPolicyFailureKind,
  type GroupPolicyOutcome,
  type GroupPolicyRow,
  groupPolicyFailureField,
  isValidGroupName,
  isValidMinAgeDays,
  parseListText,
  useGroupPolicies,
  visibleGroupName,
};
