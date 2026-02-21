<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getAllTriggers } from '../services/trigger';

const notificationsViewMode = ref<'table' | 'cards' | 'list'>('table');
const loading = ref(true);
const error = ref('');

// Trigger name lookup map populated from API
const triggerMap = ref<Record<string, string>>({});

// Notification rules remain as local state (no backend endpoint yet)
const notificationsData = ref([
  {
    id: 'update-available',
    name: 'Update Available',
    enabled: true,
    triggers: [] as string[],
    description: 'When a container has a new version',
  },
  {
    id: 'update-applied',
    name: 'Update Applied',
    enabled: true,
    triggers: [] as string[],
    description: 'After a container is successfully updated',
  },
  {
    id: 'update-failed',
    name: 'Update Failed',
    enabled: true,
    triggers: [] as string[],
    description: 'When an update fails or is rolled back',
  },
  {
    id: 'security-alert',
    name: 'Security Alert',
    enabled: true,
    triggers: [] as string[],
    description: 'Critical/High vulnerability detected',
  },
  {
    id: 'agent-disconnect',
    name: 'Agent Disconnected',
    enabled: false,
    triggers: [] as string[],
    description: 'When a remote agent loses connection',
  },
]);

function triggerNameById(id: string) {
  return triggerMap.value[id] ?? id;
}

const searchQuery = ref('');
const showFilters = ref(false);
const activeFilterCount = computed(() => (searchQuery.value ? 1 : 0));

const filteredNotifications = computed(() => {
  if (!searchQuery.value) return notificationsData.value;
  const q = searchQuery.value.toLowerCase();
  return notificationsData.value.filter((item) => item.name.toLowerCase().includes(q));
});

const tableColumns = [
  { key: 'enabled', label: 'On', align: 'text-center', sortable: false, width: '48px' },
  { key: 'name', label: 'Rule', sortable: false, width: '99%' },
  { key: 'triggers', label: 'Triggers', align: 'text-right', sortable: false },
];

function toggleNotification(id: string) {
  const notif = notificationsData.value.find((n) => n.id === id);
  if (notif) notif.enabled = !notif.enabled;
}

