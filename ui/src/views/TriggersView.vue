<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import AppBadge from '@/components/AppBadge.vue';
import AppIconButton from '@/components/AppIconButton.vue';
import DetailField from '@/components/DetailField.vue';
import { useBreakpoints } from '../composables/useBreakpoints';
import { getAllTriggers, getTrigger, runTrigger } from '../services/trigger';
import type { ApiComponent } from '../types/api';

const { t } = useI18n();
const { isMobile } = useBreakpoints();
const route = useRoute();
const selectedTrigger = ref<Record<string, unknown> | null>(null);
const detailOpen = ref(false);
const detailLoading = ref(false);
const detailError = ref('');
let detailRequestId = 0;

const triggersData = ref<Record<string, unknown>[]>([]);
const loading = ref(true);
const error = ref('');
const testingTrigger = ref<string | null>(null);
const testResult = ref<{ id: string; success: boolean } | null>(null);
const testError = ref<{ id: string; message: string } | null>(null);

function parseTriggerTestErrorMessage(errorValue: unknown): string {
  const defaultMessage = t('triggersView.test.defaultError');
  const message =
    typeof errorValue === 'string'
      ? errorValue
      : typeof errorValue === 'object' &&
          errorValue !== null &&
          'message' in errorValue &&
          typeof errorValue.message === 'string'
        ? errorValue.message
        : '';

  if (!message.trim()) {
    return defaultMessage;
  }

  const nestedMessage = message.match(/^Error when running trigger [^()]+ \((.*)\)$/);
  return nestedMessage?.[1]?.trim() || message.trim();
}

async function testTrigger(trigger: Record<string, unknown>) {
  if (testingTrigger.value) return;
  testingTrigger.value = trigger.id as string;
  testResult.value = null;
  testError.value = null;
  try {
    await runTrigger({
      triggerType: trigger.type as string,
      triggerName: trigger.name as string,
      triggerAgent: (trigger.agent as string | undefined) || undefined,
      container: {
        id: 'test',
        name: t('triggersView.testContainerName'),
        image: { name: 'test/image', tag: { value: 'latest' } },
        result: { tag: 'latest' },
        updateKind: { kind: 'unknown', semverDiff: 'unknown' },
      },
    });
    testResult.value = { id: trigger.id, success: true };
  } catch (e: unknown) {
    testResult.value = { id: trigger.id, success: false };
    testError.value = { id: trigger.id, message: parseTriggerTestErrorMessage(e) };
  } finally {
    testingTrigger.value = null;
    setTimeout(() => {
      testResult.value = null;
      testError.value = null;
    }, 5000);
  }
}

function triggerTypeBadge(type: string) {
  if (type === 'slack')
    return { bg: 'var(--dd-info-muted)', text: 'var(--dd-info)', label: 'Slack' };
  if (type === 'discord')
    return { bg: 'var(--dd-alt-muted)', text: 'var(--dd-alt)', label: 'Discord' };
  if (type === 'smtp')
    return { bg: 'var(--dd-success-muted)', text: 'var(--dd-success)', label: 'SMTP' };
  if (type === 'http')
    return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)', label: 'HTTP' };
  if (type === 'telegram')
    return { bg: 'var(--dd-primary-muted)', text: 'var(--dd-primary)', label: 'Telegram' };
  if (type === 'mqtt')
    return { bg: 'var(--dd-caution-muted)', text: 'var(--dd-caution)', label: 'MQTT' };
  return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)', label: type };
}

const searchQuery = ref('');
const showFilters = ref(false);
const activeFilterCount = computed(() => (searchQuery.value ? 1 : 0));

function applySearchFromQuery(queryValue: unknown) {
  const raw = Array.isArray(queryValue) ? queryValue[0] : queryValue;
  searchQuery.value = typeof raw === 'string' ? raw : '';
}

applySearchFromQuery(route.query.q);
watch(
  () => route.query.q,
  (value) => applySearchFromQuery(value),
);

const filteredTriggers = computed(() => {
  if (!searchQuery.value) return triggersData.value;
  const q = searchQuery.value.toLowerCase();
  return triggersData.value.filter((item) => item.name.toLowerCase().includes(q));
});

