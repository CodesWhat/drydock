import { computed, onScopeDispose, ref, watch } from 'vue';
import {
  getWatcherEditor,
  saveWatcherEdits,
  type WatcherEditChange,
  type WatcherEditField,
  type WatcherEditOutcome,
  WatcherEditorHttpError,
  type WatcherEditRow,
  type WatcherIdentity,
  watcherEditFields,
} from '../services/config-editor';

interface Draft {
  value: string;
  operation: 'keep' | 'set' | 'remove';
}

export function useWatcherEditor(identity: () => WatcherIdentity) {
  const active = ref(false),
    loading = ref(false),
    saving = ref(false);
  const row = ref<WatcherEditRow>();
  const revision = ref('');
  const drafts = ref<Partial<Record<WatcherEditField, Draft>>>({});
  const errorKey = ref('');
  const result = ref<WatcherEditOutcome>();
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

  watch(() => JSON.stringify([identity().id, identity().name, identity().agent]), cancel, {
    flush: 'sync',
  });
  onScopeDispose(cancel);

  function failureKey(error: unknown, fallback: string) {
    if (error instanceof WatcherEditorHttpError) {
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
    const current = ++requestId;
    const target = { ...identity() };
    try {
      const snapshot = await getWatcherEditor();
      if (current !== requestId) return;
      row.value = snapshot.watchers.find(
        (item) => item.id === target.id && item.name === target.name && item.agent === target.agent,
      );
      if (!snapshot.available) {
        errorKey.value = 'fileUnavailable';
        return;
      }
      if (!row.value || !snapshot.revision) {
        errorKey.value = 'watcherUnavailable';
        return;
      }
      revision.value = snapshot.revision;
      for (const field of watcherEditFields) {
        const descriptor = row.value.fields[field];
        drafts.value[field] = {
          operation: 'keep',
          value:
            descriptor.source === 'reference'
              ? ''
              : String(descriptor.value ?? descriptor.effectiveValue ?? ''),
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

  function editable(field: WatcherEditField) {
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

  function setValue(field: WatcherEditField, value: string) {
    if (!editable(field)) return;
    drafts.value[field] = { operation: 'set', value };
  }

  function remove(field: WatcherEditField) {
    if (!editable(field) || !row.value?.fields[field].present) return;
    drafts.value[field] = { operation: 'remove', value: '' };
  }

  const changes = computed<WatcherEditChange[]>(() =>
    watcherEditFields.flatMap<WatcherEditChange>((field) => {
      const descriptor = row.value?.fields[field],
        draft = drafts.value[field];
      if (!descriptor?.path || !draft || draft.operation === 'keep') return [];
      if (draft.operation === 'remove')
        return [{ path: [...descriptor.path], operation: 'remove' as const }];
      if (descriptor.present && draft.value === String(descriptor.value)) return [];
      return [{ path: [...descriptor.path], operation: 'set' as const, value: draft.value }];
    }),
  );
  const canSave = computed(
    () =>
      active.value &&
      !!revision.value &&
      !loading.value &&
      !saving.value &&
      !needsReload.value &&
      changes.value.length > 0,
  );

  async function save() {
    if (!canSave.value) return;
    const current = requestId;
    const request = { revision: revision.value, changes: changes.value };
    saving.value = true;
    errorKey.value = '';
    result.value = undefined;
    try {
      const outcome = await saveWatcherEdits(request);
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
    setValue,
    remove,
    open,
    cancel,
    save,
  };
}
