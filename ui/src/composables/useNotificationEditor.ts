import { computed, onScopeDispose, ref, watch } from 'vue';
import type { WatcherEditChange, WatcherEditOutcome } from '../services/config-editor';
import {
  getNotificationEditor,
  type NotificationEditField,
  NotificationEditorHttpError,
  type NotificationEditRow,
  type NotificationIdentity,
  notificationEditFields,
  saveNotificationEdits,
} from '../services/notification-editor';

interface Draft {
  value: string | boolean | undefined;
  operation: 'keep' | 'set' | 'remove';
}
export function isBooleanPolicyField(field: NotificationEditField) {
  return field === 'once' || field === 'resolvenotifications';
}
function fieldValue(field: NotificationEditField, value: unknown) {
  if (value === undefined) return undefined;
  if (isBooleanPolicyField(field))
    return typeof value === 'boolean' ? value : String(value).toLowerCase() === 'true';
  return field === 'digestcron' ? String(value) : String(value).toLowerCase();
}

export function useNotificationEditor(identity: () => NotificationIdentity) {
  const active = ref(false),
    loading = ref(false),
    saving = ref(false);
  const row = ref<NotificationEditRow>(),
    revision = ref('');
  const drafts = ref<Partial<Record<NotificationEditField, Draft>>>({});
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
    if (error instanceof NotificationEditorHttpError) {
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
      const snapshot = await getNotificationEditor();
      if (current !== requestId) return;
      row.value = snapshot.triggers.find(
        (item) =>
          item.category === 'notification' &&
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
        errorKey.value = 'triggerUnavailable';
        return;
      }
      revision.value = snapshot.revision;
      for (const field of notificationEditFields) {
        const descriptor = row.value.fields[field];
        drafts.value[field] = {
          operation: 'keep',
          value:
            descriptor.source === 'reference' || row.value.agent
              ? undefined
              : fieldValue(
                  field,
                  descriptor.readOnlyReason === 'provider-forced'
                    ? descriptor.effectiveValue
                    : (descriptor.value ?? descriptor.effectiveValue),
                ),
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
  function editable(field: NotificationEditField) {
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
  function setValue(field: NotificationEditField, value: string | boolean) {
    if (
      !editable(field) ||
      (isBooleanPolicyField(field) ? typeof value !== 'boolean' : typeof value !== 'string')
    )
      return;
    drafts.value[field] = { operation: 'set', value };
  }
  function remove(field: NotificationEditField) {
    if (!editable(field) || !row.value?.fields[field].present) return;
    drafts.value[field] = { operation: 'remove', value: undefined };
  }
  const changes = computed<WatcherEditChange[]>(() =>
    notificationEditFields.flatMap<WatcherEditChange>((field) => {
      const descriptor = row.value?.fields[field],
        draft = drafts.value[field];
      if (!descriptor?.path || !draft || draft.operation === 'keep') return [];
      if (draft.operation === 'remove')
        return [{ path: [...descriptor.path], operation: 'remove' }];
      if (descriptor.present && draft.value === fieldValue(field, descriptor.value)) return [];
      return [{ path: [...descriptor.path], operation: 'set', value: draft.value }];
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
    const current = requestId,
      request = { revision: revision.value, changes: changes.value };
    saving.value = true;
    errorKey.value = '';
    result.value = undefined;
    try {
      const outcome = await saveNotificationEdits(request);
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
    setValue,
    remove,
    open,
    cancel,
    save,
  };
}
