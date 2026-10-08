<script setup lang="ts">
import { computed, ref, toRef, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppBadge from './AppBadge.vue';
import AppButton from './AppButton.vue';
import ContainerIcon from './ContainerIcon.vue';
import { useConfirmDialog } from '../composables/useConfirmDialog';
import {
  buildIconValue,
  fieldErrorCodes,
  ICON_PROVIDERS,
  type IconProvider,
  isEditableField,
  isValidIconSlug,
  LABEL_OVERRIDE_GROUPS,
  type LabelOverrideFailure,
  type LabelOverrideOutcome,
  parseIconValue,
  useLabelOverrides,
  validateDisplayNameDraft,
} from '../composables/useLabelOverrides';
import type { LabelOverrideFieldValue } from '../services/label-override';
import type { LabelOwnedField, LabelOwnedSource } from '../types/container';

const props = defineProps<{ containerId: string }>();

const { t, te } = useI18n();
const { require: requireConfirm } = useConfirmDialog();
const {
  snapshot,
  loading,
  loadError,
  notOverridable,
  saving,
  writeForbidden,
  needsReload,
  warnings,
  readOnly,
  load,
  saveField,
  resetField,
  resetAll,
} = useLabelOverrides(toRef(props, 'containerId'));

const inputStyle = { backgroundColor: 'var(--dd-bg)', border: '1px solid var(--dd-border)' };
const SOURCE_TONES: Record<LabelOwnedSource, 'primary' | 'info' | 'alt' | 'caution' | 'neutral'> = {
  override: 'primary',
  label: 'info',
  compose: 'alt',
  watcher: 'caution',
  default: 'neutral',
  unset: 'neutral',
};

const editing = ref<LabelOwnedField | null>(null);
const nameDraft = ref('');
const iconProvider = ref<IconProvider>('sh');
const iconSlug = ref('');
const failure = ref<LabelOverrideFailure | null>(null);
const failureVisible = ref(true);
const status = ref('');

watch(
  () => props.containerId,
  () => {
    editing.value = null;
    failure.value = null;
    status.value = '';
    void load();
  },
  { immediate: true },
);
watch([nameDraft, iconProvider, iconSlug], () => {
  failureVisible.value = false;
});
watch(readOnly, (value) => {
  if (value) editing.value = null;
});

const scopeText = computed(() => {
  const scope = snapshot.value?.scope;
  if (!scope) return '';
  const params = { name: scope.name, watcher: scope.watcher, agent: scope.agent ?? '' };
  if (scope.kind === 'compose-service') {
    const count = scope.appliesTo.length;
    return t(
      `labelOverrides.scope.${scope.agent === null ? 'composeService' : 'composeServiceAgent'}`,
      { ...params, count },
      count,
    );
  }
  return t(`labelOverrides.scope.${scope.agent === null ? 'container' : 'containerAgent'}`, params);
});

/** Only a validated provider and slug is ever handed to the icon renderer, never a raw value. */
const effectiveIcon = computed(() => {
  const parsed = parseIconValue(snapshot.value?.fields.displayIcon.effective.value);
  return parsed ? `${parsed.provider}-${parsed.slug}` : '';
});

const hasOverrides = computed(() =>
  Object.values(snapshot.value?.fields ?? {}).some((field) => field.override !== null),
);

const readOnlyText = computed(() =>
  writeForbidden.value
    ? t('labelOverrides.readOnly.forbidden')
    : t('labelOverrides.readOnly.rollback'),
);

const fieldName = (field: LabelOwnedField) => t(`labelOverrides.fields.${field}`);

function valueText(value: LabelOverrideFieldValue): string {
  if (value === null) return t('labelOverrides.values.notSet');
  if (Array.isArray(value)) {
    return value.length === 0 ? t('labelOverrides.values.none') : value.join(', ');
  }
  return value;
}

function warningText(warning: { field: string; code: string; reference?: string }): string {
  const key = `labelOverrides.warnings.${warning.code}`;
  const field = te(`labelOverrides.fields.${warning.field}`)
    ? t(`labelOverrides.fields.${warning.field}`)
    : warning.field;
  if (te(key)) return t(key, { field, reference: warning.reference ?? '' });
  return t('labelOverrides.warnings.other', { field, code: warning.code });
}

const invalidStoredText = computed(() =>
  (snapshot.value?.invalidStoredOverride ?? []).map((entry) => entry.field).join(', '),
);

function startEdit(field: LabelOwnedField) {
  const effective = snapshot.value?.fields[field].effective.value ?? null;
  failure.value = null;
  status.value = '';
  failureVisible.value = true;
  if (field === 'displayName') {
    nameDraft.value = typeof effective === 'string' ? effective : '';
  } else {
    const parsed = parseIconValue(effective);
    iconProvider.value = parsed?.provider ?? 'sh';
    iconSlug.value = parsed?.slug ?? '';
  }
  editing.value = field;
  failureVisible.value = true;
}

function cancelEdit() {
  editing.value = null;
  failure.value = null;
}

const nameProblem = computed(() => validateDisplayNameDraft(nameDraft.value));
const nameError = computed(() =>
  nameProblem.value !== null && nameDraft.value !== ''
    ? t(`labelOverrides.validation.displayName.${nameProblem.value}`)
    : '',
);
const slugValid = computed(() => isValidIconSlug(iconSlug.value));
const iconError = computed(() =>
  iconSlug.value !== '' && !slugValid.value ? t('labelOverrides.validation.iconName') : '',
);
const iconPreview = computed(() =>
  slugValid.value ? `${iconProvider.value}-${iconSlug.value}` : '',
);

const canSave = computed(
  () =>
    !saving.value &&
    !needsReload.value &&
    !readOnly.value &&
    (editing.value === 'displayName' ? nameProblem.value === null : slugValid.value),
);

function serverMessages(field: LabelOwnedField): string[] {
  if (!failureVisible.value) return [];
  return fieldErrorCodes(failure.value, field).map((code) => {
    const key = `labelOverrides.errors.codes.${code}`;
    return te(key) ? t(key) : t('labelOverrides.errors.invalid');
  });
}
const nameServerErrors = computed(() => serverMessages('displayName'));
const iconServerErrors = computed(() => serverMessages('displayIcon'));

const reloadMessage = computed(() => {
  switch (failure.value?.kind) {
    case 'conflict':
      return t('labelOverrides.conflict.message');
    case 'notFound':
      return t('labelOverrides.conflict.notFound');
    case 'unknown':
      return `${t('labelOverrides.conflict.unknown')} ${failure.value.message}`;
    default:
      return '';
  }
});
const generalFailure = computed(() => {
  const current = failure.value;
  if (!current || reloadMessage.value) return '';
  if (['forbidden', 'readOnly', 'notOverridable'].includes(current.kind)) return '';
  if (
    current.kind === 'validation' &&
    editing.value !== null &&
    fieldErrorCodes(current, editing.value).length > 0
  ) {
    return '';
  }
  return current.message;
});

function finish(outcome: LabelOverrideOutcome | undefined, message: string) {
  if (!outcome) return;
  if ('failure' in outcome) {
    failure.value = outcome.failure;
    failureVisible.value = true;
    return;
  }
  failure.value = null;
  editing.value = null;
  status.value = message;
}

async function submit() {
  const field = editing.value;
  if (field === null || !canSave.value) return;
  const value =
    field === 'displayName'
      ? nameDraft.value.trim()
      : buildIconValue(iconProvider.value, iconSlug.value);
  failure.value = null;
  status.value = '';
  finish(
    await saveField(field, value),
    t('labelOverrides.status.saved', { field: fieldName(field) }),
  );
}

async function resetOne(field: LabelOwnedField) {
  failure.value = null;
  status.value = '';
  finish(await resetField(field), t('labelOverrides.status.reset', { field: fieldName(field) }));
}

async function performResetAll() {
  failure.value = null;
  status.value = '';
  const outcome = await resetAll();
  const count = outcome && 'changed' in outcome ? outcome.changed.length : 0;
  finish(
    outcome,
    count === 0
      ? t('labelOverrides.status.nothingToReset')
      : t('labelOverrides.status.resetAll', { count }, count),
  );
}

function confirmResetAll() {
  const containerId = props.containerId;
  requireConfirm({
    header: t('labelOverrides.resetAllConfirm.header'),
    message: t('labelOverrides.resetAllConfirm.message', {
      scope: snapshot.value?.scope.name ?? '',
    }),
    acceptLabel: t('labelOverrides.resetAllConfirm.accept'),
    rejectLabel: t('common.cancel'),
    severity: 'danger',
    accept: async () => {
      if (props.containerId === containerId) await performResetAll();
    },
  });
}

async function reload() {
  failure.value = null;
  await load();
}
</script>

<template>
  <section
    class="dd-rounded p-4 space-y-4 mb-4"
    :style="{ backgroundColor: 'var(--dd-bg-card)' }"
    data-testid="label-overrides-panel"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 space-y-1">
        <div class="dd-text-label font-medium dd-text">{{ t('labelOverrides.title') }}</div>
        <p class="dd-text-card-description">{{ t('labelOverrides.boundary') }}</p>
        <p v-if="snapshot" class="dd-text-card-description" data-testid="label-overrides-scope">{{ scopeText }}</p>
      </div>
      <AppButton
        v-if="snapshot && hasOverrides && !readOnly"
        variant="text-danger"
        size="xs"
        :disabled="saving || needsReload"
        data-testid="label-overrides-reset-all"
        @click="confirmResetAll"
      >
        {{ t('labelOverrides.actions.resetAll') }}
      </AppButton>
    </div>

    <div
      v-if="loading && !snapshot && !loadError && !notOverridable"
      class="flex items-center gap-2 dd-text-body dd-text-muted"
      data-testid="label-overrides-loading"
    >
      <AppIcon name="refresh" :size="12" class="animate-spin" />
      {{ t('labelOverrides.loading') }}
    </div>

    <div
      v-if="loadError"
      role="alert"
      class="dd-text-body px-3 py-2 dd-rounded flex items-center justify-between gap-3"
      :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }"
      data-testid="label-overrides-error"
    >
      <span>{{ loadError }}</span>
      <AppButton variant="outlined" size="xs" data-testid="label-overrides-retry" @click="load">
        {{ t('common.retry') }}
      </AppButton>
    </div>

    <div v-if="notOverridable" class="dd-text-body dd-text-muted space-y-1" data-testid="label-overrides-unavailable">
      <p>{{ t('labelOverrides.unavailable') }}</p>
      <p class="dd-text-card-description">{{ notOverridable }}</p>
    </div>

    <template v-if="snapshot && !notOverridable">
      <p v-if="readOnly" class="dd-text-body dd-text-muted" data-testid="label-overrides-read-only">
        {{ readOnlyText }}
      </p>
      <p v-if="status" role="status" aria-live="polite" class="dd-text-body px-3 py-2 dd-rounded"
         :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' }"
         data-testid="label-overrides-status">
        {{ status }}
      </p>
      <div
        v-if="reloadMessage"
        role="alert"
        class="dd-rounded px-3 py-2 dd-text-body flex items-center justify-between gap-3"
        :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }"
        data-testid="label-overrides-conflict"
      >
        <span>{{ reloadMessage }}</span>
        <AppButton variant="outlined" size="xs" data-testid="label-overrides-reload" @click="reload">
          {{ t('labelOverrides.conflict.reload') }}
        </AppButton>
      </div>
      <p v-if="generalFailure" role="alert" class="dd-text-body dd-text-danger" data-testid="label-overrides-failure">
        {{ generalFailure }}
      </p>
      <div
        v-if="warnings.length > 0"
        class="dd-text-body px-3 py-2 dd-rounded space-y-1"
        :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }"
        data-testid="label-overrides-warnings"
      >
        <div class="font-medium">{{ t('labelOverrides.warnings.title') }}</div>
        <ul class="list-disc pl-4">
          <li v-for="(warning, index) in warnings" :key="index">{{ warningText(warning) }}</li>
        </ul>
      </div>
      <p v-if="invalidStoredText" class="dd-text-card-description" data-testid="label-overrides-invalid-stored">
        {{ t('labelOverrides.invalidStored', { fields: invalidStoredText }) }}
      </p>
      <p v-if="!hasOverrides" class="dd-text-card-description" data-testid="label-overrides-empty">
        {{ t('labelOverrides.noOverrides') }}
      </p>

      <div v-for="group in LABEL_OVERRIDE_GROUPS" :key="group.id" class="space-y-2">
        <div class="dd-text-label dd-text-muted">{{ t(`labelOverrides.groups.${group.id}`) }}</div>
        <div
          v-for="field in group.fields"
          :key="field"
          class="px-3 py-2 dd-rounded space-y-1"
          :style="{ backgroundColor: 'var(--dd-bg)' }"
          :data-testid="`label-override-row-${field}`"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="dd-text-body font-medium dd-text">{{ fieldName(field) }}</span>
            <span class="dd-text-card-description font-mono">{{ snapshot.fields[field].labelKey }}</span>
            <AppBadge
              :tone="SOURCE_TONES[snapshot.fields[field].effective.source]"
              size="xs"
              :uppercase="false"
              class="ml-auto"
              :data-testid="`label-overrides-source-${field}`"
            >
              {{ t(`labelOverrides.sources.${snapshot.fields[field].effective.source}`) }}
            </AppBadge>
          </div>

          <div v-if="editing !== field" class="flex flex-wrap items-center gap-2">
            <span
              v-if="field === 'displayIcon' && effectiveIcon"
              :data-testid="`label-overrides-icon-preview-${field}`"
            >
              <ContainerIcon :icon="effectiveIcon" :size="16" />
            </span>
            <template v-if="Array.isArray(snapshot.fields[field].effective.value)">
              <span v-if="snapshot.fields[field].effective.value.length === 0" class="dd-text-body dd-text-muted">
                {{ t('labelOverrides.values.none') }}
              </span>
              <AppBadge
                v-for="entry in snapshot.fields[field].effective.value"
                :key="entry"
                tone="neutral"
                size="sm"
                :uppercase="false"
                class="font-mono"
              >
                {{ entry }}
              </AppBadge>
            </template>
            <span v-else-if="snapshot.fields[field].effective.value === null" class="dd-text-body dd-text-muted">
              {{ t('labelOverrides.values.notSet') }}
            </span>
            <span v-else class="dd-text-value dd-text break-all">{{ snapshot.fields[field].effective.value }}</span>
            <span class="ml-auto flex items-center gap-1">
              <AppButton
                v-if="isEditableField(field) && !readOnly"
                variant="outlined"
                size="xs"
                :disabled="editing !== null || saving"
                :aria-label="t('labelOverrides.actions.editField', { field: fieldName(field) })"
                :data-testid="`label-overrides-edit-${field}`"
                @click="startEdit(field)"
              >
                {{ t('labelOverrides.actions.edit') }}
              </AppButton>
              <AppButton
                v-if="snapshot.fields[field].override !== null && !readOnly"
                variant="text-danger"
                size="xs"
                :disabled="saving || needsReload"
                :title="t('labelOverrides.actions.resetHint', { value: valueText(snapshot.fields[field].declared.value) })"
                :aria-label="t('labelOverrides.actions.resetFieldAria', { field: fieldName(field) })"
                :data-testid="`label-overrides-reset-${field}`"
                @click="resetOne(field)"
              >
                {{ t('labelOverrides.actions.resetField') }}
              </AppButton>
            </span>
          </div>

          <p
            v-if="snapshot.fields[field].override !== null"
            class="dd-text-card-description break-all"
            :data-testid="`label-overrides-label-value-${field}`"
          >
            {{
              snapshot.fields[field].label === null
                ? t('labelOverrides.values.noLabel')
                : t('labelOverrides.values.labelValue', { value: snapshot.fields[field].label })
            }}
          </p>

          <div v-if="editing === field" class="space-y-2 pt-1">
            <label v-if="field === 'displayName'" class="block space-y-1">
              <span class="dd-text-label dd-text-muted">{{ t('labelOverrides.editor.displayName') }}</span>
              <input
                v-model="nameDraft"
                type="text"
                maxlength="128"
                autocomplete="off"
                class="w-full px-3 py-2 dd-rounded dd-text-value"
                :style="inputStyle"
                data-testid="label-overrides-name-input"
              />
              <span class="block dd-text-card-description">{{ t('labelOverrides.editor.displayNameHelp') }}</span>
              <span v-if="nameError" class="block dd-text-body dd-text-danger" data-testid="label-overrides-error-displayName">{{ nameError }}</span>
              <span
                v-for="message in nameServerErrors"
                :key="message"
                class="block dd-text-body dd-text-danger"
                data-testid="label-overrides-error-displayName"
              >{{ message }}</span>
            </label>

            <div v-else class="space-y-2">
              <label class="block space-y-1">
                <span class="dd-text-label dd-text-muted">{{ t('labelOverrides.editor.iconProvider') }}</span>
                <select
                  v-model="iconProvider"
                  class="w-full px-3 py-2 dd-rounded dd-text-value"
                  :style="inputStyle"
                  data-testid="label-overrides-icon-provider"
                >
                  <option v-for="provider in ICON_PROVIDERS" :key="provider" :value="provider">
                    {{ t(`labelOverrides.editor.providers.${provider}`) }}
                  </option>
                </select>
              </label>
              <label class="block space-y-1">
                <span class="dd-text-label dd-text-muted">{{ t('labelOverrides.editor.iconName') }}</span>
                <input
                  v-model="iconSlug"
                  type="text"
                  autocomplete="off"
                  spellcheck="false"
                  class="w-full px-3 py-2 dd-rounded dd-text-value font-mono"
                  :style="inputStyle"
                  data-testid="label-overrides-icon-slug"
                />
                <span class="block dd-text-card-description">{{ t('labelOverrides.editor.iconNameHelp') }}</span>
                <span v-if="iconError" class="block dd-text-body dd-text-danger" data-testid="label-overrides-error-displayIcon">{{ iconError }}</span>
                <span
                  v-for="message in iconServerErrors"
                  :key="message"
                  class="block dd-text-body dd-text-danger"
                  data-testid="label-overrides-error-displayIcon"
                >{{ message }}</span>
              </label>
              <div v-if="iconPreview" class="flex items-center gap-2" data-testid="label-overrides-icon-preview">
                <span class="dd-text-label dd-text-muted">{{ t('labelOverrides.editor.iconPreview') }}</span>
                <ContainerIcon :icon="iconPreview" :size="24" />
              </div>
            </div>

            <p class="dd-text-card-description">{{ t('labelOverrides.editor.scopeReminder') }}</p>
            <div class="flex flex-wrap items-center gap-2">
              <AppButton
                variant="secondary"
                size="sm"
                :disabled="!canSave"
                data-testid="label-overrides-save"
                @click="submit"
              >
                {{ saving ? t('common.loading') : t('common.save') }}
              </AppButton>
              <AppButton variant="plain" size="sm" data-testid="label-overrides-cancel" @click="cancelEdit">
                {{ t('common.cancel') }}
              </AppButton>
            </div>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>
