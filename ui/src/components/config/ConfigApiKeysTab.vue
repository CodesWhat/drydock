<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import DataTable from '../../components/DataTable.vue';
import { useConfirmDialog } from '../../composables/useConfirmDialog';
import {
  API_KEY_PAGE_SIZE,
  API_SCOPES,
  type ApiKey,
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from '../../services/api-key';
import { errorMessage } from '../../utils/error';

const { t } = useI18n();
const { require: requireConfirm } = useConfirmDialog();

const keys = ref<ApiKey[]>([]);
const total = ref(0);
const nextCursor = ref<string | undefined>();
const loadingMore = ref(false);
const loading = ref(true);
const loadError = ref('');
const actionError = ref('');

const showForm = ref(false);
const submitting = ref(false);
const formName = ref('');
const formScopes = ref<string[]>(['read']);
const formExpiresAt = ref('');
const formRateLimit = ref('');

/**
 * The credential from the most recent create. Held in component state only:
 * it is never written to a store, a preference, or the URL, because anything
 * that outlives the page turns a one-time reveal into a stored secret.
 */
const revealedKey = ref('');
const revealedName = ref('');
const copied = ref(false);
const cascadeNotice = ref('');

const scopeLabelKeys: Record<string, string> = {
  read: 'read',
  'containers:watch': 'containersWatch',
  'containers:update': 'containersUpdate',
  'triggers:test': 'triggersTest',
  admin: 'admin',
  'api-keys:manage': 'apiKeysManage',
};

const scopeOptions = computed(() =>
  API_SCOPES.map((scope) => ({
    id: scope,
    label: t(`configView.apiKeys.scopes.${scopeLabelKeys[scope]}`),
  })),
);

/**
 * Sizes are numeric so the shared column-sizing standard can resize and persist
 * them; a string width would opt this table out of it.
 */
const columns = computed(() => [
  {
    key: 'name',
    label: t('configView.apiKeys.columns.name'),
    sortable: false,
    size: 160,
    minSize: 120,
    maxSize: 320,
    align: 'text-left',
    overflow: 'truncate',
    px: 'px-3',
  },
  {
    key: 'displayPrefix',
    label: t('configView.apiKeys.columns.key'),
    sortable: false,
    size: 200,
    minSize: 160,
    maxSize: 320,
    align: 'text-left',
    overflow: 'truncate',
    px: 'px-3',
  },
  {
    key: 'scopes',
    label: t('configView.apiKeys.columns.scopes'),
    sortable: false,
    size: 220,
    minSize: 140,
    maxSize: 480,
    flex: 1,
    align: 'text-left',
    overflow: 'clamp-2',
    px: 'px-3',
  },
  {
    key: 'lastUsedAt',
    label: t('configView.apiKeys.columns.lastUsed'),
    sortable: false,
    size: 180,
    minSize: 120,
    maxSize: 260,
    align: 'text-left',
    overflow: 'truncate',
    px: 'px-3',
  },
  {
    key: 'expiresAt',
    label: t('configView.apiKeys.columns.expires'),
    sortable: false,
    size: 180,
    minSize: 120,
    maxSize: 260,
    align: 'text-left',
    overflow: 'truncate',
    px: 'px-3',
  },
  {
    key: 'status',
    label: t('configView.apiKeys.columns.status'),
    sortable: false,
    size: 120,
    minSize: 90,
    maxSize: 180,
    align: 'text-left',
    px: 'px-3',
  },
]);

/** Rows are informational; selecting one does nothing, so none is interactive. */
function isStaticTableRow() {
  return false;
}

const canSubmit = computed(
  () => formName.value.trim().length > 0 && formScopes.value.length > 0 && !submitting.value,
);

function formatTimestamp(value: string | null): string {
  if (!value) {
    return t('configView.apiKeys.never');
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function statusLabel(status: ApiKey['status']): string {
  return t(`configView.apiKeys.status.${status}`);
}

function statusStyle(status: ApiKey['status']): Record<string, string> {
  if (status === 'active') {
    return { backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' };
  }
  if (status === 'expired') {
    return { backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' };
  }
  return { backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' };
}

function toggleScope(scope: string) {
  formScopes.value = formScopes.value.includes(scope)
    ? formScopes.value.filter((entry) => entry !== scope)
    : [...formScopes.value, scope];
}

/**
 * The server's own ceiling on one page. Asking for more is not an error, it is
 * silently truncated, so a reload that wanted everything on screen would come
 * back short without saying so.
 */
const MAX_PAGE_SIZE = 200;

/**
 * Re-read from the top, keeping as many keys as are already on screen.
 *
 * A plain first-page reload would collapse a table the operator had paged
 * through every time they revoked a key, so this asks for what is showing
 * rather than for a page.
 */
async function load() {
  loading.value = true;
  loadError.value = '';
  try {
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(API_KEY_PAGE_SIZE, keys.value.length));
    const page = await listApiKeys({ limit });
    keys.value = page.data;
    total.value = page.total;
    nextCursor.value = page.nextCursor;
  } catch (e: unknown) {
    keys.value = [];
    total.value = 0;
    nextCursor.value = undefined;
    loadError.value = errorMessage(e, t('configView.apiKeys.errors.load'));
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  const cursor = nextCursor.value;
  if (loadingMore.value || cursor === undefined) {
    return;
  }
  loadingMore.value = true;
  loadError.value = '';
  try {
    // The server's cursor, not a count of what is on screen. A key minted
    // while the operator is reading sorts ahead of it and is simply not part
    // of this walk, so nothing is skipped and nothing repeats.
    const page = await listApiKeys({ cursor });
    keys.value = [...keys.value, ...page.data];
    total.value = page.total;
    nextCursor.value = page.nextCursor;
  } catch (e: unknown) {
    loadError.value = errorMessage(e, t('configView.apiKeys.errors.load'));
  } finally {
    loadingMore.value = false;
  }
}

function resetForm() {
  formName.value = '';
  formScopes.value = ['read'];
  formExpiresAt.value = '';
  formRateLimit.value = '';
}

function openForm() {
  // Opening the form clears a previous reveal: two credentials on screen at
  // once makes it ambiguous which one was just minted.
  revealedKey.value = '';
  revealedName.value = '';
  actionError.value = '';
  cascadeNotice.value = '';
  showForm.value = true;
}

function closeForm() {
  showForm.value = false;
  resetForm();
}

async function submitForm() {
  if (!canSubmit.value) {
    return;
  }
  submitting.value = true;
  actionError.value = '';
  try {
    const parsedRateLimit = Number.parseInt(formRateLimit.value, 10);
    const created = await createApiKey({
      name: formName.value.trim(),
      scopes: formScopes.value,
      expiresAt: formExpiresAt.value ? new Date(formExpiresAt.value).toISOString() : null,
      ...(Number.isFinite(parsedRateLimit) && parsedRateLimit > 0
        ? { rateLimitMax: parsedRateLimit }
        : {}),
    });
    revealedKey.value = created.apiKey;
    revealedName.value = created.name;
    copied.value = false;
    closeForm();
    await load();
  } catch (e: unknown) {
    actionError.value = errorMessage(e, t('configView.apiKeys.errors.create'));
  } finally {
    submitting.value = false;
  }
}

async function copyRevealedKey() {
  const clipboard = globalThis.navigator?.clipboard;
  if (!clipboard) {
    return;
  }
  await clipboard.writeText(revealedKey.value);
  copied.value = true;
}

function dismissReveal() {
  revealedKey.value = '';
  revealedName.value = '';
  copied.value = false;
}

async function performRevoke(key: ApiKey) {
  actionError.value = '';
  cascadeNotice.value = '';
  try {
    const result = await revokeApiKey(key.keyId);
    if (result.cascadeCount > 1) {
      cascadeNotice.value = t('configView.apiKeys.cascade', { count: result.cascadeCount });
    }
    await load();
  } catch (e: unknown) {
    actionError.value = errorMessage(e, t('configView.apiKeys.errors.revoke'));
  }
}

function confirmRevoke(key: ApiKey) {
  requireConfirm({
    header: t('configView.apiKeys.revoke.header'),
    message: t('configView.apiKeys.revoke.message', { name: key.name }),
    acceptLabel: t('configView.apiKeys.revoke.accept'),
    rejectLabel: t('common.cancel'),
    severity: 'danger',
    accept: () => performRevoke(key),
  });
}

void load();

defineExpose({ load });
</script>

<template>
  <div class="space-y-6">
    <div class="dd-rounded overflow-hidden" :style="{ backgroundColor: 'var(--dd-bg-card)' }">
      <div class="px-5 py-4 flex items-start justify-between gap-4">
        <div class="min-w-0">
          <div class="dd-text-heading-section dd-text">{{ t('configView.apiKeys.title') }}</div>
          <div class="dd-text-card-description">{{ t('configView.apiKeys.description') }}</div>
        </div>
        <AppButton variant="secondary" size="sm" @click="openForm">
          {{ t('configView.apiKeys.createButton') }}
        </AppButton>
      </div>

      <div class="p-5 space-y-4">
        <div
          v-if="revealedKey"
          class="dd-rounded p-4 space-y-2"
          :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }"
        >
          <div class="dd-text-label font-medium">{{ t('configView.apiKeys.reveal.title') }}</div>
          <div class="dd-text-body">{{ t('configView.apiKeys.reveal.description') }}</div>
          <div class="flex items-center gap-2 flex-wrap">
            <code class="dd-text-value break-all" data-testid="revealed-key">{{ revealedKey }}</code>
            <AppButton variant="outlined" size="xs" @click="copyRevealedKey">
              {{ copied ? t('configView.apiKeys.reveal.copied') : t('configView.apiKeys.reveal.copy') }}
            </AppButton>
            <AppButton variant="plain" size="xs" @click="dismissReveal">
              {{ t('common.close') }}
            </AppButton>
          </div>
        </div>

        <div
          v-if="loadError || actionError"
          class="dd-text-body px-3 py-2 dd-rounded"
          :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }"
        >
          {{ loadError || actionError }}
        </div>

        <div
          v-if="cascadeNotice"
          class="dd-text-body px-3 py-2 dd-rounded"
          :style="{ backgroundColor: 'var(--dd-primary-muted)', color: 'var(--dd-primary)' }"
        >
          {{ cascadeNotice }}
        </div>

        <div v-if="showForm" class="dd-rounded p-4 space-y-3" :style="{ border: '1px solid var(--dd-border)' }">
          <div class="dd-text-label font-medium dd-text">{{ t('configView.apiKeys.form.title') }}</div>

          <label class="block space-y-1">
            <span class="dd-text-label dd-text-muted">{{ t('configView.apiKeys.form.name') }}</span>
            <input
              v-model="formName"
              type="text"
              class="w-full px-3 py-2 dd-rounded dd-text-value"
              :placeholder="t('configView.apiKeys.form.namePlaceholder')"
              :style="{ backgroundColor: 'var(--dd-bg)', border: '1px solid var(--dd-border)' }"
            />
          </label>

          <fieldset class="space-y-1">
            <legend class="dd-text-label dd-text-muted">{{ t('configView.apiKeys.form.scopes') }}</legend>
            <label
              v-for="option in scopeOptions"
              :key="option.id"
              class="flex items-center gap-2 dd-text-body"
            >
              <input
                type="checkbox"
                :value="option.id"
                :checked="formScopes.includes(option.id)"
                @change="toggleScope(option.id)"
              />
              <span>{{ option.label }}</span>
              <code class="dd-text-badge-xs dd-text-muted">{{ option.id }}</code>
            </label>
          </fieldset>

          <label class="block space-y-1">
            <span class="dd-text-label dd-text-muted">{{ t('configView.apiKeys.form.expires') }}</span>
            <input
              v-model="formExpiresAt"
              type="date"
              class="w-full px-3 py-2 dd-rounded dd-text-value"
              :style="{ backgroundColor: 'var(--dd-bg)', border: '1px solid var(--dd-border)' }"
            />
            <span class="dd-text-card-description">{{ t('configView.apiKeys.form.expiresNever') }}</span>
          </label>

          <label class="block space-y-1">
            <span class="dd-text-label dd-text-muted">{{ t('configView.apiKeys.form.rateLimit') }}</span>
            <input
              v-model="formRateLimit"
              type="number"
              min="1"
              class="w-full px-3 py-2 dd-rounded dd-text-value"
              :style="{ backgroundColor: 'var(--dd-bg)', border: '1px solid var(--dd-border)' }"
            />
          </label>

          <div class="flex items-center gap-2">
            <AppButton variant="secondary" size="sm" :disabled="!canSubmit" @click="submitForm">
              {{ t('configView.apiKeys.form.submit') }}
            </AppButton>
            <AppButton variant="plain" size="sm" @click="closeForm">
              {{ t('common.cancel') }}
            </AppButton>
          </div>
        </div>

        <div v-if="loading" class="flex items-center justify-center gap-2 dd-text-body dd-text-muted py-4">
          <AppIcon name="refresh" :size="12" class="animate-spin" />
          {{ t('configView.apiKeys.loading') }}
        </div>

        <div v-else-if="keys.length === 0 && !loadError" class="dd-text-body dd-text-muted py-4">
          {{ t('configView.apiKeys.empty') }}
        </div>

        <DataTable
          v-else-if="keys.length > 0"
          :columns="columns"
          :rows="keys"
          row-key="keyId"
          storage-key="config-api-keys"
          :row-interactive="isStaticTableRow"
          show-actions
          fixed-layout
        >
          <template #cell-name="{ value }">
            <span class="dd-text-value dd-text">{{ value }}</span>
          </template>
          <template #cell-displayPrefix="{ value }">
            <code class="dd-text-code dd-text-muted">{{ value }}</code>
          </template>
          <template #cell-scopes="{ row }">
            <span class="dd-text-body dd-text-muted">{{ (row as unknown as ApiKey).scopes.join(', ') }}</span>
          </template>
          <template #cell-lastUsedAt="{ value }">
            <span class="dd-text-body dd-text-muted">{{ formatTimestamp(value as string | null) }}</span>
          </template>
          <template #cell-expiresAt="{ value }">
            <span class="dd-text-body dd-text-muted">{{ formatTimestamp(value as string | null) }}</span>
          </template>
          <template #cell-status="{ row }">
            <span
              class="badge dd-text-badge-xs inline-flex"
              :style="statusStyle((row as unknown as ApiKey).status)"
            >
              {{ statusLabel((row as unknown as ApiKey).status) }}
            </span>
          </template>
          <template #actions="{ row }">
            <AppButton
              v-if="(row as unknown as ApiKey).status !== 'revoked'"
              variant="text-danger"
              size="xs"
              @click="confirmRevoke(row as unknown as ApiKey)"
            >
              {{ t('configView.apiKeys.revokeButton') }}
            </AppButton>
          </template>
        </DataTable>

        <div v-if="keys.length > 0" class="flex items-center justify-between gap-3">
          <span class="dd-text-card-description" data-testid="api-keys-count">
            {{ t('configView.apiKeys.showing', { shown: keys.length, total }) }}
          </span>
          <AppButton
            v-if="nextCursor !== undefined"
            variant="outlined"
            size="xs"
            :disabled="loadingMore"
            @click="loadMore"
          >
            {{ loadingMore ? t('configView.apiKeys.loadingMore') : t('configView.apiKeys.loadMore') }}
          </AppButton>
        </div>
      </div>
    </div>
  </div>
</template>
