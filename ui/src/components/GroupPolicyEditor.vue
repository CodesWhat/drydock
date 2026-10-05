<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppButton from './AppButton.vue';
import {
  buildGroupPolicyBody,
  draftFromPolicy,
  type GroupPolicyDraft,
  type GroupPolicyFailure,
  type GroupPolicyFailureField,
  isValidGroupName,
  isValidMinAgeDays,
  parseListText,
  visibleGroupName,
} from '../composables/useGroupPolicies';
import type { GroupPolicy, GroupPolicyBody } from '../services/group-policy';

const props = defineProps<{
  group: string;
  policy?: GroupPolicy;
  /** True while creating, when the operator picks the group name. */
  nameEditable: boolean;
  globalUpdateMode: string;
  saving: boolean;
  failure: GroupPolicyFailure | null;
  readOnly: boolean;
  triggerSuggestions: string[];
}>();
const emit = defineEmits<{
  save: [payload: { group: string; body: GroupPolicyBody }];
  remove: [];
  cancel: [];
  reload: [];
}>();

const { t, te } = useI18n();
const inputStyle = { backgroundColor: 'var(--dd-bg)', border: '1px solid var(--dd-border)' };

const draft = reactive<GroupPolicyDraft>(draftFromPolicy(props.policy));
const nameDraft = ref(props.group);
const failureVisible = ref(true);

watch(
  () => `${props.policy?.id}:${props.policy?.revision}`,
  () => {
    Object.assign(draft, draftFromPolicy(props.policy));
  },
);
watch(
  () => props.failure,
  () => {
    failureVisible.value = true;
  },
);
// Editing after a rejected save means the message is about the old text.
watch([draft, nameDraft], () => {
  failureVisible.value = false;
});

const globalModeLabel = computed(() => {
  const key = `configView.general.updateMode.options.${props.globalUpdateMode}.label`;
  return te(key) ? t(key) : props.globalUpdateMode;
});

const title = computed(() =>
  props.nameEditable
    ? t('groupPolicyEditor.editor.titleCreate')
    : t('groupPolicyEditor.editor.titleEdit', { group: visibleGroupName(props.group) }),
);
const shownName = computed(() => (props.nameEditable ? nameDraft.value : props.group));
const hasEdgeWhitespace = computed(() => shownName.value !== shownName.value.trim());

const nameInvalid = computed(
  () => props.nameEditable && nameDraft.value !== '' && !isValidGroupName(nameDraft.value),
);
const minAgeInvalid = computed(() => !isValidMinAgeDays(draft.minAgeDays));
const body = computed(() => buildGroupPolicyBody(draft));
const bodyEmpty = computed(
  () =>
    Object.keys(body.value.updatePolicy).length === 0 &&
    Object.keys(body.value.actions).length === 0,
);

const blockedByRefresh = computed(
  () => props.failure?.kind === 'conflict' || props.failure?.kind === 'notFound',
);
const canSave = computed(
  () =>
    !props.readOnly &&
    !props.saving &&
    !blockedByRefresh.value &&
    (!props.nameEditable || isValidGroupName(nameDraft.value)) &&
    !minAgeInvalid.value &&
    !bodyEmpty.value,
);

function serverError(field: GroupPolicyFailureField): string {
  const failure = props.failure;
  const fieldKinds = ['validation', 'exists', 'unknown'];
  return failureVisible.value &&
    failure &&
    fieldKinds.includes(failure.kind) &&
    failure.field === field
    ? failure.message
    : '';
}
const groupError = computed(() =>
  nameInvalid.value ? t('groupPolicyEditor.editor.groupNameInvalid') : serverError('group'),
);
const minAgeError = computed(() =>
  minAgeInvalid.value
    ? t('groupPolicyEditor.editor.minAgeInvalid')
    : serverError('maturityMinAgeDays'),
);

function submit() {
  if (!canSave.value) {
    return;
  }
  emit('save', {
    group: props.nameEditable ? nameDraft.value : props.group,
    body: body.value,
  });
}

function addSuggestion(trigger: string) {
  const entries = parseListText(draft.exclude);
  if (!entries.includes(trigger)) {
    draft.exclude = [...entries, trigger].join('\n');
  }
}
</script>

