<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute } from 'vue-router';
import AppBadge from '../components/AppBadge.vue';
import DetailField from '../components/DetailField.vue';
import { useBreakpoints } from '../composables/useBreakpoints';
import { useViewMode } from '../preferences/useViewMode';
import { getAllAuthentications, getAuthentication } from '../services/authentication';
import type { ApiComponent } from '../types/api';

const { t } = useI18n();

const authViewMode = useViewMode('auth');

const authData = ref<Record<string, unknown>[]>([]);
const loading = ref(true);
const error = ref('');
const route = useRoute();

const { isMobile } = useBreakpoints();
const selectedAuth = ref<Record<string, unknown> | null>(null);
const detailOpen = ref(false);
const detailLoading = ref(false);
const detailError = ref('');
let detailRequestId = 0;

function authTypeBadge(type: string) {
  if (type === 'basic')
    return {
      bg: 'var(--dd-neutral-muted)',
      text: 'var(--dd-neutral)',
      label: t('authView.badge.basic'),
    };
  if (type === 'oidc')
    return {
      bg: 'var(--dd-primary-muted)',
      text: 'var(--dd-primary)',
      label: t('authView.badge.oidc'),
    };
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

const filteredAuth = computed(() => {
  if (!searchQuery.value) return authData.value;
  const q = searchQuery.value.toLowerCase();
  return authData.value.filter((item) => item.name.toLowerCase().includes(q));
});

const tableColumns = computed(() => [
  { key: 'name', label: t('authView.columns.provider'), width: '99%' },
  { key: 'type', label: t('authView.columns.type') },
  { key: 'status', label: t('authView.columns.status') },
]);

function mapAuthentication(authentication: ApiComponent, status = 'active') {
  return {
    id: authentication.id,
    name: authentication.name,
    type: authentication.type,
    status,
    config: authentication.configuration ?? {},
    agent: authentication.agent,
  };
}

function resetDetailState() {
  detailOpen.value = false;
  detailLoading.value = false;
  detailError.value = '';
  selectedAuth.value = null;
  detailRequestId += 1;
}

function handleDetailOpenChange(value: boolean) {
  if (!value) {
    resetDetailState();
  } else {
    detailOpen.value = true;
  }
}

async function openDetail(authentication: Record<string, unknown>) {
  selectedAuth.value = authentication;
  detailOpen.value = true;
  detailLoading.value = true;
  detailError.value = '';
  const requestId = ++detailRequestId;

  try {
    const detail = await getAuthentication({
      type: String(authentication.type),
      name: String(authentication.name),
      agent: authentication.agent as string | undefined,
    });
    if (requestId !== detailRequestId || !detailOpen.value) return;
    selectedAuth.value = mapAuthentication(detail, String(authentication.status));
  } catch {
    if (requestId !== detailRequestId) return;
    detailError.value = t('authView.detailLoadError');
  } finally {
    if (requestId === detailRequestId) {
      detailLoading.value = false;
    }
  }
}

onMounted(async () => {
  try {
    const data = await getAllAuthentications();
    authData.value = data.map((authentication: ApiComponent) => mapAuthentication(authentication));
  } catch {
    error.value = t('authView.loadError');
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

      <div v-if="loading" class="text-2xs-plus dd-text-muted py-3 px-1">
        {{ t('authView.loadingProviders') }}
      </div>

      <!-- Filter bar -->
      <DataFilterBar
        v-model="authViewMode"
        v-model:showFilters="showFilters"
        :filtered-count="filteredAuth.length"
        :total-count="authData.length"
        :active-filter-count="activeFilterCount">
        <template #filters>
          <input v-model="searchQuery"
                 type="text"
                 :placeholder="t('authView.filterPlaceholder')"
                 class="flex-1 min-w-[120px] max-w-[var(--dd-layout-filter-max-width)] px-2.5 py-1.5 dd-rounded text-2xs-plus font-medium outline-none dd-bg dd-text dd-placeholder" />
          <AppButton size="none" variant="text-muted" weight="medium" class="text-2xs" v-if="searchQuery"
                  
                  @click="searchQuery = ''">
            {{ t('authView.clearFilter') }}
          </AppButton>
        </template>
      </DataFilterBar>

      <!-- Table view -->
      <DataTable
        v-if="authViewMode === 'table' && !loading"
        :columns="tableColumns"
        :rows="filteredAuth"
        row-key="id"
        :active-row="selectedAuth?.id"
        @row-click="openDetail($event)">
        <template #cell-name="{ row }">
          <span class="font-medium dd-text">{{ row.name }}</span>
        </template>
        <template #cell-type="{ row }">
          <AppBadge :custom="{ bg: authTypeBadge(row.type).bg, text: authTypeBadge(row.type).text }" size="xs">
            {{ authTypeBadge(row.type).label }}
          </AppBadge>
        </template>
        <template #cell-status="{ row }">
          <AppIcon :name="row.status === 'active' ? 'check' : 'xmark'" :size="13" class="shrink-0 md:!hidden"
                   :style="{ color: row.status === 'active' ? 'var(--dd-success)' : 'var(--dd-neutral)' }" />
          <AppBadge :tone="row.status === 'active' ? 'success' : 'neutral'" size="xs" class="max-md:!hidden">
            {{ row.status }}
          </AppBadge>
        </template>
        <template #empty>
          <EmptyState icon="filter" :message="t('authView.emptyFiltered')" :show-clear="activeFilterCount > 0" @clear="searchQuery = ''" />
        </template>
      </DataTable>

      <!-- Card view -->
      <DataCardGrid
        v-if="authViewMode === 'cards' && !loading"
        :items="filteredAuth"
        item-key="id"
        :selected-key="selectedAuth?.id"
        @item-click="openDetail($event)">
        <template #card="{ item: auth }">
          <div class="px-4 pt-4 pb-2 flex items-start justify-between">
            <div class="min-w-0">
              <div class="text-sm-plus font-semibold truncate dd-text">{{ auth.name }}</div>
            </div>
            <AppBadge :custom="{ bg: authTypeBadge(auth.type).bg, text: authTypeBadge(auth.type).text }" size="xs" class="shrink-0 ml-2">
              {{ authTypeBadge(auth.type).label }}
            </AppBadge>
          </div>
          <div class="px-4 py-3">
            <div class="grid grid-cols-1 gap-2 text-2xs-plus">
              <div v-for="(val, key) in auth.config" :key="key">
                <span class="dd-text-muted">{{ key }}</span>
                <div class="font-semibold truncate dd-text font-mono text-2xs">{{ val }}</div>
              </div>
            </div>
          </div>
          <div class="px-4 py-2.5 mt-auto"
               :style="{ borderTop: '1px solid var(--dd-border)', backgroundColor: 'var(--dd-bg-elevated)' }">
            <AppIcon :name="auth.status === 'active' ? 'check' : 'xmark'" :size="13" class="shrink-0 md:!hidden"
                     :style="{ color: auth.status === 'active' ? 'var(--dd-success)' : 'var(--dd-neutral)' }" />
            <AppBadge :tone="auth.status === 'active' ? 'success' : 'neutral'" size="xs" class="max-md:!hidden">
              {{ auth.status }}
            </AppBadge>
          </div>
        </template>
      </DataCardGrid>

      <!-- List view (accordion) -->
      <DataListAccordion
        v-if="authViewMode === 'list' && !loading"
        :items="filteredAuth"
        item-key="id"
        :selected-key="selectedAuth?.id"
        @item-click="openDetail($event)">
        <template #header="{ item: auth }">
          <AppIcon name="auth" :size="14" class="dd-text-secondary" />
          <span class="text-sm font-semibold flex-1 min-w-0 truncate dd-text">{{ auth.name }}</span>
          <AppBadge :custom="{ bg: authTypeBadge(auth.type).bg, text: authTypeBadge(auth.type).text }" size="xs" class="shrink-0">
            {{ authTypeBadge(auth.type).label }}
          </AppBadge>
        </template>
        <template #details="{ item: auth }">
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 mt-2">
            <DetailField v-for="(val, key) in auth.config" :key="key" :label="String(key)" mono compact>{{ val }}</DetailField>
            <DetailField :label="t('authView.fields.status')" compact>
              <AppBadge :tone="auth.status === 'active' ? 'success' : 'neutral'" size="sm" :uppercase="false">{{ auth.status }}</AppBadge>
            </DetailField>
          </div>
        </template>
      </DataListAccordion>

      <!-- Empty state (cards/list) -->
      <EmptyState
        v-if="(authViewMode === 'cards' || authViewMode === 'list') && filteredAuth.length === 0 && !loading"
        icon="filter"
        :message="t('authView.emptyFiltered')"
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
            <span class="text-sm font-bold truncate dd-text">{{ selectedAuth?.name }}</span>
            <AppBadge v-if="selectedAuth" :custom="{ bg: authTypeBadge(selectedAuth.type).bg, text: authTypeBadge(selectedAuth.type).text }" size="xs" class="shrink-0">
              {{ authTypeBadge(selectedAuth.type).label }}
            </AppBadge>
          </div>
        </template>

        <template #subtitle>
          <AppBadge v-if="selectedAuth" :tone="selectedAuth.status === 'active' ? 'success' : 'neutral'" size="xs">
            {{ selectedAuth.status }}
          </AppBadge>
        </template>

        <template v-if="selectedAuth" #default>
          <div class="p-4 space-y-5">
            <div v-if="detailLoading" class="text-2xs-plus dd-text-muted">
              {{ t('authView.detailRefreshing') }}
            </div>
            <div v-if="detailError"
                 class="px-3 py-2 text-2xs-plus dd-rounded"
                 :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
              {{ detailError }}
            </div>

            <DetailField v-for="(val, key) in selectedAuth.config" :key="key" :label="String(key)" mono>
              <span class="break-all">{{ val }}</span>
            </DetailField>
            <div v-if="Object.keys(selectedAuth.config).length === 0">
              <div class="text-2xs-plus dd-text-muted">{{ t('authView.noConfig') }}</div>
            </div>
          </div>
        </template>
      </DetailPanel>
    </template>
  </DataViewLayout>
</template>
