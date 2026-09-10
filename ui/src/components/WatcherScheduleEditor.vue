<script setup lang="ts">
import { useId, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AppButton from './AppButton.vue';
import { useWatcherEditor } from '../composables/useWatcherEditor';
import {
  watcherEditFields,
  type WatcherEditField,
  type WatcherIdentity,
} from '../services/config-editor';

const props = defineProps<{ watcher: WatcherIdentity }>();
const emit = defineEmits<{ saved: [watcher: WatcherIdentity] }>();
const { t } = useI18n();
const id = useId();
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
} = useWatcherEditor(() => props.watcher);
watch(result, (outcome) => {
  if (outcome?.saved) emit('saved', { ...props.watcher });
});
const reasonKeys: Record<string, string> = {
  'environment-owned': 'environment',
  'referenced-field': 'reference',
  'agent-watcher': 'agent',
};
function reason(field: WatcherEditField) {
  const value = row.value?.fields[field].readOnlyReason;
  return t(`watcherEditor.readOnly.${reasonKeys[value ?? ''] ?? 'other'}`);
}
</script>

<template>
  <section class="space-y-3 border-t dd-border pt-4" :aria-labelledby="`${id}-title`">
    <h3 :id="`${id}-title`" class="dd-text-heading-section">{{ t('watcherEditor.title') }}</h3>
    <p class="dd-text-card-description">{{ t('watcherEditor.boundary') }}</p>
    <AppButton v-if="!active" data-testid="edit-schedule" variant="outlined" @click="open">{{ t('watcherEditor.edit') }}</AppButton>
    <form v-else class="space-y-3" @submit.prevent="save">
      <p v-if="loading" role="status">{{ t('common.loading') }}</p>
      <p v-if="errorKey" role="alert" class="dd-text-danger">{{ t(`watcherEditor.${errorKey}`) }}</p>
      <template v-if="row && !loading">
        <div v-for="field in watcherEditFields" :key="field" class="space-y-1">
          <label :for="`${id}-${field}`" class="block dd-text-label">{{ t(`watcherEditor.fields.${field}`) }}</label>
          <select v-if="field === 'maintenancewindowscope'" :id="`${id}-${field}`" :data-field="field" class="w-full min-w-0 px-3 py-2 dd-rounded dd-text-value disabled:opacity-60" :style="inputStyle" :value="drafts[field]?.value ?? ''" :disabled="!editable(field)" @change="setValue(field, ($event.target as HTMLSelectElement).value)">
            <option value="">{{ t('watcherEditor.none') }}</option>
            <option value="install">{{ t('watcherEditor.install') }}</option>
            <option value="scan">{{ t('watcherEditor.scan') }}</option>
          </select>
          <input v-else :id="`${id}-${field}`" :data-field="field" class="w-full min-w-0 px-3 py-2 dd-rounded dd-text-value font-mono disabled:opacity-60" :style="inputStyle" type="text" autocomplete="off" :value="drafts[field]?.value ?? ''" :disabled="!editable(field)" @input="setValue(field, ($event.target as HTMLInputElement).value)" />
          <p class="dd-text-muted text-xs">{{ t(`watcherEditor.sources.${row.fields[field].source}`) }}</p>
          <p v-if="row.fields[field].readOnlyReason" class="dd-text-muted text-xs">{{ reason(field) }}</p>
          <p v-if="row.fields[field].source !== 'reference' && row.fields[field].effectiveValue !== undefined" class="dd-text-muted text-xs break-all">{{ t('watcherEditor.current', { value: row.fields[field].effectiveValue }) }}</p>
          <p v-if="drafts[field]?.operation === 'remove'" class="dd-text-warning text-xs">{{ t('watcherEditor.pendingRemoval') }}</p>
          <AppButton :data-reset="field" size="xs" variant="text-secondary" :disabled="!editable(field) || !row.fields[field].present" @click="remove(field)">{{ t('watcherEditor.reset') }}</AppButton>
        </div>
      </template>
      <p v-if="conflict" role="alert" class="dd-text-warning">{{ t('watcherEditor.conflict') }}</p>
      <div v-if="result" :role="hasProblems ? 'alert' : 'status'" :class="hasProblems ? 'dd-text-warning' : 'dd-text-success'" class="space-y-1 text-sm break-words">
        <p>{{ t(result.saved ? (hasProblems ? 'watcherEditor.notApplied' : 'watcherEditor.saved') : 'watcherEditor.notSaved') }}</p>
        <ul v-if="result.errors.length || result.reload?.errors.length" class="list-disc pl-4">
          <li v-for="(error, index) in [...result.errors, ...(result.reload?.errors ?? [])]" :key="index">{{ error.path }}: {{ error.message }}</li>
        </ul>
        <p v-if="result.reload?.reconcile">{{ t('watcherEditor.reconciled', result.reload.reconcile) }}</p>
        <p v-if="result.restartRequired.length">{{ t('watcherEditor.restart', { fields: result.restartRequired.join(', ') }) }}</p>
        <p v-for="orphan in result.reload?.orphanedRules" :key="`${orphan.ruleId}:${orphan.triggerId}`">{{ t('watcherEditor.orphaned', orphan) }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <AppButton data-testid="save-schedule" type="submit" variant="success" :disabled="!canSave">{{ saving ? t('common.loading') : t('common.save') }}</AppButton>
        <AppButton data-testid="cancel-schedule" variant="outlined" @click="cancel">{{ t('common.cancel') }}</AppButton>
        <AppButton v-if="needsReload || errorKey" data-testid="reload-schedule" variant="warning" :disabled="saving || loading" @click="open">{{ t('watcherEditor.reload') }}</AppButton>
      </div>
    </form>
  </section>
</template>
