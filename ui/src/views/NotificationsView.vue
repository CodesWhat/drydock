<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getAllTriggers } from '../services/trigger';

const notificationsViewMode = ref<'table' | 'cards' | 'list'>('table');
const loading = ref(true);
const error = ref('');

// Real trigger data from API
const triggersData = ref<any[]>([]);

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
  if (type === 'docker' || type === 'dockercompose')
    return { bg: 'var(--dd-info-muted)', text: 'var(--dd-info)', label: type === 'dockercompose' ? 'Compose' : 'Docker' };
  return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)', label: type };
}

function configSummary(config: Record<string, any>): string {
  const keys = Object.keys(config);
  if (keys.length === 0) return 'No configuration';
  const entries = keys.slice(0, 3).map((k) => `${k}: ${config[k]}`);
  if (keys.length > 3) entries.push(`+${keys.length - 3} more`);
  return entries.join(', ');
}

const searchQuery = ref('');
const showFilters = ref(false);
const activeFilterCount = computed(() => (searchQuery.value ? 1 : 0));

const filteredTriggers = computed(() => {
  if (!searchQuery.value) return triggersData.value;
  const q = searchQuery.value.toLowerCase();
  return triggersData.value.filter((item) => item.name.toLowerCase().includes(q) || item.type.toLowerCase().includes(q));
});

const tableColumns = [
  { key: 'name', label: 'Trigger', sortable: false, width: '99%' },
  { key: 'type', label: 'Type', align: 'text-center', sortable: false },
  { key: 'config', label: 'Configuration', align: 'text-right', sortable: false },
];

function clearFilters() {
  searchQuery.value = '';
}

onMounted(async () => {
  try {
    const triggers = await getAllTriggers();
    triggersData.value = triggers.map((t: any) => ({
      id: t.id,
      name: t.name,
      type: t.type,
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
    <!-- Coming soon banner -->
    <div class="px-4 py-2.5 dd-rounded mb-4 flex items-center gap-2 text-[11px]"
         :style="{
           backgroundColor: 'var(--dd-info-muted)',
           border: '1px solid var(--dd-info)',
           color: 'var(--dd-info)',
         }">
      <AppIcon name="info" :size="12" />
      <span class="font-medium">Notification rules are coming in a future update.</span>
      <span class="dd-text-secondary">Currently showing configured triggers that fire on every update event.</span>
    </div>

    <!-- Filter bar -->
    <DataFilterBar
      v-model="notificationsViewMode"
      v-model:showFilters="showFilters"
      :filtered-count="filteredTriggers.length"
      :total-count="triggersData.length"
      :active-filter-count="activeFilterCount">
      <template #filters>
        <input v-model="searchQuery"
               type="text"
               placeholder="Filter by name or type..."
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
      v-if="notificationsViewMode === 'table' && filteredTriggers.length > 0"
      :columns="tableColumns"
      :rows="filteredTriggers"
      row-key="id">
      <template #cell-name="{ row }">
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full shrink-0" style="background-color: var(--dd-success);" />
          <span class="font-medium dd-text">{{ row.name }}</span>
        </div>
      </template>
      <template #cell-type="{ row }">
        <span class="badge text-[9px] uppercase font-bold"
              :style="{ backgroundColor: triggerTypeBadge(row.type).bg, color: triggerTypeBadge(row.type).text }">
          {{ triggerTypeBadge(row.type).label }}
        </span>
      </template>
      <template #cell-config="{ row }">
        <span class="text-[10px] font-mono dd-text-muted truncate max-w-[300px] inline-block">
          {{ configSummary(row.config) }}
        </span>
      </template>
      <template #empty>
        <EmptyState icon="triggers" message="No triggers configured" />
      </template>
    </DataTable>

    <!-- Card view -->
    <DataCardGrid
      v-if="notificationsViewMode === 'cards' && filteredTriggers.length > 0"
      :items="filteredTriggers"
      item-key="id">
      <template #card="{ item }">
        <div class="px-4 pt-4 pb-2 flex items-start justify-between">
          <div class="flex items-center gap-2.5 min-w-0">
            <div class="w-2.5 h-2.5 rounded-full shrink-0 mt-1" style="background-color: var(--dd-success);" />
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
        <div class="px-4 py-2.5 mt-auto"
             :style="{ borderTop: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-elevated)' }">
          <span class="text-[10px] dd-text-muted">Fires on all update events</span>
        </div>
      </template>
    </DataCardGrid>

    <!-- List view -->
    <DataListAccordion
      v-if="notificationsViewMode === 'list' && filteredTriggers.length > 0"
      :items="filteredTriggers"
      item-key="id">
      <template #header="{ item }">
        <div class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: var(--dd-success);" />
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
        </div>
        <div class="mt-3 text-[10px] dd-text-muted italic">Fires on all update events</div>
      </template>
    </DataListAccordion>

    <!-- Empty state -->
    <EmptyState
      v-if="filteredTriggers.length === 0 && !loading"
      icon="triggers"
      :message="searchQuery ? 'No triggers match your filters' : 'No triggers configured'"
      :show-clear="activeFilterCount > 0"
      @clear="clearFilters" />
  </DataViewLayout>
</template>
