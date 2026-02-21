<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { getAllAuthentications } from '../services/authentication';

const authViewMode = ref<'table' | 'cards' | 'list'>('table');

const authData = ref<any[]>([]);
const loading = ref(true);
const error = ref('');

function authTypeBadge(type: string) {
  if (type === 'basic')
    return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)', label: 'Basic' };
  if (type === 'oidc')
    return { bg: 'var(--dd-primary-muted)', text: 'var(--dd-primary)', label: 'OIDC' };
  return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)', label: type };
}

const searchQuery = ref('');
const showFilters = ref(false);
const activeFilterCount = computed(() => (searchQuery.value ? 1 : 0));

const filteredAuth = computed(() => {
  if (!searchQuery.value) return authData.value;
  const q = searchQuery.value.toLowerCase();
  return authData.value.filter((item) => item.name.toLowerCase().includes(q));
});

const tableColumns = [
  { key: 'name', label: 'Provider', width: '99%' },
  { key: 'type', label: 'Type', align: 'text-center' },
  { key: 'status', label: 'Status', align: 'text-center' },
];

onMounted(async () => {
  try {
    const data = await getAllAuthentications();
    authData.value = data.map((a: any) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      status: 'active',
      config: a.configuration ?? {},
    }));
  } catch {
    error.value = 'Failed to load authentication providers';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
      <!-- Filter bar -->
      <DataFilterBar
        v-model="authViewMode"
        v-model:showFilters="showFilters"
        :filtered-count="filteredAuth.length"
        :total-count="authData.length"
        count-label="providers"
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
        v-if="authViewMode === 'table'"
        :columns="tableColumns"
        :rows="filteredAuth"
        row-key="id">
        <template #cell-name="{ row }">
          <div class="flex items-center gap-2">
            <div class="w-2 h-2 rounded-full shrink-0"
                 :style="{ backgroundColor: row.status === 'active' ? 'var(--dd-success)' : 'var(--dd-neutral)' }" />
            <span class="font-medium dd-text">{{ row.name }}</span>
          </div>
        </template>
        <template #cell-type="{ row }">
          <span class="badge text-[9px] uppercase font-bold"
                :style="{ backgroundColor: authTypeBadge(row.type).bg, color: authTypeBadge(row.type).text }">
            {{ authTypeBadge(row.type).label }}
          </span>
        </template>
        <template #cell-status="{ row }">
          <span class="badge text-[9px] font-bold"
                :style="{
                  backgroundColor: row.status === 'active' ? 'var(--dd-success-muted)' : 'var(--dd-neutral-muted)',
                  color: row.status === 'active' ? 'var(--dd-success)' : 'var(--dd-neutral)',
                }">
            {{ row.status }}
          </span>
        </template>
        <template #empty>
          <EmptyState icon="filter" message="No providers match your filters" :show-clear="activeFilterCount > 0" @clear="searchQuery = ''" />
        </template>
      </DataTable>

      <!-- Card view -->
      <DataCardGrid
        v-if="authViewMode === 'cards'"
        :items="filteredAuth"
        item-key="id">
        <template #card="{ item: auth }">
          <div class="px-4 pt-4 pb-2 flex items-start justify-between">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-2.5 h-2.5 rounded-full shrink-0 mt-1"
                   :style="{ backgroundColor: auth.status === 'active' ? 'var(--dd-success)' : 'var(--dd-neutral)' }" />
              <div class="min-w-0">
                <div class="text-[15px] font-semibold truncate dd-text">{{ auth.name }}</div>
              </div>
            </div>
            <span class="badge text-[9px] uppercase font-bold shrink-0 ml-2"
                  :style="{ backgroundColor: authTypeBadge(auth.type).bg, color: authTypeBadge(auth.type).text }">
              {{ authTypeBadge(auth.type).label }}
            </span>
          </div>
          <div class="px-4 py-3">
            <div class="grid grid-cols-1 gap-2 text-[11px]">
              <div v-for="(val, key) in auth.config" :key="key">
                <span class="dd-text-muted">{{ key }}</span>
                <div class="font-semibold truncate dd-text font-mono text-[10px]">{{ val }}</div>
              </div>
            </div>
          </div>
          <div class="px-4 py-2.5 mt-auto"
               :style="{ borderTop: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-elevated)' }">
            <span class="badge text-[9px] font-bold"
                  :style="{
                    backgroundColor: auth.status === 'active' ? 'var(--dd-success-muted)' : 'var(--dd-neutral-muted)',
                    color: auth.status === 'active' ? 'var(--dd-success)' : 'var(--dd-neutral)',
                  }">
              {{ auth.status }}
            </span>
          </div>
        </template>
      </DataCardGrid>

      <!-- List view (accordion) -->
      <DataListAccordion
        v-if="authViewMode === 'list'"
        :items="filteredAuth"
        item-key="id">
        <template #header="{ item: auth }">
          <div class="w-2.5 h-2.5 rounded-full shrink-0"
               :style="{ backgroundColor: auth.status === 'active' ? 'var(--dd-success)' : 'var(--dd-neutral)' }" />
          <AppIcon name="auth" :size="14" class="dd-text-secondary" />
          <span class="text-sm font-semibold flex-1 min-w-0 truncate dd-text">{{ auth.name }}</span>
          <span class="badge text-[9px] uppercase font-bold shrink-0"
                :style="{ backgroundColor: authTypeBadge(auth.type).bg, color: authTypeBadge(auth.type).text }">
            {{ authTypeBadge(auth.type).label }}
          </span>
        </template>
        <template #details="{ item: auth }">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mt-2">
            <div v-for="(val, key) in auth.config" :key="key">
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">{{ key }}</div>
              <div class="text-[12px] font-mono dd-text">{{ val }}</div>
            </div>
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Status</div>
              <span class="badge text-[10px] font-semibold"
                    :style="{
                      backgroundColor: auth.status === 'active' ? 'var(--dd-success-muted)' : 'var(--dd-neutral-muted)',
                      color: auth.status === 'active' ? 'var(--dd-success)' : 'var(--dd-neutral)',
                    }">{{ auth.status }}</span>
            </div>
          </div>
        </template>
      </DataListAccordion>

      <!-- Empty state (cards/list) -->
      <EmptyState
        v-if="(authViewMode === 'cards' || authViewMode === 'list') && filteredAuth.length === 0"
        icon="filter"
        message="No providers match your filters"
        :show-clear="activeFilterCount > 0"
        @clear="searchQuery = ''" />
</template>
