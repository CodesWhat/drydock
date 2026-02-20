<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getAllRegistries } from '../services/registry';

const registriesViewMode = ref<'table' | 'cards' | 'list'>('table');

const registriesData = ref<any[]>([]);
const loading = ref(true);
const error = ref('');

function registryTypeBadge(type: string) {
  if (type === 'hub') return { bg: 'var(--dd-info-muted)', text: 'var(--dd-info)', label: 'Hub' };
  if (type === 'ghcr') return { bg: 'var(--dd-alt-muted)', text: 'var(--dd-alt)', label: 'GHCR' };
  if (type === 'quay')
    return { bg: 'var(--dd-danger-muted)', text: 'var(--dd-danger)', label: 'Quay' };
  if (type === 'ecr')
    return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)', label: 'ECR' };
  if (type === 'gitlab')
    return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)', label: 'GitLab' };
  return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)', label: type };
}

const searchQuery = ref('');
const showFilters = ref(false);
const activeFilterCount = computed(() => (searchQuery.value ? 1 : 0));

const filteredRegistries = computed(() => {
  if (!searchQuery.value) return registriesData.value;
  const q = searchQuery.value.toLowerCase();
  return registriesData.value.filter((item) => item.name.toLowerCase().includes(q));
});

const tableColumns = [
  { key: 'name', label: 'Registry', sortable: false, width: '99%' },
  { key: 'type', label: 'Type', align: 'text-center', sortable: false },
  { key: 'status', label: 'Status', align: 'text-center', sortable: false },
  { key: 'url', label: 'URL', align: 'text-right', sortable: false },
];

onMounted(async () => {
  try {
    const data = await getAllRegistries();
    registriesData.value = data.map((r: any) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      status: 'connected',
      config: r.configuration ?? {},
    }));
  } catch {
    error.value = 'Failed to load registries';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <AppLayout>
      <!-- Filter bar -->
      <DataFilterBar
        v-model="registriesViewMode"
        v-model:showFilters="showFilters"
        :filtered-count="filteredRegistries.length"
        :total-count="registriesData.length"
        count-label="registries"
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
      <DataTable v-if="registriesViewMode === 'table'"
                 :columns="tableColumns"
                 :rows="filteredRegistries"
                 row-key="id">
        <template #cell-name="{ row }">
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full shrink-0"
                 :style="{ backgroundColor: row.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
            <span class="font-medium dd-text">{{ row.name }}</span>
          </div>
        </template>
        <template #cell-type="{ row }">
          <span class="badge text-[9px] uppercase font-bold"
                :style="{ backgroundColor: registryTypeBadge(row.type).bg, color: registryTypeBadge(row.type).text }">
            {{ registryTypeBadge(row.type).label }}
          </span>
        </template>
        <template #cell-status="{ row }">
          <span class="badge text-[9px] font-bold"
                :style="{
                  backgroundColor: row.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                  color: row.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                }">
            {{ row.status }}
          </span>
        </template>
        <template #cell-url="{ row }">
          <span class="whitespace-nowrap font-mono text-[10px] dd-text-secondary">
            {{ row.config.url || '\u2014' }}
          </span>
        </template>
        <template #empty>
          <EmptyState icon="registries"
                      message="No registries match your filters"
                      :show-clear="activeFilterCount > 0"
                      @clear="searchQuery = ''" />
        </template>
      </DataTable>

      <!-- Card view -->
      <DataCardGrid v-if="registriesViewMode === 'cards'"
                    :items="filteredRegistries"
                    item-key="id">
        <template #card="{ item: reg }">
          <div class="px-4 pt-4 pb-2 flex items-start justify-between">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                   :style="{ backgroundColor: reg.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
              <div class="min-w-0">
                <div class="text-[15px] font-semibold truncate dd-text">{{ reg.name }}</div>
                <div class="text-[11px] truncate mt-0.5 dd-text-muted font-mono">{{ reg.config.url || '\u2014' }}</div>
              </div>
            </div>
            <span class="badge text-[9px] uppercase font-bold shrink-0 ml-2"
                  :style="{ backgroundColor: registryTypeBadge(reg.type).bg, color: registryTypeBadge(reg.type).text }">
              {{ registryTypeBadge(reg.type).label }}
            </span>
          </div>
          <div class="px-4 py-3">
            <div class="grid grid-cols-2 gap-2 text-[11px]">
              <div v-for="(val, key) in reg.config" :key="key">
                <span class="dd-text-muted">{{ key }}</span>
                <div class="font-semibold truncate dd-text">{{ val }}</div>
              </div>
            </div>
          </div>
          <div class="px-4 py-2.5 flex items-center justify-between mt-auto"
               :style="{ borderTop: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-elevated)' }">
            <span class="badge text-[9px] font-bold"
                  :style="{
                    backgroundColor: reg.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                    color: reg.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                  }">
              {{ reg.status }}
            </span>
          </div>
        </template>
      </DataCardGrid>

      <!-- List view (accordion) -->
      <DataListAccordion v-if="registriesViewMode === 'list'"
                         :items="filteredRegistries"
                         item-key="id">
        <template #header="{ item: reg }">
          <div class="w-2.5 h-2.5 rounded-full shrink-0"
               :style="{ backgroundColor: reg.status === 'connected' ? 'var(--dd-success)' : reg.status === 'error' ? 'var(--dd-danger)' : 'var(--dd-neutral)' }" />
          <AppIcon name="registries" :size="14" class="dd-text-secondary" />
          <span class="text-sm font-semibold flex-1 min-w-0 truncate dd-text">{{ reg.name }}</span>
          <span class="badge text-[9px] uppercase font-bold shrink-0"
                :style="{ backgroundColor: registryTypeBadge(reg.type).bg, color: registryTypeBadge(reg.type).text }">
            {{ registryTypeBadge(reg.type).label }}
          </span>
        </template>
        <template #details="{ item: reg }">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mt-2">
            <div v-for="(val, key) in reg.config" :key="key">
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">{{ key }}</div>
              <div class="text-[12px] font-mono dd-text">{{ val }}</div>
            </div>
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Status</div>
              <span class="badge text-[10px] font-semibold"
                    :style="{
                      backgroundColor: reg.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                      color: reg.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                    }">{{ reg.status }}</span>
            </div>
          </div>
        </template>
      </DataListAccordion>
  </AppLayout>
</template>