onMounted(async () => {
  try {
    const triggers = await getAllTriggers();
    const map: Record<string, string> = {};
    for (const t of triggers) {
      map[t.id] = t.name;
    }
    triggerMap.value = map;

    // Assign all fetched trigger IDs to the first three notification rules
    // so there's something meaningful to display; adjust as needed once
    // a notifications backend endpoint exists.
    const allIds = triggers.map((t: any) => t.id);
    if (notificationsData.value.length > 0) {
      notificationsData.value[0].triggers = allIds;
    }
    if (notificationsData.value.length > 1) {
      notificationsData.value[1].triggers = allIds.slice(0, 1);
    }
    if (notificationsData.value.length > 2) {
      notificationsData.value[2].triggers = allIds;
    }
    if (notificationsData.value.length > 3) {
      notificationsData.value[3].triggers = allIds.filter((_: any, i: number) => i % 2 === 0);
    }
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
        v-model="notificationsViewMode"
        v-model:showFilters="showFilters"
        :filtered-count="filteredNotifications.length"
        :total-count="notificationsData.length"
        :active-filter-count="activeFilterCount">
        <template #filters>
          <input v-model="searchQuery"
                 type="text"
                 placeholder="Filter by name..."
                 class="flex-1 min-w-[120px] max-w-[240px] px-2.5 py-1.5 dd-rounded text-[11px] font-medium border outline-none dd-bg dd-text dd-border-strong dd-placeholder" />
          <button v-if="searchQuery"
                  class="text-[10px] dd-text-muted hover:dd-text transition-colors"
                  @click="searchQuery = ''">
            Clear
          </button>
        </template>
      </DataFilterBar>

      <!-- Table view -->
      <DataTable
        v-if="notificationsViewMode === 'table'"
        :columns="tableColumns"
        :rows="filteredNotifications"
        row-key="id">
        <template #cell-enabled="{ row }">
          <div class="w-8 h-4 rounded-full relative cursor-pointer shrink-0 transition-colors mx-auto"
               :style="{ backgroundColor: row.enabled ? 'var(--dd-success)' : 'var(--dd-border-strong)' }"
               @click="toggleNotification(row.id)">
            <div class="absolute top-0.5 w-3 h-3 rounded-full shadow-sm transition-transform"
                 :style="{ backgroundColor: 'var(--dd-text)', left: row.enabled ? '17px' : '2px' }" />
          </div>
        </template>
        <template #cell-name="{ row }">
          <div class="font-medium dd-text">{{ row.name }}</div>
          <div class="text-[10px] mt-0.5 dd-text-muted">{{ row.description }}</div>
        </template>
        <template #cell-triggers="{ row }">
          <div class="flex flex-wrap gap-1 justify-end">
            <span v-for="tId in row.triggers" :key="tId"
                  class="badge text-[9px] font-semibold"
                  :style="{ backgroundColor: 'var(--dd-neutral-muted)', color: 'var(--dd-text-secondary)' }">
              {{ triggerNameById(tId) }}
            </span>
            <span v-if="row.triggers.length === 0" class="text-[10px] italic dd-text-muted">None</span>
          </div>
        </template>
        <template #empty>
          <EmptyState icon="filter" message="No rules match your filters" :show-clear="activeFilterCount > 0" @clear="searchQuery = ''" />
        </template>
      </DataTable>

      <!-- Card view -->
      <DataCardGrid
        v-if="notificationsViewMode === 'cards'"
        :items="filteredNotifications"
        item-key="id">
        <template #card="{ item: notif }">
          <div class="px-4 pt-4 pb-2 flex items-start justify-between">
            <div class="min-w-0 flex-1">
              <div class="text-[15px] font-semibold truncate dd-text">{{ notif.name }}</div>
              <div class="text-[11px] mt-0.5 dd-text-muted">{{ notif.description }}</div>
            </div>
            <div class="w-8 h-4 rounded-full relative cursor-pointer shrink-0 ml-3 transition-colors"
                 :style="{ backgroundColor: notif.enabled ? 'var(--dd-success)' : 'var(--dd-border-strong)' }"
                 @click="toggleNotification(notif.id)">
              <div class="absolute top-0.5 w-3 h-3 rounded-full shadow-sm transition-transform"
                   :style="{ backgroundColor: 'var(--dd-text)', left: notif.enabled ? '17px' : '2px' }" />
            </div>
          </div>
          <div class="px-4 py-2.5 flex flex-wrap gap-1.5 mt-auto"
               :style="{ borderTop: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-elevated)' }">
            <span v-for="tId in notif.triggers" :key="tId"
                  class="badge text-[9px] font-semibold"
                  :style="{ backgroundColor: 'var(--dd-neutral-muted)', color: 'var(--dd-text-secondary)' }">
              {{ triggerNameById(tId) }}
            </span>
            <span v-if="notif.triggers.length === 0" class="text-[10px] italic dd-text-muted">No triggers</span>
          </div>
        </template>
      </DataCardGrid>

      <!-- List view -->
      <DataListAccordion
        v-if="notificationsViewMode === 'list'"
        :items="filteredNotifications"
        item-key="id">
        <template #header="{ item: notif }">
          <div class="w-8 h-4 rounded-full relative cursor-pointer shrink-0 transition-colors"
               :style="{ backgroundColor: notif.enabled ? 'var(--dd-success)' : 'var(--dd-border-strong)' }"
               @click.stop="toggleNotification(notif.id)">
            <div class="absolute top-0.5 w-3 h-3 rounded-full shadow-sm transition-transform"
                 :style="{ backgroundColor: 'var(--dd-text)', left: notif.enabled ? '17px' : '2px' }" />
          </div>
          <span class="text-sm font-semibold flex-1 min-w-0 truncate dd-text">{{ notif.name }}</span>
          <div class="flex flex-wrap gap-1.5 shrink-0 max-w-[260px] justify-end">
            <span v-for="tId in notif.triggers" :key="tId"
                  class="badge text-[9px] font-semibold"
                  :style="{ backgroundColor: 'var(--dd-neutral-muted)', color: 'var(--dd-text-secondary)' }">
              {{ triggerNameById(tId) }}
            </span>
            <span v-if="notif.triggers.length === 0" class="text-[10px] italic dd-text-muted">No triggers</span>
          </div>
        </template>
        <template #details="{ item: notif }">
          <div class="text-[11px] dd-text-muted">{{ notif.description }}</div>
        </template>
      </DataListAccordion>

      <!-- Empty state (cards/list) -->
      <EmptyState
        v-if="(notificationsViewMode === 'cards' || notificationsViewMode === 'list') && filteredNotifications.length === 0"
        icon="filter"
        message="No rules match your filters"
        :show-clear="activeFilterCount > 0"
        @clear="searchQuery = ''" />
  </DataViewLayout>
</template>