const tableColumns = computed(() => [
  {
    key: 'name',
    label: t('triggersView.columns.trigger'),
    sortable: false,
    size: 300,
    minSize: 220,
    maxSize: 560,
    flex: 1,
  },
  {
    key: 'type',
    label: t('triggersView.columns.type'),
    sortable: false,
    size: 120,
    minSize: 96,
    maxSize: 150,
  },
  {
    key: 'status',
    label: t('triggersView.columns.status'),
    sortable: false,
    size: 120,
    minSize: 96,
    maxSize: 150,
  },
]);

function clearFilters() {
  searchQuery.value = '';
}

function mapTrigger(trigger: ApiComponent, status = 'active') {
  return {
    id: trigger.id,
    name: trigger.name,
    type: trigger.type,
    status,
    config: trigger.configuration ?? {},
    agent: trigger.agent,
  };
}

function resetDetailState() {
  detailOpen.value = false;
  detailLoading.value = false;
  detailError.value = '';
  selectedTrigger.value = null;
  detailRequestId += 1;
}

function handleDetailOpenChange(value: boolean) {
  if (!value) {
    resetDetailState();
  } else {
    detailOpen.value = true;
  }
}

async function openDetail(trigger: Record<string, unknown>) {
  selectedTrigger.value = trigger;
  detailOpen.value = true;
  detailLoading.value = true;
  detailError.value = '';
  const requestId = ++detailRequestId;

  try {
    const detail = await getTrigger({
      type: String(trigger.type),
      name: String(trigger.name),
      agent: trigger.agent as string | undefined,
    });
    if (requestId !== detailRequestId || !detailOpen.value) return;
    selectedTrigger.value = mapTrigger(detail, String(trigger.status));
  } catch {
    if (requestId !== detailRequestId) return;
    detailError.value = t('triggersView.detail.loadError');
  } finally {
    if (requestId === detailRequestId) {
      detailLoading.value = false;
    }
  }
}

