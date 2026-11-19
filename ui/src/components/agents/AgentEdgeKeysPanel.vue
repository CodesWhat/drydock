<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import DataTable, { type DataTableColumn } from '../DataTable.vue';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import {
  listPortwingKeys,
  type PortwingKey,
  registerPortwingKey,
  revokePortwingKey,
} from '../../services/portwing-key';
import { ApiError, errorMessage } from '../../utils/error';
import {
  buildComposeSnippet,
  buildDockerRunSnippet,
  parsePublicKey,
  publicKeyComment,
} from '../../utils/portwing-edge';

const { t } = useI18n();
const { require: requireConfirm } = useConfirmDialog();

const keys = ref<PortwingKey[]>([]);
const loading = ref(true);
const loadError = ref('');
const actionError = ref('');
/** The API refused this session (API key or recovery login): hide every control that would 403. */
const forbidden = ref(false);

const showForm = ref(false);
const submitting = ref(false);
const formLabel = ref('');
const formPubkey = ref('');
const formError = ref('');
const registeredNotice = ref('');

const showSnippet = ref(false);
const controllerUrl = ref(globalThis.location?.origin ?? '');
const agentName = ref('edge-host-01');
const copiedTarget = ref<'compose' | 'dockerRun' | ''>('');

const composeSnippet = computed(() => buildComposeSnippet(controllerUrl.value, agentName.value));
const dockerRunSnippet = computed(() =>
  buildDockerRunSnippet(controllerUrl.value, agentName.value),
);

function column(key: string, label: string, size: number): DataTableColumn {
  return {
    key,
    label,
    sortable: false,
    size,
    minSize: 90,
    maxSize: 400,
    align: 'text-left',
    overflow: 'truncate',
    px: 'px-3',
  };
}

const columns = computed<DataTableColumn[]>(() => [
  column('label', t('agentsView.edgeKeys.columns.label'), 200),
  column('keyId', t('agentsView.edgeKeys.columns.keyId'), 200),
  column('createdAt', t('agentsView.edgeKeys.columns.created'), 180),
  column('status', t('agentsView.edgeKeys.columns.status'), 120),
]);

/** Rows are informational; selecting one does nothing. */
function isStaticTableRow() {
  return false;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function isRevoked(key: PortwingKey): boolean {
  return key.revokedAt !== null;
}

async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    keys.value = await listPortwingKeys();
    forbidden.value = false;
  } catch (e: unknown) {
    keys.value = [];
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      forbidden.value = true;
    } else {
      loadError.value = errorMessage(e, t('agentsView.edgeKeys.loadError'));
    }
  } finally {
    loading.value = false;
  }
}

function openForm() {
  actionError.value = '';
  registeredNotice.value = '';
  formError.value = '';
  showForm.value = true;
}

function closeForm() {
  showForm.value = false;
  formLabel.value = '';
  formPubkey.value = '';
  formError.value = '';
}

function onPubkeyInput() {
  // `portwing keygen -pub-from` prints a comment after the key; offer it as the label.
  if (!formLabel.value.trim()) {
    formLabel.value = publicKeyComment(formPubkey.value);
  }
}

const canSubmit = computed(
  () =>
    formLabel.value.trim().length > 0 && formPubkey.value.trim().length > 0 && !submitting.value,
);

async function submitForm() {
  if (!canSubmit.value) {
    return;
  }
  const pubkeyBase64 = parsePublicKey(formPubkey.value);
  if (!pubkeyBase64) {
    formError.value = t('agentsView.edgeKeys.form.invalidKey');
    return;
  }
  submitting.value = true;
  formError.value = '';
  actionError.value = '';
  try {
    const created = await registerPortwingKey({ pubkeyBase64, label: formLabel.value.trim() });
    registeredNotice.value = t('agentsView.edgeKeys.registered', {
      label: created.label,
      keyId: created.keyId,
    });
    showSnippet.value = true;
    closeForm();
    await load();
  } catch (e: unknown) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      forbidden.value = true;
      closeForm();
    }
    actionError.value = errorMessage(e, t('agentsView.edgeKeys.errors.register'));
  } finally {
    submitting.value = false;
  }
}

async function performRevoke(key: PortwingKey) {
  actionError.value = '';
  registeredNotice.value = '';
  try {
    await revokePortwingKey(key.keyId);
    await load();
  } catch (e: unknown) {
    actionError.value = errorMessage(e, t('agentsView.edgeKeys.errors.revoke'));
  }
}