<template>
  <section class="dd-rounded p-4 space-y-4" :style="{ backgroundColor: 'var(--dd-bg)' }">
    <div class="dd-text-label font-medium dd-text">{{ title }}</div>
    <p v-if="hasEdgeWhitespace" class="dd-text-card-description">
      {{ t('groupPolicyEditor.whitespaceNotice') }}
    </p>
    <p class="dd-text-card-description">{{ t('groupPolicyEditor.ownership') }}</p>

    <p
      v-if="failure?.kind === 'forbidden'"
      role="alert"
      class="dd-text-body dd-text-danger"
      data-testid="group-policy-forbidden"
    >
      {{ t('groupPolicyEditor.editor.forbidden') }}
    </p>
    <p v-else-if="readOnly" class="dd-text-body dd-text-muted" data-testid="group-policy-read-only">
      {{ t('groupPolicyEditor.readOnly') }}
    </p>

    <div
      v-if="failure?.kind === 'conflict' || failure?.kind === 'notFound'"
      role="alert"
      class="dd-rounded px-3 py-2 dd-text-body flex items-center justify-between gap-3"
      :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }"
      data-testid="group-policy-conflict"
    >
      <span>{{
        failure.kind === 'conflict'
          ? t('groupPolicyEditor.editor.conflict')
          : t('groupPolicyEditor.editor.notFound')
      }}</span>
      <AppButton variant="outlined" size="xs" data-testid="group-policy-reload" @click="emit('reload')">
        {{ t('groupPolicyEditor.editor.reload') }}
      </AppButton>
    </div>

    <label v-if="nameEditable" class="block space-y-1">
      <span class="dd-text-label dd-text-muted">{{ t('groupPolicyEditor.editor.groupName') }}</span>
      <input
        v-model="nameDraft"
        type="text"
        autocomplete="off"
        class="w-full px-3 py-2 dd-rounded dd-text-value font-mono disabled:opacity-60"
        :style="inputStyle"
        :disabled="readOnly"
        data-testid="group-policy-name"
      />
      <span class="dd-text-card-description">{{ t('groupPolicyEditor.editor.groupNameHelp') }}</span>
      <span v-if="groupError" class="block dd-text-body dd-text-danger" data-testid="group-policy-error-group">{{ groupError }}</span>
    </label>

    <label class="block space-y-1">
      <span class="dd-text-label dd-text-muted">{{ t('groupPolicyEditor.editor.maturityMode') }}</span>
      <select
        v-model="draft.maturityMode"
        class="w-full px-3 py-2 dd-rounded dd-text-value disabled:opacity-60"
        :style="inputStyle"
        :disabled="readOnly"
        data-testid="group-policy-maturity-mode"
      >
        <option value="">{{ t('groupPolicyEditor.editor.maturityOptions.inherit') }}</option>
        <option value="all">{{ t('groupPolicyEditor.editor.maturityOptions.all') }}</option>
        <option value="mature">{{ t('groupPolicyEditor.editor.maturityOptions.mature') }}</option>
      </select>
      <span v-if="serverError('maturityMode')" class="block dd-text-body dd-text-danger" data-testid="group-policy-error-maturityMode">{{ serverError('maturityMode') }}</span>
    </label>

    <label class="block space-y-1">
      <span class="dd-text-label dd-text-muted">{{ t('groupPolicyEditor.editor.minAge') }}</span>
      <input
        v-model="draft.minAgeDays"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        class="w-full px-3 py-2 dd-rounded dd-text-value disabled:opacity-60"
        :style="inputStyle"
        :disabled="readOnly"
        data-testid="group-policy-min-age"
      />
      <span class="dd-text-card-description">{{ t('groupPolicyEditor.editor.minAgeHelp') }}</span>
      <span v-if="minAgeError" class="block dd-text-body dd-text-danger" data-testid="group-policy-error-maturityMinAgeDays">{{ minAgeError }}</span>
    </label>

    <label class="block space-y-1">
      <span class="dd-text-label dd-text-muted">{{ t('groupPolicyEditor.editor.skipTags') }}</span>
      <textarea
        v-model="draft.skipTags"
        rows="3"
        class="w-full px-3 py-2 dd-rounded dd-text-value font-mono disabled:opacity-60"
        :style="inputStyle"
        :disabled="readOnly"
        data-testid="group-policy-skip-tags"
      />
      <span class="dd-text-card-description">{{ t('groupPolicyEditor.editor.listHelp') }}</span>
      <span v-if="serverError('skipTags')" class="block dd-text-body dd-text-danger" data-testid="group-policy-error-skipTags">{{ serverError('skipTags') }}</span>
    </label>

    <label class="block space-y-1">
      <span class="dd-text-label dd-text-muted">{{ t('groupPolicyEditor.editor.skipDigests') }}</span>
      <textarea
        v-model="draft.skipDigests"
        rows="3"
        class="w-full px-3 py-2 dd-rounded dd-text-value font-mono disabled:opacity-60"
        :style="inputStyle"
        :disabled="readOnly"
        data-testid="group-policy-skip-digests"
      />
      <span class="dd-text-card-description">{{ t('groupPolicyEditor.editor.listHelp') }}</span>
      <span v-if="serverError('skipDigests')" class="block dd-text-body dd-text-danger" data-testid="group-policy-error-skipDigests">{{ serverError('skipDigests') }}</span>
    </label>

    <label class="block space-y-1">
      <span class="dd-text-label dd-text-muted">{{ t('groupPolicyEditor.editor.updateMode') }}</span>
      <select
        v-model="draft.updateMode"
        class="w-full px-3 py-2 dd-rounded dd-text-value disabled:opacity-60"
        :style="inputStyle"
        :disabled="readOnly"
        data-testid="group-policy-update-mode"
      >
        <option value="">{{ t('groupPolicyEditor.editor.updateModeOptions.inherit') }}</option>
        <option value="manual">{{ t('groupPolicyEditor.editor.updateModeOptions.manual') }}</option>
        <option value="notify">{{ t('groupPolicyEditor.editor.updateModeOptions.notify') }}</option>
      </select>
      <span class="dd-text-card-description">{{
        t('groupPolicyEditor.editor.updateModeHelp', { mode: globalModeLabel })
      }}</span>
      <span v-if="serverError('updateMode')" class="block dd-text-body dd-text-danger" data-testid="group-policy-error-updateMode">{{ serverError('updateMode') }}</span>
    </label>

    <div class="space-y-1">
      <label class="block space-y-1">
        <span class="dd-text-label dd-text-muted">{{ t('groupPolicyEditor.editor.exclude') }}</span>
        <textarea
          v-model="draft.exclude"
          rows="3"
          class="w-full px-3 py-2 dd-rounded dd-text-value font-mono disabled:opacity-60"
          :style="inputStyle"
          :disabled="readOnly"
          data-testid="group-policy-exclude"
        />
      </label>
      <div v-if="triggerSuggestions.length > 0 && !readOnly" class="flex flex-wrap gap-1" data-testid="group-policy-suggestions">
        <AppButton
          v-for="trigger in triggerSuggestions"
          :key="trigger"
          variant="outlined"
          size="xs"
          :data-testid="`group-policy-suggest-${trigger}`"
          @click="addSuggestion(trigger)"
        >
          {{ trigger }}
        </AppButton>
      </div>
      <span class="block dd-text-card-description">{{ t('groupPolicyEditor.editor.excludeHelp') }}</span>
      <span v-if="serverError('exclude')" class="block dd-text-body dd-text-danger" data-testid="group-policy-error-exclude">{{ serverError('exclude') }}</span>
    </div>

    <p v-if="serverError('form')" role="alert" class="dd-text-body dd-text-danger" data-testid="group-policy-error-form">
      {{ serverError('form') }}
    </p>
    <p v-if="bodyEmpty && !readOnly" class="dd-text-card-description">
      {{ t('groupPolicyEditor.editor.noFields') }}
    </p>

    <div class="flex flex-wrap items-center gap-2">
      <AppButton
        v-if="!readOnly"
        variant="secondary"
        size="sm"
        :disabled="!canSave"
        data-testid="group-policy-save"
        @click="submit"
      >
        {{ saving ? t('common.loading') : t('common.save') }}
      </AppButton>
      <AppButton variant="plain" size="sm" data-testid="group-policy-cancel" @click="emit('cancel')">
        {{ t('common.cancel') }}
      </AppButton>
      <AppButton
        v-if="policy && !readOnly"
        variant="text-danger"
        size="sm"
        :disabled="saving"
        data-testid="group-policy-remove"
        @click="emit('remove')"
      >
        {{ t('groupPolicyEditor.editor.remove') }}
      </AppButton>
    </div>
  </section>
</template>
