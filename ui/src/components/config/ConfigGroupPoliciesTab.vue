<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import {
  type GroupPolicyFailure,
  type GroupPolicyOutcome,
  type GroupPolicyRow,
  useGroupPolicies,
  visibleGroupName,
} from '../../composables/useGroupPolicies';
import { useUpdateMode } from '../../composables/useUpdateMode';
import type { GroupPolicy, GroupPolicyBody } from '../../services/group-policy';
import GroupPolicyEditor from '../GroupPolicyEditor.vue';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const { require: requireConfirm } = useConfirmDialog();
const { updateMode, loadUpdateMode } = useUpdateMode();
const {
  rows,
  triggerSuggestions,
  loading,
  loadError,
  saving,
  writeForbidden,
  load,
  create,
  update,
  remove,
} = useGroupPolicies();

const loaded = ref(false);
const failure = ref<GroupPolicyFailure | null>(null);
const status = ref('');
const warnings = ref<string[]>([]);

const linkedGroup = computed(() => {
  const raw = route.query.group;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value !== '' ? value : null;
});
const activeGroup = ref<string | null>(linkedGroup.value);
const creating = ref(false);

watch(linkedGroup, (value) => {
  activeGroup.value = value;
  if (value !== null) {
    creating.value = false;
  }
  failure.value = null;
});

const selection = computed(() => {
  if (creating.value) {
    return { key: 'new', group: '', policy: undefined, nameEditable: true };
  }
  if (activeGroup.value === null) {
    return null;
  }
  const row = rows.value.find((entry) => entry.group === activeGroup.value);
  return {
    key: `group:${activeGroup.value}`,
    group: activeGroup.value,
    policy: row?.policy,
    nameEditable: row === undefined,
  };
});

function resetMessages() {
  failure.value = null;
  status.value = '';
  warnings.value = [];
}

function openRow(row: GroupPolicyRow) {
  resetMessages();
  creating.value = false;
  activeGroup.value = row.group;
  router.replace({ query: { tab: 'groupPolicies', group: row.group } });
}

function openNew() {
  resetMessages();
  creating.value = true;
  activeGroup.value = null;
  router.replace({ query: { tab: 'groupPolicies' } });
}

function closeEditor() {
  failure.value = null;
  creating.value = false;
  activeGroup.value = null;
  router.replace({ query: { tab: 'groupPolicies' } });
}

function finish(outcome: GroupPolicyOutcome, messageKey: 'saved' | 'removed') {
  if ('failure' in outcome) {
    failure.value = outcome.failure;
    return;
  }
  status.value = t(
    `groupPolicyEditor.${messageKey}`,
    { members: outcome.members },
    outcome.members,
  );
  warnings.value = outcome.warnings;
  closeEditor();
}

async function handleSave(payload: { group: string; body: GroupPolicyBody }) {
  resetMessages();
  const policy = selection.value?.policy;
  finish(
    policy ? await update(policy, payload.body) : await create(payload.group, payload.body),
    'saved',
  );
}

async function performRemove(policy: GroupPolicy) {
  resetMessages();
  finish(await remove(policy), 'removed');
}

function confirmRemove(policy: GroupPolicy) {
  requireConfirm({
    header: t('groupPolicyEditor.remove.header'),
    message: t('groupPolicyEditor.remove.message', { group: visibleGroupName(policy.group) }),
    acceptLabel: t('groupPolicyEditor.remove.accept'),
    rejectLabel: t('common.cancel'),
    severity: 'danger',
    accept: () => performRemove(policy),
  });
}

async function reload() {
  failure.value = null;
  await load();
}

function summary(row: GroupPolicyRow): string[] {
  const policy = row.policy;
  if (!policy) {
    return [];
  }
  const { updatePolicy, actions } = policy;
  return [
    ...(updatePolicy.maturityMode
      ? [
          t('groupPolicyEditor.summary.maturityMode', {
            value: t(`groupPolicyEditor.editor.maturityOptions.${updatePolicy.maturityMode}`),
          }),
        ]
      : []),
    ...(updatePolicy.maturityMinAgeDays === undefined
      ? []
      : [t('groupPolicyEditor.summary.minAge', { days: updatePolicy.maturityMinAgeDays })]),
    ...(updatePolicy.skipTags
      ? [t('groupPolicyEditor.summary.skipTags', { count: updatePolicy.skipTags.length })]
      : []),
    ...(updatePolicy.skipDigests
      ? [t('groupPolicyEditor.summary.skipDigests', { count: updatePolicy.skipDigests.length })]
      : []),
    ...(actions.updateMode
      ? [
          t('groupPolicyEditor.summary.updateMode', {
            mode: t(`groupPolicyEditor.editor.updateModeOptions.${actions.updateMode}`),
          }),
        ]
      : []),
    ...(actions.exclude
      ? [t('groupPolicyEditor.summary.exclude', { count: actions.exclude.length })]
      : []),
  ];
}

