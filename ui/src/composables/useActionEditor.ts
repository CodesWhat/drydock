import { computed, onScopeDispose, ref, watch } from 'vue';
import {
  type ActionEditField,
  ActionEditorHttpError,
  type ActionEditRow,
  type ActionIdentity,
  actionAutoModes,
  actionEditFields,
  getActionEditor,
  saveActionEdits,
} from '../services/action-editor';
import type { WatcherEditChange, WatcherEditOutcome } from '../services/config-editor';

interface Draft {
  value: string;
  operation: 'keep' | 'set' | 'remove';
}
function displayValue(field: ActionEditField, value: unknown): string {
  if (value === undefined) return '';
  if (field !== 'auto') return String(value);
  if (typeof value === 'boolean') return value ? 'all' : 'none';
  return String(value).toLowerCase();
}
function parsedValue(field: ActionEditField, value: string): string | number | undefined {
  if (field === 'auto') return actionAutoModes.find((mode) => mode === value);
  if (!value.trim()) return undefined;
  const number = Number(value);
  if (
    !Number.isFinite(number) ||
    (field === 'concurrency' && (!Number.isInteger(number) || number <= 0))
  )
    return undefined;
  return number;
}
export function useActionEditor(identity: () => ActionIdentity) {
  const active = ref(false),
    loading = ref(false),
    saving = ref(false);
  const row = ref<ActionEditRow>(),
    revision = ref('');
  const drafts = ref<Partial<Record<ActionEditField, Draft>>>({});
  const errorKey = ref(''),
    result = ref<WatcherEditOutcome>();
  const conflict = ref(false),
    needsReload = ref(false);
  let requestId = 0;
  function cancel() {
    requestId += 1;
    active.value = false;
    loading.value = false;
    saving.value = false;
    row.value = undefined;
    revision.value = '';
    drafts.value = {};
    errorKey.value = '';
    result.value = undefined;
    conflict.value = false;
    needsReload.value = false;
  }
  watch(
    () => JSON.stringify([identity().id, identity().type, identity().name, identity().agent]),
    cancel,
    { flush: 'sync' },
  );
  onScopeDispose(cancel);
  function failureKey(error: unknown, fallback: string) {
    if (error instanceof ActionEditorHttpError) {
      if (error.status === 401 || error.status === 403) return 'accessDenied';
      if (error.status === 404 || error.status === 501) return 'apiUnavailable';
      if (error.status === 429) return 'rateLimited';
    }
    return fallback;
  }
  async function open() {
    if (loading.value || saving.value) return;
    cancel();
    active.value = true;
    loading.value = true;
    const current = ++requestId,
      target = { ...identity() };
    try {
      const snapshot = await getActionEditor();
      if (current !== requestId) return;
      row.value = snapshot.actions.find(
        (item) =>
          item.category === 'action' &&
          item.id === target.id &&
          item.type === target.type &&
          item.name === target.name &&
          item.agent === target.agent,
      );
      if (!snapshot.available) {
        errorKey.value = 'fileUnavailable';
        return;
      }
      if (!row.value || !snapshot.revision) {
        errorKey.value = 'actionUnavailable';
        return;
      }
      revision.value = snapshot.revision;
      for (const field of actionEditFields) {
        const descriptor = row.value.fields[field];
        drafts.value[field] = {
          operation: 'keep',
          value:
            descriptor.source === 'reference' || row.value.agent
              ? ''
              : displayValue(field, descriptor.value ?? descriptor.effectiveValue),
        };
      }
    } catch (error) {
      if (current === requestId) {
        row.value = undefined;
        revision.value = '';
        drafts.value = {};
        errorKey.value = failureKey(error, 'loadFailed');
      }
    } finally {
      if (current === requestId) loading.value = false;
    }
  }
  function editable(field: ActionEditField) {
    const descriptor = row.value?.fields[field];
    return (
      !!revision.value &&
      !row.value?.agent &&
      !!descriptor?.path &&
      !descriptor.readOnlyReason &&
      !loading.value &&
      !saving.value &&
      !needsReload.value
    );
  }
  function setValue(field: ActionEditField, value: string) {
    if (editable(field)) drafts.value[field] = { operation: 'set', value };
  }
  function remove(field: ActionEditField) {
    if (editable(field) && row.value?.fields[field].present)
      drafts.value[field] = { operation: 'remove', value: '' };
  }
  function invalid(field: ActionEditField) {
    const draft = drafts.value[field];
    return draft?.operation === 'set' && parsedValue(field, draft.value) === undefined;
  }
  const changes = computed<WatcherEditChange[]>(() =>
    actionEditFields.flatMap<WatcherEditChange>((field) => {
      const descriptor = row.value?.fields[field],
        draft = drafts.value[field];
      if (!descriptor?.path || !draft || draft.operation === 'keep') return [];
      if (draft.operation === 'remove')
        return [{ path: [...descriptor.path], operation: 'remove' }];
      const value = parsedValue(field, draft.value);
      if (
        value === undefined ||
        (descriptor.present && value === parsedValue(field, displayValue(field, descriptor.value)))
      )
        return [];
      return [{ path: [...descriptor.path], operation: 'set', value }];
    }),
  );
  const canSave = computed(
    () =>
      active.value &&
      !!revision.value &&
      !loading.value &&
      !saving.value &&
      !needsReload.value &&
      !actionEditFields.some(invalid) &&
      changes.value.length > 0,
  );
  async function save() {
    if (!canSave.value) return;
    const current = requestId,
      request = { revision: revision.value, changes: changes.value };
    saving.value = true;
    errorKey.value = '';
    result.value = undefined;
    try {
      const outcome = await saveActionEdits(request);
      if (current !== requestId) return;
      result.value = outcome;
      conflict.value = outcome.status === 409;
      needsReload.value = outcome.saved || conflict.value;
    } catch (error) {
      if (current === requestId) {
        errorKey.value = failureKey(error, 'saveUncertain');
        needsReload.value = true;
      }
    } finally {
      if (current === requestId) saving.value = false;
    }
  }
  const hasProblems = computed(
    () =>
      !!result.value &&
      (!result.value.applied ||
        result.value.reload?.applied === false ||
        result.value.errors.length > 0 ||
        (result.value.reload?.errors.length ?? 0) > 0 ||
        (result.value.reload?.reconcile?.errors ?? 0) > 0),
  );
  return {
    active,
    loading,
    saving,
    row,
    drafts,
    errorKey,
    result,
    conflict,
    needsReload,
    changes,
    canSave,
    hasProblems,
    editable,
    invalid,
    setValue,
    remove,
    open,
    cancel,
    save,
  };
}
