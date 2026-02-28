<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useBreakpoints } from '../composables/useBreakpoints';
import { getAllTriggers, getTrigger, runTrigger } from '../services/trigger';
import type { ApiComponent } from '../types/api';
import { errorMessage } from '../utils/error';

const triggersViewMode = ref<'table' | 'cards' | 'list'>('table');
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
  const defaultMessage = 'Trigger test failed';
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
      container: {
        id: 'test',
        name: 'Test Container',
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

const tableColumns = [
  { key: 'name', label: 'Trigger', sortable: false, width: '99%' },
  { key: 'type', label: 'Type', align: 'text-center', sortable: false },
  { key: 'status', label: 'Status', align: 'text-center', sortable: false },
];

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
    detailError.value = 'Unable to load latest trigger details';
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
    error.value = 'Failed to load triggers';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <DataViewLayout>
    <div v-if="error"
         class="mb-3 px-3 py-2 text-[11px] dd-rounded"
         :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
      {{ error }}
    </div>

    <div v-if="loading" class="text-[11px] dd-text-muted py-3 px-1">Loading triggers...</div>

    <!-- Filter bar -->
    <DataFilterBar
      v-model="triggersViewMode"
      v-model:showFilters="showFilters"
      :filtered-count="filteredTriggers.length"
      :total-count="triggersData.length"
      :active-filter-count="activeFilterCount"
    >
      <template #filters>
        <input v-model="searchQuery"
               type="text"
               placeholder="Filter by name..."
               class="flex-1 min-w-[120px] max-w-[240px] px-2.5 py-1.5 dd-rounded text-[11px] font-medium border outline-none dd-bg dd-text dd-border-strong dd-placeholder" />
        <button v-if="searchQuery"
                class="text-[10px] dd-text-muted hover:dd-text transition-colors"
                @click="clearFilters">
          Clear
        </button>
      </template>
    </DataFilterBar>

    <!-- Table view -->
    <DataTable
      v-if="triggersViewMode === 'table' && !loading"
      :columns="tableColumns"
      :rows="filteredTriggers"
      row-key="id"
      :active-row="selectedTrigger?.id"
      @row-click="openDetail($event)"
    >
      <template #cell-name="{ row }">
        <span class="font-medium dd-text">{{ row.name }}</span>
      </template>
      <template #cell-type="{ row }">
        <span class="badge text-[9px] uppercase font-bold"
              :style="{ backgroundColor: triggerTypeBadge(row.type).bg, color: triggerTypeBadge(row.type).text }">
          {{ triggerTypeBadge(row.type).label }}
        </span>
      </template>
      <template #cell-status="{ row }">
        <AppIcon :name="row.status === 'active' ? 'check' : 'xmark'" :size="13" class="shrink-0 md:!hidden"
                 :style="{ color: row.status === 'active' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
        <span class="badge text-[9px] font-bold max-md:!hidden"
              :style="{
                backgroundColor: row.status === 'active' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                color: row.status === 'active' ? 'var(--dd-success)' : 'var(--dd-danger)',
              }">
          {{ row.status }}
        </span>
      </template>
      <template #empty>
        <EmptyState icon="triggers" message="No triggers match your filters" show-clear @clear="clearFilters" />
      </template>
    </DataTable>

    <!-- Card view -->
    <DataCardGrid
      v-if="triggersViewMode === 'cards' && filteredTriggers.length > 0 && !loading"
      :items="filteredTriggers"
      item-key="id"
      :selected-key="selectedTrigger?.id"
      @item-click="openDetail($event)"
    >
      <template #card="{ item }">
        <div class="px-4 pt-4 pb-2 flex items-start justify-between">
          <div class="min-w-0">
            <div class="text-[15px] font-semibold truncate dd-text">{{ item.name }}</div>
          </div>
          <span class="badge text-[9px] uppercase font-bold shrink-0 ml-2"
                :style="{ backgroundColor: triggerTypeBadge(item.type).bg, color: triggerTypeBadge(item.type).text }">
            {{ triggerTypeBadge(item.type).label }}
          </span>
        </div>
        <div class="px-4 py-3">
          <div class="grid grid-cols-1 gap-2 text-[11px]">
            <div v-for="(val, key) in item.config" :key="key">
              <span class="dd-text-muted">{{ key }}</span>
              <div class="font-semibold truncate dd-text font-mono text-[10px]">{{ val }}</div>
            </div>
          </div>
        </div>
        <div class="px-4 py-2.5 mt-auto"
             :style="{ borderTop: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-elevated)' }">
          <div class="flex items-center justify-between">
            <AppIcon :name="item.status === 'active' ? 'check' : 'xmark'" :size="13" class="shrink-0 md:!hidden"
                     :style="{ color: item.status === 'active' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
            <span class="badge text-[9px] font-bold max-md:!hidden"
                  :style="{
                    backgroundColor: item.status === 'active' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                    color: item.status === 'active' ? 'var(--dd-success)' : 'var(--dd-danger)',
                  }">
              {{ item.status }}
            </span>
            <button class="inline-flex items-center gap-1 px-2 py-1 dd-rounded text-[10px] font-bold transition-[color,background-color,border-color,opacity,transform,box-shadow] text-white"
                    :style="{ background: testResult?.id === item.id
                      ? (testResult.success ? 'var(--dd-success)' : 'var(--dd-danger)')
                      : 'linear-gradient(135deg, var(--dd-primary), var(--dd-info))' }"
                    :disabled="testingTrigger !== null"
                    @click.stop="testTrigger(item)">
              <AppIcon :name="testingTrigger === item.id ? 'pending' : testResult?.id === item.id ? (testResult.success ? 'check' : 'xmark') : 'play'" :size="11" />
              {{ testingTrigger === item.id ? 'Testing...' : testResult?.id === item.id ? (testResult.success ? 'Sent!' : 'Failed') : 'Test' }}
            </button>
          </div>
          <p v-if="testError?.id === item.id" class="mt-2 text-[10px] break-words" style="color: var(--dd-danger);">
            {{ testError.message }}
          </p>
        </div>
      </template>
    </DataCardGrid>

    <!-- List view (accordion) -->
    <DataListAccordion
      v-if="triggersViewMode === 'list' && filteredTriggers.length > 0 && !loading"
      :items="filteredTriggers"
      item-key="id"
      :selected-key="selectedTrigger?.id"
      @item-click="openDetail($event)"
    >
      <template #header="{ item }">
        <AppIcon name="triggers" :size="14" class="dd-text-secondary" />
        <span class="text-sm font-semibold flex-1 min-w-0 truncate dd-text">{{ item.name }}</span>
        <span class="badge text-[9px] uppercase font-bold shrink-0"
              :style="{ backgroundColor: triggerTypeBadge(item.type).bg, color: triggerTypeBadge(item.type).text }">
          {{ triggerTypeBadge(item.type).label }}
        </span>
      </template>
      <template #details="{ item }">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mt-2">
          <div v-for="(val, key) in item.config" :key="key">
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">{{ key }}</div>
            <div class="text-[12px] font-mono dd-text">{{ val }}</div>
          </div>
          <div>
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Status</div>
            <span class="badge text-[10px] font-semibold"
                  :style="{
                    backgroundColor: item.status === 'active' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                    color: item.status === 'active' ? 'var(--dd-success)' : 'var(--dd-danger)',
                  }">{{ item.status }}</span>
          </div>
        </div>
        <div class="mt-4 pt-3" :style="{ borderTop: '1px solid var(--dd-border-strong)' }">
          <button class="inline-flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-bold tracking-wide transition-[color,background-color,border-color,opacity,transform,box-shadow] text-white"
                  :style="{ background: testResult?.id === item.id
                    ? (testResult.success ? 'var(--dd-success)' : 'var(--dd-danger)')
                    : 'linear-gradient(135deg, var(--dd-primary), var(--dd-info))',
                    boxShadow: '0 1px 3px rgba(0,150,199,0.3)' }"
                  :disabled="testingTrigger !== null"
                  @click.stop="testTrigger(item)">
            <AppIcon :name="testingTrigger === item.id ? 'pending' : testResult?.id === item.id ? (testResult.success ? 'check' : 'xmark') : 'play'" :size="10" />
            {{ testingTrigger === item.id ? 'Testing...' : testResult?.id === item.id ? (testResult.success ? 'Sent!' : 'Failed') : 'Test' }}
          </button>
          <p v-if="testError?.id === item.id" class="mt-2 text-[10px] break-words" style="color: var(--dd-danger);">
            {{ testError.message }}
          </p>
        </div>
      </template>
    </DataListAccordion>

    <!-- Empty state -->
    <EmptyState
      v-if="filteredTriggers.length === 0 && !loading"
      icon="triggers"
      message="No triggers match your filters"
      :show-clear="activeFilterCount > 0"
      @clear="clearFilters"
    />

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
            <span v-if="selectedTrigger" class="badge text-[9px] uppercase font-bold shrink-0"
                  :style="{ backgroundColor: triggerTypeBadge(selectedTrigger.type).bg, color: triggerTypeBadge(selectedTrigger.type).text }">
              {{ triggerTypeBadge(selectedTrigger.type).label }}
            </span>
          </div>
        </template>

        <template #subtitle>
          <span v-if="selectedTrigger" class="badge text-[9px] font-bold"
                :style="{
                  backgroundColor: selectedTrigger.status === 'active' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                  color: selectedTrigger.status === 'active' ? 'var(--dd-success)' : 'var(--dd-danger)',
                }">
            {{ selectedTrigger.status }}
          </span>
        </template>

        <template v-if="selectedTrigger" #default>
          <div class="p-4 space-y-5">
            <div v-if="detailLoading" class="text-[11px] dd-text-muted">Refreshing trigger details...</div>
            <div v-if="detailError"
                 class="px-3 py-2 text-[11px] dd-rounded"
                 :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
              {{ detailError }}
            </div>

            <div v-for="(val, key) in selectedTrigger.config" :key="key">
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">{{ key }}</div>
              <div class="text-[12px] font-mono dd-text break-all">{{ val }}</div>
            </div>
            <div v-if="Object.keys(selectedTrigger.config).length === 0">
              <div class="text-[11px] dd-text-muted">No configuration properties</div>
            </div>

            <!-- Test trigger button -->
            <div class="pt-2" :style="{ borderTop: '1px solid var(--dd-border)' }">
              <button class="inline-flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-bold tracking-wide transition-[color,background-color,border-color,opacity,transform,box-shadow] text-white"
                      :style="{ background: testResult?.id === selectedTrigger.id
                        ? (testResult.success ? 'var(--dd-success)' : 'var(--dd-danger)')
                        : 'linear-gradient(135deg, var(--dd-primary), var(--dd-info))',
                        boxShadow: '0 1px 3px rgba(0,150,199,0.3)' }"
                      :disabled="testingTrigger !== null"
                      @click.stop="testTrigger(selectedTrigger)">
                <AppIcon :name="testingTrigger === selectedTrigger.id ? 'pending' : testResult?.id === selectedTrigger.id ? (testResult.success ? 'check' : 'xmark') : 'play'" :size="11" />
                {{ testingTrigger === selectedTrigger.id ? 'Testing...' : testResult?.id === selectedTrigger.id ? (testResult.success ? 'Sent!' : 'Failed') : 'Test Trigger' }}
              </button>
              <p v-if="testError?.id === selectedTrigger.id"
                 class="mt-2 text-[10px] break-words"
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