function hosts(row: GroupPolicyRow): string {
  return row.agents.map((agent) => agent ?? t('groupPolicyEditor.controller')).join(', ');
}

async function init() {
  await Promise.all([load(), loadUpdateMode()]);
  loaded.value = true;
}
void init();
</script>

<template>
  <div class="space-y-6">
    <div class="dd-rounded overflow-hidden" :style="{ backgroundColor: 'var(--dd-bg-card)' }">
      <div class="px-5 py-4 flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="dd-text-heading-section dd-text">{{ t('groupPolicyEditor.title') }}</div>
          <div class="dd-text-card-description">{{ t('groupPolicyEditor.description') }}</div>
          <div class="dd-text-card-description">{{ t('groupPolicyEditor.ownership') }}</div>
        </div>
        <AppButton
          v-if="!writeForbidden"
          variant="secondary"
          size="sm"
          data-testid="group-policies-new"
          @click="openNew"
        >
          {{ t('groupPolicyEditor.newPolicy') }}
        </AppButton>
      </div>

      <div class="p-5 space-y-4">
        <div
          v-if="status"
          role="status"
          class="dd-text-body px-3 py-2 dd-rounded"
          :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' }"
          data-testid="group-policies-status"
        >
          {{ status }}
        </div>
        <div
          v-if="warnings.length > 0"
          class="dd-text-body px-3 py-2 dd-rounded space-y-1"
          :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }"
          data-testid="group-policies-warnings"
        >
          <div class="font-medium">{{ t('groupPolicyEditor.warningsTitle') }}</div>
          <ul class="list-disc pl-4">
            <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
          </ul>
        </div>

        <div
          v-if="loadError"
          role="alert"
          class="dd-text-body px-3 py-2 dd-rounded flex items-center justify-between gap-3"
          :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }"
          data-testid="group-policies-error"
        >
          <span>{{ loadError }}</span>
          <AppButton variant="outlined" size="xs" data-testid="group-policies-retry" @click="load">
            {{ t('common.retry') }}
          </AppButton>
        </div>

        <div
          v-if="!loaded && loading"
          class="flex items-center justify-center gap-2 dd-text-body dd-text-muted py-4"
          data-testid="group-policies-loading"
        >
          <AppIcon name="refresh" :size="12" class="animate-spin" />
          {{ t('groupPolicyEditor.loading') }}
        </div>

        <div
          v-else-if="loaded && !loadError && rows.length === 0"
          class="dd-text-body dd-text-muted py-4"
          data-testid="group-policies-empty"
        >
          {{ t('groupPolicyEditor.empty') }}
        </div>

        <ul v-else-if="rows.length > 0" class="space-y-2">
          <li
            v-for="row in rows"
            :key="row.group"
            class="dd-rounded px-4 py-3 flex items-start justify-between gap-4"
            :style="{ backgroundColor: 'var(--dd-bg)' }"
            data-testid="group-policies-row"
          >
            <div class="min-w-0 space-y-1">
              <code class="dd-text-value dd-text break-all whitespace-pre-wrap">{{ visibleGroupName(row.group) }}</code>
              <div class="dd-text-card-description">
                {{ t('groupPolicyEditor.memberCount', { count: row.memberCount }, row.memberCount) }}
                <template v-if="row.agents.length > 0"> · {{ t('groupPolicyEditor.hosts', { hosts: hosts(row) }) }}</template>
              </div>
              <div v-if="row.policy && row.memberCount === 0" class="dd-text-card-description">
                {{ t('groupPolicyEditor.noMembers') }}
              </div>
              <div class="flex flex-wrap gap-1">
                <span v-if="!row.policy" class="badge dd-text-badge-xs dd-text-muted">{{ t('groupPolicyEditor.noPolicy') }}</span>
                <span v-for="part in summary(row)" :key="part" class="badge dd-text-badge-xs">{{ part }}</span>
              </div>
            </div>
            <AppButton variant="outlined" size="xs" data-testid="group-policies-edit" @click="openRow(row)">
              {{ row.policy ? t('groupPolicyEditor.edit') : t('groupPolicyEditor.create') }}
            </AppButton>
          </li>
        </ul>

        <GroupPolicyEditor
          v-if="loaded && !loadError && selection"
          :key="selection.key"
          :group="selection.group"
          :policy="selection.policy"
          :name-editable="selection.nameEditable"
          :global-update-mode="updateMode"
          :saving="saving"
          :failure="failure"
          :read-only="writeForbidden"
          :trigger-suggestions="triggerSuggestions"
          @save="handleSave"
          @remove="confirmRemove(selection.policy as GroupPolicy)"
          @cancel="closeEditor"
          @reload="reload"
        />
      </div>
    </div>
  </div>
</template>