onMounted(async () => {
  try {
    const data = await getAllTriggers();
    triggersData.value = data.map((trigger: ApiComponent) => mapTrigger(trigger));
  } catch {
    error.value = t('triggersView.loadError');
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <DataViewLayout>
    <div v-if="error"
         class="mb-3 px-3 py-2 text-2xs-plus dd-rounded"
         :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
      {{ error }}
    </div>

    <div v-if="loading" class="text-2xs-plus dd-text-muted py-3 px-1">{{ t('triggersView.loadingTriggers') }}</div>

    <!-- Filter bar -->
    <DataFilterBar
      v-model:showFilters="showFilters"
      :filtered-count="filteredTriggers.length"
      :total-count="triggersData.length"
      :active-filter-count="activeFilterCount"
    >
      <template #filters>
        <input v-model="searchQuery"
               type="text"
               :placeholder="t('triggersView.filterPlaceholder')"
               class="flex-1 min-w-[120px] max-w-[var(--dd-layout-filter-max-width)] px-2.5 py-1.5 dd-rounded text-2xs-plus font-medium outline-none dd-bg dd-text dd-placeholder" />
        <AppButton size="none" variant="text-muted" weight="medium" class="text-2xs" v-if="searchQuery"
                
                @click="clearFilters">
          {{ t('triggersView.clear') }}
        </AppButton>
      </template>
    </DataFilterBar>

    <!-- Table view -->
    <DataTable
      v-if="!loading"
      :columns="tableColumns"
      storage-key="triggers"
      :rows="filteredTriggers"
      row-key="id"
      :active-row="selectedTrigger?.id"
      show-actions
      @row-click="openDetail($event)"
    >
      <template #cell-name="{ row }">
        <span class="font-medium dd-text">{{ row.name }}</span>
      </template>
      <template #cell-type="{ row }">
        <AppBadge :custom="{ bg: triggerTypeBadge(row.type).bg, text: triggerTypeBadge(row.type).text }" size="xs">
          {{ triggerTypeBadge(row.type).label }}
        </AppBadge>
      </template>
      <template #cell-status="{ row }">
        <AppIcon :name="row.status === 'active' ? 'check' : 'xmark'" :size="13" class="shrink-0 md:!hidden"
                 v-tooltip.top="row.status === 'active' ? t('triggersView.status.active') : t('triggersView.status.inactive')"
                 :style="{ color: row.status === 'active' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
        <AppBadge :tone="row.status === 'active' ? 'success' : 'danger'" size="xs" class="max-md:!hidden">
          {{ row.status === 'active' ? t('triggersView.status.active') : t('triggersView.status.inactive') }}
        </AppBadge>
      </template>
      <template #actions="{ row }">
        <AppIconButton
          :icon="testingTrigger === row.id ? 'pending' : testResult?.id === row.id ? (testResult.success ? 'check' : 'xmark') : 'play'"
          size="toolbar"
          variant="plain"
          :aria-label="t('triggersView.test.runTest')"
          :disabled="testingTrigger !== null"
          v-tooltip.top="testingTrigger === row.id ? t('triggersView.test.testing') : testResult?.id === row.id ? (testResult.success ? t('triggersView.test.testPassed') : t('triggersView.test.testFailed')) : t('triggersView.test.runTest')"
          @click.stop="testTrigger(row)"
        />
      </template>
      <template #empty>
        <EmptyState icon="triggers" :message="t('triggersView.emptyFiltered')" show-clear @clear="clearFilters" />
      </template>
    </DataTable>

    <template #panel>
      <DetailPanel
        :open="detailOpen"
        :is-mobile="isMobile"
        :show-size-controls="false"
        :show-full-page="false"
        @update:open="handleDetailOpenChange"
      >
        <template #header>
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="text-sm font-bold truncate dd-text">{{ selectedTrigger?.name }}</span>
            <AppBadge v-if="selectedTrigger" :custom="{ bg: triggerTypeBadge(selectedTrigger.type).bg, text: triggerTypeBadge(selectedTrigger.type).text }" size="xs" class="shrink-0">
              {{ triggerTypeBadge(selectedTrigger.type).label }}
            </AppBadge>
          </div>
        </template>

        <template #subtitle>
          <AppBadge v-if="selectedTrigger" :tone="selectedTrigger.status === 'active' ? 'success' : 'danger'" size="xs">
            {{ selectedTrigger.status === 'active' ? t('triggersView.status.active') : t('triggersView.status.inactive') }}
          </AppBadge>
        </template>

        <template v-if="selectedTrigger" #default>
          <div class="p-4 space-y-5">
            <div v-if="detailLoading" class="text-2xs-plus dd-text-muted">{{ t('triggersView.detail.refreshing') }}</div>
            <div v-if="detailError"
                 class="px-3 py-2 text-2xs-plus dd-rounded"
                 :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
              {{ detailError }}
            </div>

            <DetailField v-for="(val, key) in selectedTrigger.config" :key="key" :label="String(key)" mono>{{ val }}</DetailField>
            <div v-if="Object.keys(selectedTrigger.config).length === 0">
              <div class="text-2xs-plus dd-text-muted">{{ t('triggersView.detail.noConfig') }}</div>
            </div>

            <!-- Test trigger button -->
            <div class="pt-2" :style="{ borderTop: '1px solid var(--dd-border)' }">
              <AppButton size="none" variant="plain" weight="none" class="inline-flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-2xs-plus font-bold tracking-wide transition-[color,background-color,border-color,opacity,transform,box-shadow] text-white"
                      :style="{ background: testResult?.id === selectedTrigger.id
                        ? (testResult.success ? 'var(--dd-success)' : 'var(--dd-danger)')
                        : 'linear-gradient(135deg, var(--dd-primary), var(--dd-info))',
                        boxShadow: 'var(--dd-shadow-sm)' }"
                      :disabled="testingTrigger !== null"
                      @click.stop="testTrigger(selectedTrigger)">
                <AppIcon :name="testingTrigger === selectedTrigger.id ? 'pending' : testResult?.id === selectedTrigger.id ? (testResult.success ? 'check' : 'xmark') : 'play'" :size="11"
                         v-tooltip.top="testingTrigger === selectedTrigger.id ? t('triggersView.test.testing') : testResult?.id === selectedTrigger.id ? (testResult.success ? t('triggersView.test.testPassed') : t('triggersView.test.testFailed')) : t('triggersView.test.runTest')" />
                {{ testingTrigger === selectedTrigger.id ? t('triggersView.test.testing') : testResult?.id === selectedTrigger.id ? (testResult.success ? t('triggersView.test.sent') : t('triggersView.test.failed')) : t('triggersView.test.testTrigger') }}
              </AppButton>
              <p v-if="testError?.id === selectedTrigger.id"
                 class="mt-2 text-2xs break-words"
                 style="color: var(--dd-danger);">
                {{ testError.message }}
              </p>
            </div>
          </div>
        </template>
      </DetailPanel>
    </template>
  </DataViewLayout>
</template>
