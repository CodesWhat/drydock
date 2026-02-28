<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useBreakpoints } from '../composables/useBreakpoints';
import { getAllRegistries, getRegistry } from '../services/registry';
import type { ApiComponent } from '../types/api';

const registriesViewMode = ref<'table' | 'cards' | 'list'>('table');

const registriesData = ref<Record<string, unknown>[]>([]);
const loading = ref(true);
const error = ref('');
const route = useRoute();

const { isMobile } = useBreakpoints();
const selectedRegistry = ref<Record<string, unknown> | null>(null);
const detailOpen = ref(false);
const detailLoading = ref(false);
const detailError = ref('');
let detailRequestId = 0;

/** Well-known default URLs for registry providers without explicit config. */
const DEFAULT_URLS: Record<string, string> = {
  hub: 'https://registry-1.docker.io',
  ghcr: 'https://ghcr.io',
  lscr: 'https://lscr.io',
  quay: 'https://quay.io',
  ecr: 'https://public.ecr.aws',
  gar: 'https://gcr.io',
  gcr: 'https://gcr.io',
  acr: 'https://azurecr.io',
  alicr: 'https://cr.aliyuncs.com',
  codeberg: 'https://codeberg.org',
  dhi: 'https://dhi.io',
  docr: 'https://registry.digitalocean.com',
  ibmcr: 'https://icr.io',
  ocir: 'https://ocir.io',
};

function resolveUrl(reg: Record<string, unknown>): string {
  const config = reg.config as Record<string, unknown> | undefined;
  return String(config?.url || DEFAULT_URLS[String(reg.type)] || '');
}

function registryTypeBadge(type: string) {
  if (type === 'hub') return { bg: 'var(--dd-info-muted)', text: 'var(--dd-info)', label: 'Hub' };
  if (type === 'ghcr') return { bg: 'var(--dd-alt-muted)', text: 'var(--dd-alt)', label: 'GHCR' };
  if (type === 'quay')
    return { bg: 'var(--dd-danger-muted)', text: 'var(--dd-danger)', label: 'Quay' };
  if (type === 'ecr')
    return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)', label: 'ECR' };
  if (type === 'gitlab')
    return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)', label: 'GitLab' };
  return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)', label: type.toUpperCase() };
}

function isPrivate(reg: Record<string, unknown>): boolean {
  const cfg = (reg.config ?? {}) as Record<string, unknown>;
  return !!(cfg.token || cfg.password || cfg.login || cfg.username);
}

function mapRegistry(registry: ApiComponent, status = 'connected') {
  return {
    id: registry.id,
    name: registry.name,
    type: registry.type,
    status,
    config: registry.configuration ?? {},
    agent: registry.agent,
  };
}

function resetDetailState() {
  detailOpen.value = false;
  detailLoading.value = false;
  detailError.value = '';
  selectedRegistry.value = null;
  detailRequestId += 1;
}

function handleDetailOpenChange(value: boolean) {
  if (!value) {
    resetDetailState();
  } else {
    detailOpen.value = true;
  }
}

