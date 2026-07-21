<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import AppBadge from '@/components/AppBadge.vue';
import DetailField from '@/components/DetailField.vue';
import { useBreakpoints } from '../composables/useBreakpoints';
import { useViewMode } from '../preferences/useViewMode';
import { getAllRegistries, getRegistry } from '../services/registry';
import type { ApiComponent } from '../types/api';

const { t } = useI18n();

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

function registryStatusLabel(status: unknown): string {
  const s = String(status);
  if (s === 'connected') return t('registriesView.status.connected');
  if (s === 'error') return t('registriesView.status.error');
  return t('registriesView.status.unknown');
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
    const detail = await getRegistry({
      type: String(reg.type),
      name: String(reg.name),
      agent: reg.agent as string | undefined,
    });
    if (requestId !== detailRequestId || !detailOpen.value) return;
    selectedRegistry.value = mapRegistry(detail, String(reg.status));
  } catch {
    if (requestId !== detailRequestId) return;
    detailError.value = t('registriesView.detail.loadError');
  } finally {
    if (requestId === detailRequestId) {
      detailLoading.value = false;
    }
  }
}

const searchQuery = ref('');
const showFilters = ref(false);
const registryViewMode = useViewMode('registries');
// Set by DataTable's measured-width reflow (< 640px): hides the table/cards toggle when the
// width has already forced cards, so the switcher isn't a dead control at that size.
const cardReflowForced = ref(false);
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
  // Also match the dotted `type.name` instance ID — container detail deep-links
  // use `/registries?q=<type>.<name>` (e.g. "hub.public"), which matches neither
  // the bare name nor the bare type (#556 item 3).
  return registriesData.value.filter((item) => {
    const name = item.name.toLowerCase();
    const type = item.type.toLowerCase();
    return name.includes(q) || type.includes(q) || `${type}.${name}`.includes(q);
  });
});

const tableColumns = computed(() => [
  {
    key: 'name',
    label: t('registriesView.columns.registry'),
    align: 'text-left',
    sortable: false,
    size: 180,
    minSize: 140,
    maxSize: 280,
  },
  {
    key: 'type',
    label: t('registriesView.columns.type'),
    sortable: false,
    size: 120,
    minSize: 96,
    maxSize: 150,
  },
  {
    key: 'status',
    label: t('registriesView.columns.status'),
    sortable: false,
    size: 120,
    minSize: 96,
    maxSize: 150,
  },
  {
    key: 'url',
    label: t('registriesView.columns.url'),
    align: 'text-left',
    sortable: false,
    size: 360,
    minSize: 220,
    maxSize: 720,
    flex: 1,
  },
]);