function confirmRevoke(key: PortwingKey) {
  requireConfirm({
    header: t('agentsView.edgeKeys.revoke.header'),
    message: t('agentsView.edgeKeys.revoke.message', { label: key.label }),
    acceptLabel: t('agentsView.edgeKeys.revoke.accept'),
    rejectLabel: t('common.cancel'),
    severity: 'danger',
    accept: () => performRevoke(key),
  });
}

async function copySnippet(target: 'compose' | 'dockerRun') {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard) {
    return;
  }
  await clipboard.writeText(target === 'compose' ? composeSnippet.value : dockerRunSnippet.value);
  copiedTarget.value = target;
}

void load();
</script>

<template>
  <div class="dd-rounded overflow-hidden mt-4" :style="{ backgroundColor: 'var(--dd-bg-card)' }" data-testid="edge-keys-panel">
    <div class="px-5 py-4 flex items-start justify-between gap-4">
      <div class="min-w-0">
        <div class="dd-text-heading-section dd-text">{{ t('agentsView.edgeKeys.title') }}</div>
        <div class="dd-text-card-description">{{ t('agentsView.edgeKeys.description') }}</div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <AppButton variant="outlined" size="sm" @click="showSnippet = !showSnippet">
          {{ showSnippet ? t('agentsView.edgeKeys.snippet.hide') : t('agentsView.edgeKeys.snippet.show') }}
        </AppButton>
        <AppButton v-if="!forbidden" variant="secondary" size="sm" @click="openForm">
          {{ t('agentsView.edgeKeys.registerButton') }}
        </AppButton>
      </div>
    </div>

    <div class="p-5 space-y-4">
      <div
        v-if="forbidden"
        class="dd-text-body px-3 py-2 dd-rounded"
        role="status"
        data-testid="edge-keys-forbidden"
        :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning-badge)' }"
      >
        {{ t('agentsView.edgeKeys.forbidden') }}
      </div>

      <div
        v-if="loadError || actionError"
        class="dd-text-body px-3 py-2 dd-rounded"
        role="alert"
        :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger-badge)' }"
      >
        {{ loadError || actionError }}
      </div>

      <div
        v-if="registeredNotice"
        class="dd-text-body px-3 py-2 dd-rounded"
        data-testid="edge-keys-registered"
        :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success-badge)' }"
      >
        {{ registeredNotice }}
      </div>

      <div v-if="showForm" class="dd-rounded p-4 space-y-3" :style="{ border: '1px solid var(--dd-border)' }">
        <div class="dd-text-label font-medium dd-text">{{ t('agentsView.edgeKeys.form.title') }}</div>

        <label class="block space-y-1">
          <span class="dd-text-label dd-text-muted">{{ t('agentsView.edgeKeys.form.label') }}</span>
          <input
            v-model="formLabel"
            type="text"
            class="w-full px-3 py-2 dd-rounded dd-text-value"
            :placeholder="t('agentsView.edgeKeys.form.labelPlaceholder')"
            :style="{ backgroundColor: 'var(--dd-bg)', border: '1px solid var(--dd-border)' }"
          />
        </label>

        <label class="block space-y-1">
          <span class="dd-text-label dd-text-muted">{{ t('agentsView.edgeKeys.form.pubkey') }}</span>
          <textarea
            v-model="formPubkey"
            rows="2"
            class="w-full px-3 py-2 dd-rounded dd-text-code"
            :placeholder="t('agentsView.edgeKeys.form.pubkeyPlaceholder')"
            :style="{ backgroundColor: 'var(--dd-bg)', border: '1px solid var(--dd-border)' }"
            @input="onPubkeyInput"
          />
          <span class="dd-text-card-description">{{ t('agentsView.edgeKeys.form.pubkeyHint') }}</span>
        </label>

        <div
          v-if="formError"
          class="dd-text-body px-3 py-2 dd-rounded"
          role="alert"
          :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger-badge)' }"
        >
          {{ formError }}
        </div>

        <div class="flex items-center gap-2">
          <AppButton variant="secondary" size="sm" :disabled="!canSubmit" @click="submitForm">
            {{ t('agentsView.edgeKeys.form.submit') }}
          </AppButton>
          <AppButton variant="plain" size="sm" @click="closeForm">
            {{ t('common.cancel') }}
          </AppButton>
        </div>
      </div>

      <div v-if="showSnippet" class="dd-rounded p-4 space-y-3" :style="{ border: '1px solid var(--dd-border)' }" data-testid="edge-keys-snippet">
        <div class="dd-text-label font-medium dd-text">{{ t('agentsView.edgeKeys.snippet.title') }}</div>
        <div class="dd-text-card-description">{{ t('agentsView.edgeKeys.snippet.description') }}</div>

        <label class="block space-y-1">
          <span class="dd-text-label dd-text-muted">{{ t('agentsView.edgeKeys.snippet.controllerUrl') }}</span>
          <input
            v-model="controllerUrl"
            type="text"
            data-testid="edge-keys-controller-url"
            class="w-full px-3 py-2 dd-rounded dd-text-value"
            :style="{ backgroundColor: 'var(--dd-bg)', border: '1px solid var(--dd-border)' }"
          />
        </label>

        <label class="block space-y-1">
          <span class="dd-text-label dd-text-muted">{{ t('agentsView.edgeKeys.snippet.agentName') }}</span>
          <input
            v-model="agentName"
            type="text"
            data-testid="edge-keys-agent-name"
            class="w-full px-3 py-2 dd-rounded dd-text-value"
            :style="{ backgroundColor: 'var(--dd-bg)', border: '1px solid var(--dd-border)' }"
          />
        </label>

        <div class="space-y-1">
          <div class="flex items-center justify-between gap-2">
            <span class="dd-text-label dd-text-muted">{{ t('agentsView.edgeKeys.snippet.compose') }}</span>
            <AppButton variant="outlined" size="xs" data-testid="copy-compose" @click="copySnippet('compose')">
              {{ copiedTarget === 'compose' ? t('agentsView.edgeKeys.snippet.copied') : t('agentsView.edgeKeys.snippet.copy') }}
            </AppButton>
          </div>
          <pre class="dd-text-code p-3 dd-rounded overflow-x-auto" data-testid="snippet-compose" :style="{ backgroundColor: 'var(--dd-bg)' }">{{ composeSnippet }}</pre>
        </div>

        <div class="space-y-1">
          <div class="flex items-center justify-between gap-2">
            <span class="dd-text-label dd-text-muted">{{ t('agentsView.edgeKeys.snippet.dockerRun') }}</span>
            <AppButton variant="outlined" size="xs" data-testid="copy-docker-run" @click="copySnippet('dockerRun')">
              {{ copiedTarget === 'dockerRun' ? t('agentsView.edgeKeys.snippet.copied') : t('agentsView.edgeKeys.snippet.copy') }}
            </AppButton>
          </div>
          <pre class="dd-text-code p-3 dd-rounded overflow-x-auto" data-testid="snippet-docker-run" :style="{ backgroundColor: 'var(--dd-bg)' }">{{ dockerRunSnippet }}</pre>
        </div>
      </div>

      <div v-if="loading" class="flex items-center justify-center gap-2 dd-text-body dd-text-muted py-4">
        <AppIcon name="refresh" :size="12" class="animate-spin" />
        {{ t('agentsView.edgeKeys.loading') }}
      </div>

      <div v-else-if="keys.length === 0 && !loadError && !forbidden" class="dd-text-body dd-text-muted py-4">
        {{ t('agentsView.edgeKeys.empty') }}
      </div>

      <DataTable
        v-else-if="keys.length > 0"
        :columns="columns"
        :rows="keys"
        row-key="keyId"
        storage-key="agent-edge-keys"
        :row-interactive="isStaticTableRow"
        show-actions
        fixed-layout
      >
        <template #cell-label="{ value }">
          <span class="dd-text-value dd-text">{{ value }}</span>
        </template>
        <template #cell-keyId="{ value }">
          <code class="dd-text-code dd-text-muted">{{ value }}</code>
        </template>
        <template #cell-createdAt="{ row }">
          <span class="dd-text-body dd-text-muted">{{ formatTimestamp(row.createdAt) }}</span>
        </template>
        <template #cell-status="{ row }">
          <span
            class="badge dd-text-badge-xs inline-flex"
            :data-testid="`edge-key-${row.keyId}`"
            :style="isRevoked(row)
              ? { backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger-badge)' }
              : { backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success-badge)' }"
          >
            {{ isRevoked(row) ? t('agentsView.edgeKeys.status.revoked') : t('agentsView.edgeKeys.status.active') }}
          </span>
        </template>
        <template #actions="{ row }">
          <AppButton
            v-if="!isRevoked(row) && !forbidden"
            variant="text-danger"
            size="xs"
            @click="confirmRevoke(row)"
          >
            {{ t('agentsView.edgeKeys.revokeButton') }}
          </AppButton>
        </template>
      </DataTable>
    </div>
  </div>
</template>