async function openDetail(reg: Record<string, unknown>) {
  selectedRegistry.value = reg;
  detailOpen.value = true;
  detailLoading.value = true;
  detailError.value = '';
  const requestId = ++detailRequestId;

  try {
    const detail = await getRegistry({ type: String(reg.type), name: String(reg.name), agent: reg.agent as string | undefined });
    if (requestId !== detailRequestId || !detailOpen.value) return;
    selectedRegistry.value = mapRegistry(detail, String(reg.status));
  } catch {
    if (requestId !== detailRequestId) return;
    detailError.value = 'Unable to load latest registry details';
  } finally {
    if (requestId === detailRequestId) {
      detailLoading.value = false;
    }
  }
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

const filteredRegistries = computed(() => {
  if (!searchQuery.value) return registriesData.value;
  const q = searchQuery.value.toLowerCase();
  return registriesData.value.filter(
    (item) =>
      item.name.toLowerCase().includes(q) || item.type.toLowerCase().includes(q),
  );
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
    registriesData.value = data.map((registry: ApiComponent) => mapRegistry(registry));
  } catch {
    error.value = 'Failed to load registries';
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

      <div v-if="loading" class="text-[11px] dd-text-muted py-3 px-1">Loading registries...</div>

      <!-- Filter bar -->
      <DataFilterBar
        v-model="registriesViewMode"
        v-model:showFilters="showFilters"
        :filtered-count="filteredRegistries.length"
        :total-count="registriesData.length"
        :active-filter-count="activeFilterCount">
        <template #filters>
          <input v-model="searchQuery"
                 type="text"
                 placeholder="Filter by name or type..."
                 class="flex-1 min-w-[120px] max-w-[240px] px-2.5 py-1.5 dd-rounded text-[11px] font-medium border outline-none dd-bg dd-text dd-border-strong dd-placeholder" />
          <button v-if="searchQuery"
                  class="text-[10px] dd-text-muted hover:dd-text transition-colors"
                  @click="searchQuery = ''">
            Clear
          </button>
        </template>
      </DataFilterBar>

      <!-- Table view -->
      <DataTable v-if="registriesViewMode === 'table' && !loading"
                 :columns="tableColumns"
                 :rows="filteredRegistries"
                 row-key="id"
                 :active-row="selectedRegistry?.id"
                 @row-click="openDetail($event)">
        <template #cell-name="{ row }">
          <span class="font-medium dd-text">{{ registryTypeBadge(row.type).label }}</span>
        </template>
        <template #cell-type="{ row }">
          <span v-if="isPrivate(row)" class="badge text-[9px] font-bold max-md:!hidden"
                :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
            Private
          </span>
          <span v-else class="badge text-[9px] font-bold max-md:!hidden"
                :style="{ backgroundColor: 'var(--dd-neutral-muted)', color: 'var(--dd-neutral)' }">
            Public
          </span>
          <span v-if="isPrivate(row)" class="badge px-1.5 py-0 text-[9px] md:!hidden" style="background: var(--dd-warning-muted); color: var(--dd-warning);"><AppIcon name="lock" :size="12" /></span>
          <span v-else class="badge px-1.5 py-0 text-[9px] md:!hidden" style="background: var(--dd-neutral-muted); color: var(--dd-neutral);"><AppIcon name="eye" :size="12" /></span>
        </template>
        <template #cell-status="{ row }">
          <AppIcon :name="row.status === 'connected' ? 'check' : row.status === 'error' ? 'xmark' : 'warning'" :size="13" class="shrink-0 md:!hidden"
                   :style="{ color: row.status === 'connected' ? 'var(--dd-success)' : row.status === 'error' ? 'var(--dd-danger)' : 'var(--dd-warning)' }" />
          <span class="badge text-[9px] font-bold max-md:!hidden"
                :style="{
                  backgroundColor: row.status === 'connected' ? 'var(--dd-success-muted)' : row.status === 'error' ? 'var(--dd-danger-muted)' : 'var(--dd-warning-muted)',
                  color: row.status === 'connected' ? 'var(--dd-success)' : row.status === 'error' ? 'var(--dd-danger)' : 'var(--dd-warning)',
                }">
            {{ row.status }}
          </span>
        </template>
        <template #cell-url="{ row }">
          <span class="whitespace-nowrap font-mono text-[10px] dd-text-secondary">
            {{ resolveUrl(row) }}
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
      <DataCardGrid v-if="registriesViewMode === 'cards' && !loading"
                    :items="filteredRegistries"
                    item-key="id"
                    :selected-key="selectedRegistry?.id"
                    @item-click="openDetail($event)">
        <template #card="{ item: reg }">
          <div class="px-4 pt-4 pb-2 flex items-start justify-between">
            <div class="min-w-0">
              <div class="text-[14px] font-semibold truncate dd-text">{{ reg.name }}</div>
              <div class="text-[10px] truncate mt-0.5 dd-text-muted font-mono">{{ resolveUrl(reg) }}</div>
            </div>
            <span class="badge text-[9px] uppercase font-bold shrink-0 ml-2"
                  :style="{ backgroundColor: registryTypeBadge(reg.type).bg, color: registryTypeBadge(reg.type).text }">
              {{ registryTypeBadge(reg.type).label }}
            </span>
          </div>
          <div class="px-4 py-3">
            <div class="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span class="dd-text-muted">Auth</span>
                <span class="ml-1 font-semibold" :style="{ color: isPrivate(reg) ? 'var(--dd-warning)' : 'var(--dd-text-muted)' }">
                  {{ isPrivate(reg) ? 'Private' : 'Public' }}
                </span>
              </div>
              <div>
                <span class="dd-text-muted">Status</span>
                <span class="ml-1 font-semibold" :style="{ color: reg.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }">
                  {{ reg.status }}
                </span>
              </div>
            </div>
          </div>
          <div class="px-4 py-2.5 mt-auto"
               :style="{ borderTop: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-elevated)' }">
            <span class="text-[10px] dd-text-muted font-mono truncate">{{ resolveUrl(reg) }}</span>
          </div>
        </template>
      </DataCardGrid>

      <!-- List view -->
      <DataListAccordion v-if="registriesViewMode === 'list' && !loading"
                         :items="filteredRegistries"
                         item-key="id"
                         :selected-key="selectedRegistry?.id"
                         @item-click="openDetail($event)">
        <template #header="{ item: reg }">
          <span class="badge text-[9px] uppercase font-bold shrink-0"
                :style="{ backgroundColor: registryTypeBadge(reg.type).bg, color: registryTypeBadge(reg.type).text }">
            {{ registryTypeBadge(reg.type).label }}
          </span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold truncate dd-text">{{ reg.name }}</div>
            <div class="text-[10px] font-mono dd-text-muted truncate mt-0.5">{{ resolveUrl(reg) }}</div>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <span class="text-[11px] hidden md:inline font-medium" :style="{ color: isPrivate(reg) ? 'var(--dd-warning)' : 'var(--dd-text-muted)' }">
              {{ isPrivate(reg) ? 'Private' : 'Public' }}
            </span>
            <span v-if="isPrivate(reg)" class="badge px-1.5 py-0 text-[9px] md:!hidden" style="background: var(--dd-warning-muted); color: var(--dd-warning);"><AppIcon name="lock" :size="12" /></span>
            <span v-else class="badge px-1.5 py-0 text-[9px] md:!hidden" style="background: var(--dd-neutral-muted); color: var(--dd-neutral);"><AppIcon name="eye" :size="12" /></span>
            <AppIcon :name="reg.status === 'connected' ? 'check' : 'xmark'" :size="13" class="shrink-0 md:!hidden"
                     :style="{ color: reg.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
            <span class="badge text-[9px] font-bold max-md:!hidden"
                  :style="{
                    backgroundColor: reg.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                    color: reg.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                  }">
              {{ reg.status }}
            </span>
          </div>
        </template>
      </DataListAccordion>

      <EmptyState
        v-if="(registriesViewMode === 'cards' || registriesViewMode === 'list') && filteredRegistries.length === 0 && !loading"
        icon="registries"
        message="No registries match your filters"
        :show-clear="activeFilterCount > 0"
        @clear="searchQuery = ''" />

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
            <span class="badge text-[9px] uppercase font-bold shrink-0"
                  :style="{ backgroundColor: selectedRegistry ? registryTypeBadge(selectedRegistry.type).bg : undefined, color: selectedRegistry ? registryTypeBadge(selectedRegistry.type).text : undefined }">
              {{ selectedRegistry ? registryTypeBadge(selectedRegistry.type).label : '' }}
            </span>
            <span class="text-sm font-bold truncate dd-text">{{ selectedRegistry?.name }}</span>
          </div>
        </template>

        <template #subtitle>
          <span class="text-[11px] font-mono dd-text-secondary">{{ selectedRegistry ? resolveUrl(selectedRegistry) : '' }}</span>
        </template>

        <template v-if="selectedRegistry" #default>
          <div class="p-4 space-y-5">
            <div v-if="detailLoading" class="text-[11px] dd-text-muted">Refreshing registry details...</div>
            <div v-if="detailError"
                 class="px-3 py-2 text-[11px] dd-rounded"
                 :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
              {{ detailError }}
            </div>

            <!-- Status -->
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">Status</div>
              <span class="badge text-[10px] font-semibold"
                    :style="{
                      backgroundColor: selectedRegistry.status === 'connected' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                      color: selectedRegistry.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)',
                    }">
                {{ selectedRegistry.status }}
              </span>
            </div>

            <!-- Auth type -->
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">Authentication</div>
              <div class="flex items-center gap-1.5 text-[12px]">
                <AppIcon v-if="isPrivate(selectedRegistry)" name="lock" :size="12" style="color: var(--dd-warning);" />
                <AppIcon v-else name="eye" :size="12" class="dd-text-muted" />
                <span class="dd-text font-medium">{{ isPrivate(selectedRegistry) ? 'Private' : 'Public' }}</span>
              </div>
            </div>

            <!-- URL -->
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">URL</div>
              <div class="text-[12px] font-mono dd-text break-all">{{ resolveUrl(selectedRegistry) }}</div>
            </div>

            <!-- Configuration -->
            <div v-for="(val, key) in selectedRegistry.config" :key="key">
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-1 dd-text-muted">{{ key }}</div>
              <div class="text-[12px] font-mono dd-text break-all">{{ val }}</div>
            </div>
          </div>
        </template>
      </DetailPanel>
    </template>
  </DataViewLayout>
</template>
