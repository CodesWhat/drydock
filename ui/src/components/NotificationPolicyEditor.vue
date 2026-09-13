<script setup lang="ts">
import { useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppButton from './AppButton.vue';
import { useNotificationEditor, isBooleanPolicyField } from '../composables/useNotificationEditor';
import {
  notificationEditFields,
  notificationModes,
  notificationThresholds,
  type NotificationEditField,
  type NotificationIdentity,
} from '../services/notification-editor';

const props = defineProps<{ trigger: NotificationIdentity }>();
const emit = defineEmits<{ saved: [trigger: NotificationIdentity] }>();
const { t } = useI18n(),
  id = useId();
const inputStyle = { backgroundColor: 'var(--dd-bg)', border: '1px solid var(--dd-border)' };
const {
  active,
  loading,
  saving,
  row,
  drafts,
  errorKey,
  result,
  conflict,
  needsReload,
  canSave,
  hasProblems,
  editable,
  setValue,
  remove,
  open,
  cancel,
  save,
} = useNotificationEditor(() => props.trigger);
watch(result, (outcome) => {
  if (outcome?.saved) emit('saved', { ...props.trigger });
});
const reasonKeys: Record<string, string> = {
  'environment-owned': 'watcherEditor.readOnly.environment',
  'referenced-field': 'watcherEditor.readOnly.reference',
  'agent-trigger': 'watcherEditor.readOnly.agent',
  'provider-forced': 'notificationEditor.providerForced',
};
function reason(field: NotificationEditField) {
  return t(
    reasonKeys[row.value?.fields[field].readOnlyReason ?? ''] ?? 'watcherEditor.readOnly.other',
  );
}
function errorMessage() {
  return t(
    `${['triggerUnavailable', 'apiUnavailable'].includes(errorKey.value) ? 'notificationEditor' : 'watcherEditor'}.${errorKey.value}`,
  );
}
function change(field: NotificationEditField, event: Event) {
  const value = (event.target as HTMLInputElement).value;
  setValue(field, isBooleanPolicyField(field) ? value === 'true' : value);
}
</script>

<template>
  <section class="space-y-3 border-t dd-border pt-4" :aria-labelledby="`${id}-title`">
    <h3 :id="`${id}-title`" class="dd-text-heading-section">{{ t('notificationEditor.title') }}</h3>
    <p class="dd-text-card-description">{{ t('notificationEditor.boundary') }}</p>
    <AppButton v-if="!active" data-testid="edit-notification-policy" variant="outlined" @click="open">{{ t('notificationEditor.edit') }}</AppButton>
    <form v-else class="space-y-3" @submit.prevent="save">
      <p v-if="loading" role="status">{{ t('common.loading') }}</p>
      <p v-if="errorKey" role="alert" class="dd-text-danger">{{ errorMessage() }}</p>
      <template v-if="row && !loading">
        <div v-for="field in notificationEditFields" :key="field" class="space-y-1">
          <label :for="`${id}-${field}`" class="block dd-text-label">{{ t(`notificationEditor.fields.${field}`) }}</label>
          <input v-if="field === 'digestcron'" :id="`${id}-${field}`" :data-field="field" class="w-full min-w-0 px-3 py-2 dd-rounded dd-text-value font-mono disabled:opacity-60" :style="inputStyle" type="text" autocomplete="off" :value="drafts[field]?.value ?? ''" :disabled="!editable(field)" @input="change(field, $event)" />
          <select v-else :id="`${id}-${field}`" :data-field="field" class="w-full min-w-0 px-3 py-2 dd-rounded dd-text-value disabled:opacity-60" :style="inputStyle" :value="drafts[field]?.value ?? ''" :disabled="!editable(field)" @change="change(field, $event)">
            <option v-if="drafts[field]?.value === undefined" value="" disabled>{{ t('watcherEditor.none') }}</option>
            <template v-if="isBooleanPolicyField(field)"><option value="true">{{ t('common.yes') }}</option><option value="false">{{ t('common.no') }}</option></template>
            <option v-for="value in isBooleanPolicyField(field) ? [] : field === 'threshold' ? notificationThresholds : notificationModes" :key="value" :value="value">{{ value }}</option>
          </select>
          <p class="dd-text-muted text-xs">{{ t(`watcherEditor.sources.${row.fields[field].source}`) }}</p>
          <p v-if="row.fields[field].readOnlyReason" class="dd-text-muted text-xs">{{ reason(field) }}</p>
          <p v-if="!row.agent && row.fields[field].source !== 'reference' && row.fields[field].effectiveValue !== undefined" class="dd-text-muted text-xs break-all">{{ t('watcherEditor.current', { value: row.fields[field].effectiveValue }) }}</p>
          <p v-if="drafts[field]?.operation === 'remove'" class="dd-text-warning text-xs">{{ t('watcherEditor.pendingRemoval') }}</p>
          <AppButton :data-reset="field" size="xs" variant="text-secondary" :disabled="!editable(field) || !row.fields[field].present" @click="remove(field)">{{ t('watcherEditor.reset') }}</AppButton>
        </div>
      </template>
      <p v-if="conflict" role="alert" class="dd-text-warning">{{ t('watcherEditor.conflict') }}</p>
      <div v-if="result" :role="hasProblems ? 'alert' : 'status'" :class="hasProblems ? 'dd-text-warning' : 'dd-text-success'" class="space-y-1 text-sm break-words">
        <p>{{ t(result.saved ? (hasProblems ? 'watcherEditor.notApplied' : 'watcherEditor.saved') : 'watcherEditor.notSaved') }}</p>
        <ul v-if="result.errors.length || result.reload?.errors.length" class="list-disc pl-4"><li v-for="(error, index) in [...result.errors, ...(result.reload?.errors ?? [])]" :key="index">{{ error.path }}: {{ error.message }}</li></ul>
        <p v-if="result.reload?.reconcile">{{ t('watcherEditor.reconciled', result.reload.reconcile) }}</p>
        <p v-if="result.restartRequired.length">{{ t('watcherEditor.restart', { fields: result.restartRequired.join(', ') }) }}</p>
        <p v-for="orphan in result.reload?.orphanedRules" :key="`${orphan.ruleId}:${orphan.triggerId}`">{{ t('watcherEditor.orphaned', orphan) }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <AppButton data-testid="save-notification-policy" type="submit" variant="success" :disabled="!canSave">{{ saving ? t('common.loading') : t('common.save') }}</AppButton>
        <AppButton data-testid="cancel-notification-policy" variant="outlined" @click="cancel">{{ t('common.cancel') }}</AppButton>
        <AppButton v-if="needsReload || errorKey" data-testid="reload-notification-policy" variant="warning" :disabled="saving || loading" @click="open">{{ t('watcherEditor.reload') }}</AppButton>
      </div>
    </form>
  </section>
</template>
