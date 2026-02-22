<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getAllTriggers, runTrigger } from '../services/trigger';

const triggersViewMode = ref<'table' | 'cards' | 'list'>('table');

const triggersData = ref<any[]>([]);
const loading = ref(true);
const error = ref('');
const testingTrigger = ref<string | null>(null);
const testResult = ref<{ id: string; success: boolean } | null>(null);

async function testTrigger(trigger: any) {
  if (testingTrigger.value) return;
  testingTrigger.value = trigger.id;
  testResult.value = null;
  try {
    await runTrigger({
      triggerType: trigger.type,
      triggerName: trigger.name,
      container: {
        id: 'test',
        name: 'Test Container',
        image: { name: 'test/image', tag: { value: 'latest' } },
        result: { tag: 'latest' },
        updateKind: { kind: 'unknown', semverDiff: 'unknown' },
      },
    });
    testResult.value = { id: trigger.id, success: true };
  } catch (e: any) {
    testResult.value = { id: trigger.id, success: false };
  } finally {
    testingTrigger.value = null;
    setTimeout(() => {
      testResult.value = null;
    }, 3000);
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

onMounted(async () => {
  try {
    const data = await getAllTriggers();
    triggersData.value = data.map((t: any) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      status: 'active',
      config: t.configuration ?? {},
    }));
  } catch {
    error.value = 'Failed to load triggers';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <DataViewLayout>
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
      v-if="triggersViewMode === 'table' && filteredTriggers.length > 0"
      :columns="tableColumns"
      :rows="filteredTriggers"
      row-key="id"
    >
      <template #cell-name="{ row }">
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full shrink-0"
               :style="{ backgroundColor: row.status === 'active' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
          <span class="font-medium dd-text">{{ row.name }}</span>
        </div>
      </template>
      <template #cell-type="{ row }">
        <span class="badge text-[9px] uppercase font-bold"
              :style="{ backgroundColor: triggerTypeBadge(row.type).bg, color: triggerTypeBadge(row.type).text }">
          {{ triggerTypeBadge(row.type).label }}
        </span>
      </template>
      <template #cell-status="{ row }">
        <span class="badge text-[9px] font-bold"
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
      v-if="triggersViewMode === 'cards' && filteredTriggers.length > 0"
      :items="filteredTriggers"
      item-key="id"
    >
      <template #card="{ item }">
        <div class="px-4 pt-4 pb-2 flex items-start justify-between">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                 :style="{ backgroundColor: item.status === 'active' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
            <div class="min-w-0">
              <div class="text-[15px] font-semibold truncate dd-text">{{ item.name }}</div>
            </div>
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
        <div class="px-4 py-2.5 flex items-center justify-between mt-auto"
             :style="{ borderTop: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-elevated)' }">
          <span class="badge text-[9px] font-bold"
                :style="{
                  backgroundColor: item.status === 'active' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                  color: item.status === 'active' ? 'var(--dd-success)' : 'var(--dd-danger)',
                }">
            {{ item.status }}
          </span>
          <button class="inline-flex items-center gap-1 px-2 py-1 dd-rounded text-[10px] font-bold transition-all text-white"
                  :style="{ background: testResult?.id === item.id
                    ? (testResult.success ? 'var(--dd-success)' : 'var(--dd-danger)')
                    : 'linear-gradient(135deg, var(--dd-primary), var(--dd-info))' }"
                  :disabled="testingTrigger !== null"
                  @click.stop="testTrigger(item)">
            <AppIcon :name="testingTrigger === item.id ? 'pending' : testResult?.id === item.id ? (testResult.success ? 'check' : 'xmark') : 'play'" :size="11" />
            {{ testingTrigger === item.id ? 'Testing...' : testResult?.id === item.id ? (testResult.success ? 'Sent!' : 'Failed') : 'Test' }}
          </button>
        </div>
      </template>
    </DataCardGrid>

    <!-- List view (accordion) -->
    <DataListAccordion
      v-if="triggersViewMode === 'list' && filteredTriggers.length > 0"
      :items="filteredTriggers"
      item-key="id"
    >
      <template #header="{ item }">
        <div class="w-2.5 h-2.5 rounded-full shrink-0"
             :style="{ backgroundColor: item.status === 'active' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
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
          <button class="inline-flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-bold tracking-wide transition-all text-white"
                  :style="{ background: testResult?.id === item.id
                    ? (testResult.success ? 'var(--dd-success)' : 'var(--dd-danger)')
                    : 'linear-gradient(135deg, var(--dd-primary), var(--dd-info))',
                    boxShadow: '0 1px 3px rgba(0,150,199,0.3)' }"
                  :disabled="testingTrigger !== null"
                  @click.stop="testTrigger(item)">
            <AppIcon :name="testingTrigger === item.id ? 'pending' : testResult?.id === item.id ? (testResult.success ? 'check' : 'xmark') : 'play'" :size="10" />
            {{ testingTrigger === item.id ? 'Testing...' : testResult?.id === item.id ? (testResult.success ? 'Sent!' : 'Failed') : 'Test' }}
          </button>
        </div>
      </template>
    </DataListAccordion>

    <!-- Empty state -->
    <EmptyState
      v-if="filteredTriggers.length === 0"
      icon="triggers"
      message="No triggers match your filters"
      :show-clear="activeFilterCount > 0"
      @clear="clearFilters"
    />
  </DataViewLayout>
</template>