onMounted(async () => {
  try {
    const data = await getAllRegistries();
    registriesData.value = data.map((registry: ApiComponent) => mapRegistry(registry));
  } catch {
    error.value = t('registriesView.loadError');
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

      <div v-if="loading" class="text-2xs-plus dd-text-muted py-3 px-1">{{ t('registriesView.loadingRegistries') }}</div>

      <!-- Filter bar -->
      <DataFilterBar
        v-model="registryViewMode"
        v-model:showFilters="showFilters"
        :filtered-count="filteredRegistries.length"
        :total-count="registriesData.length"
        :active-filter-count="activeFilterCount"
        :hide-view-toggle="cardReflowForced">
        <template #filters>
          <input v-model="searchQuery"
                 type="text"
                 :placeholder="t('registriesView.filterPlaceholder')"
                 class="flex-1 min-w-[120px] max-w-[var(--dd-layout-filter-max-width)] px-2.5 py-1.5 dd-rounded text-2xs-plus font-medium outline-none dd-bg dd-text dd-placeholder" />
          <AppButton size="none" variant="text-muted" weight="medium" class="text-2xs" v-if="searchQuery"
                  
                  @click="searchQuery = ''">
            {{ t('registriesView.clear') }}
          </AppButton>
        </template>
      </DataFilterBar>

      <!-- Table view -->
      <DataTable v-if="!loading"
                 :columns="tableColumns"
                 storage-key="registries"
                 :rows="filteredRegistries"
                 row-key="id"
                 :active-row="selectedRegistry?.id"
                 :prefer-cards="registryViewMode === 'cards'"
                 @update:card-reflow-forced="cardReflowForced = $event"
                 @row-click="openDetail($event)">
        <template #cell-name="{ row }">
          <span class="font-medium dd-text">{{ registryTypeBadge(row.type).label }}</span>
        </template>
        <template #cell-type="{ row }">
          <AppBadge v-if="isPrivate(row)" tone="warning" size="xs" class="max-md:!hidden">{{ t('registriesView.badge.private') }}</AppBadge>
          <AppBadge v-else tone="neutral" size="xs" class="max-md:!hidden">{{ t('registriesView.badge.public') }}</AppBadge>
          <AppBadge v-if="isPrivate(row)" v-tooltip.top="t('registriesView.badge.private')" tone="warning" size="xs" class="px-1.5 py-0 md:!hidden"><AppIcon name="lock" :size="12" /></AppBadge>
          <AppBadge v-else v-tooltip.top="t('registriesView.badge.public')" tone="neutral" size="xs" class="px-1.5 py-0 md:!hidden"><AppIcon name="eye" :size="12" /></AppBadge>
        </template>
        <template #cell-status="{ row }">
          <AppIcon :name="row.status === 'connected' ? 'check' : row.status === 'error' ? 'xmark' : 'warning'" :size="13" class="shrink-0 md:!hidden"
                   v-tooltip.top="registryStatusLabel(row.status)"
                   :style="{ color: row.status === 'connected' ? 'var(--dd-success)' : row.status === 'error' ? 'var(--dd-danger)' : 'var(--dd-warning)' }" />
          <AppBadge :tone="row.status === 'connected' ? 'success' : row.status === 'error' ? 'danger' : 'warning'" size="xs" class="max-md:!hidden">
            {{ registryStatusLabel(row.status) }}
          </AppBadge>
        </template>
        <template #cell-url="{ row }">
          <span class="block max-w-[220px] truncate whitespace-nowrap font-mono text-2xs dd-text-secondary"
                :title="resolveUrl(row)"
                v-tooltip.top="resolveUrl(row)">
            {{ resolveUrl(row) }}
          </span>
        </template>
        <template #card="{ row }">
          <div class="relative flex flex-col flex-1">
            <!-- Header: name + resolved URL + type badge -->
            <div class="px-4 pt-4 pb-2 flex items-start justify-between gap-2">
              <div class="min-w-0">
                <div class="text-sm-plus font-semibold truncate dd-text">{{ row.name }}</div>
                <div class="text-2xs truncate mt-0.5 dd-text-muted font-mono"
                     :title="resolveUrl(row)"
                     v-tooltip.top="resolveUrl(row)">
                  {{ resolveUrl(row) }}
                </div>
              </div>
              <AppBadge :custom="{ bg: registryTypeBadge(row.type).bg, text: registryTypeBadge(row.type).text }" size="xs" class="shrink-0">
                {{ registryTypeBadge(row.type).label }}
              </AppBadge>
            </div>
            <!-- Body: auth / status -->
            <div class="px-4 py-3">
              <div class="grid grid-cols-2 gap-2 text-2xs-plus">
                <div>
                  <span class="dd-text-muted">{{ t('registriesView.card.auth') }}</span>
                  <span class="ml-1 font-semibold" :style="{ color: isPrivate(row) ? 'var(--dd-warning)' : 'var(--dd-text-muted)' }">
                    {{ isPrivate(row) ? t('registriesView.badge.private') : t('registriesView.badge.public') }}
                  </span>
                </div>
                <div>
                  <span class="dd-text-muted">{{ t('registriesView.card.status') }}</span>
                  <span class="ml-1 font-semibold" :style="{ color: row.status === 'connected' ? 'var(--dd-success)' : 'var(--dd-danger)' }">
                    {{ registryStatusLabel(row.status) }}
                  </span>
                </div>
              </div>
            </div>
            <!-- Footer: URL repeated -->
            <div class="px-4 py-2.5 mt-auto"
                 :style="{ backgroundColor: 'var(--dd-bg-elevated)' }">
              <span class="block truncate text-2xs dd-text-muted font-mono"
                    :title="resolveUrl(row)"
                    v-tooltip.top="resolveUrl(row)">
                {{ resolveUrl(row) }}
              </span>
            </div>
          </div>
        </template>
        <template #empty>
          <EmptyState icon="registries"
                      :message="t('registriesView.emptyFiltered')"
                      :show-clear="activeFilterCount > 0"
                      @clear="searchQuery = ''" />
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
            <AppBadge v-if="selectedRegistry" :custom="{ bg: registryTypeBadge(selectedRegistry.type).bg, text: registryTypeBadge(selectedRegistry.type).text }" size="xs" class="shrink-0">
              {{ registryTypeBadge(selectedRegistry.type).label }}
            </AppBadge>
            <span class="text-sm font-bold truncate dd-text">{{ selectedRegistry?.name }}</span>
          </div>
        </template>

        <template #subtitle>
          <span class="block max-w-[220px] truncate text-2xs-plus font-mono dd-text-secondary"
                :title="selectedRegistry ? resolveUrl(selectedRegistry) : ''"
                v-tooltip.top="selectedRegistry ? resolveUrl(selectedRegistry) : ''">
            {{ selectedRegistry ? resolveUrl(selectedRegistry) : '' }}
          </span>
        </template>

        <template v-if="selectedRegistry" #default>
          <div class="p-4 space-y-5">
            <div v-if="detailLoading" class="text-2xs-plus dd-text-muted">{{ t('registriesView.detail.refreshing') }}</div>
            <div v-if="detailError"
                 class="px-3 py-2 text-2xs-plus dd-rounded"
                 :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
              {{ detailError }}
            </div>

            <!-- Status -->
            <DetailField :label="t('registriesView.detail.status')">
              <AppBadge :tone="selectedRegistry.status === 'connected' ? 'success' : 'danger'" size="sm">
                {{ registryStatusLabel(selectedRegistry.status) }}
              </AppBadge>
            </DetailField>

            <!-- Auth type -->
            <DetailField :label="t('registriesView.detail.authentication')">
              <div class="flex items-center gap-1.5 text-xs">
                <AppIcon v-if="isPrivate(selectedRegistry)" name="lock" :size="12" style="color: var(--dd-warning);" />
                <AppIcon v-else name="eye" :size="12" class="dd-text-muted" />
                <span class="dd-text font-medium">{{ isPrivate(selectedRegistry) ? t('registriesView.badge.private') : t('registriesView.badge.public') }}</span>
              </div>
            </DetailField>

            <!-- URL -->
            <DetailField :label="t('registriesView.detail.url')" mono>{{ resolveUrl(selectedRegistry) }}</DetailField>

            <!-- Configuration -->
            <DetailField v-for="(val, key) in selectedRegistry.config" :key="key" :label="String(key)" mono>{{ val }}</DetailField>
          </div>
        </template>
      </DetailPanel>
    </template>
  </DataViewLayout>
</template>
