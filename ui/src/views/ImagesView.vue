<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import AppBadge from '../components/AppBadge.vue';
import DataTableColumnPicker from '../components/DataTableColumnPicker.vue';
import { useConfirmDialog } from '../composables/useConfirmDialog';
import { useServerFeatures } from '../composables/useServerFeatures';
import { useToast } from '../composables/useToast';
import { type PickerColumn, useViewColumnVisibility } from '../composables/useViewColumnVisibility';
import { useViewMode } from '../preferences/useViewMode';
import {
  getImages,
  getPrunePreview,
  pruneImages,
  type ImageHostSummary,
  type ImageInventoryItem,
  type PruneMode,
} from '../services/images';
import { formatAbsoluteTime, timeAgo } from '../utils/audit-helpers';
import { ApiError, errorMessage } from '../utils/error';
import {
  formatBytes,
  hostDisplayName,
  hostMatches,
  imageSortValue,
  type ImageSortKey,
  repositoryLabel,
  shortImageId,
  tagLabel,
} from './images/imagesViewHelpers';

const { t, locale } = useI18n();
const { containerActionsEnabled } = useServerFeatures();
const confirm = useConfirmDialog();
const toast = useToast();

const images = ref<ImageInventoryItem[]>([]);
const hosts = ref<ImageHostSummary[]>([]);
const loading = ref(true);
const error = ref('');

const selectedHostId = ref('');
const unusedOnly = ref(false);
const showFilters = ref(false);
const imagesViewMode = useViewMode('images');
const cardReflowForced = ref(false);
const pruning = ref(false);
const pruningHostText = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const response = await getImages();
    images.value = response.images;
    hosts.value = response.hosts;
  } catch (e: unknown) {
    error.value = errorMessage(e, 'Failed to load images');
  } finally {
    loading.value = false;
  }
}

onMounted(load);

const hostsWithErrors = computed(() => hosts.value.filter((host) => !!host.error));

const selectedHostSummary = computed<ImageHostSummary | null>(
  () => hosts.value.find((host) => host.id === selectedHostId.value) ?? null,
);

const selectedHostUnsupported = computed(
  () => !!selectedHostSummary.value && !selectedHostSummary.value.supported,
);

const canPrune = computed(
  () => containerActionsEnabled.value && !!selectedHostSummary.value?.supported,
);

const activeFilterCount = computed(
  () => (selectedHostId.value ? 1 : 0) + (unusedOnly.value ? 1 : 0),
);

const filteredItems = computed(() => {
  let list = images.value;
  const host = selectedHostSummary.value;
  if (host) {
    list = list.filter((item) => hostMatches(item, host));
  }
  if (unusedOnly.value) {
    list = list.filter((item) => item.containers === 0);
  }
  return list;
});

const sortKey = ref('size');
const sortAsc = ref(false);

const sortedItems = computed(() => {
  const untaggedLabel = t('imagesView.untagged');
  const key = sortKey.value as ImageSortKey;
  const list = [...filteredItems.value].sort((a, b) => {
    const av = imageSortValue(a, key, untaggedLabel);
    const bv = imageSortValue(b, key, untaggedLabel);
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  });
  return sortAsc.value ? list : list.reverse();
});

function mapImageRow(item: ImageInventoryItem) {
  return {
    id: item.id,
    repository: repositoryLabel(item, t('imagesView.untagged')),
    tagText: tagLabel(item),
    dangling: item.dangling,
    shortId: shortImageId(item.id),
    sizeBytes: item.size,
    sizeLabel: formatBytes(item.size),
    containers: item.containers,
    createdAt: item.created,
    createdLabel: item.created ? timeAgo(item.created, locale.value, t) : '',
    lastSeenAt: item.lastSeen,
    lastSeenLabel: item.lastSeen ? timeAgo(item.lastSeen, locale.value, t) : '',
    watcher: item.watcher,
    agent: item.agent,
    hostText: hostDisplayName(item.watcher, item.agent),
  };
}

const tableRows = computed(() => sortedItems.value.map(mapImageRow));

const tableColumns = computed(() => [
  {
    key: 'repository',
    label: t('imagesView.columns.repository'),
    size: 260,
    minSize: 160,
    maxSize: 420,
    flex: 1,
    sortable: true,
    required: true,
  },
  {
    key: 'tag',
    label: t('imagesView.columns.tag'),
    size: 140,
    minSize: 100,
    maxSize: 200,
    sortable: true,
  },
  {
    key: 'imageId',
    label: t('imagesView.columns.imageId'),
    size: 130,
    minSize: 110,
    maxSize: 160,
    sortable: true,
  },
  {
    key: 'size',
    label: t('imagesView.columns.size'),
    size: 100,
    minSize: 80,
    maxSize: 140,
    align: 'text-right',
    sortable: true,
  },
  {
    key: 'containers',
    label: t('imagesView.columns.containers'),
    size: 110,
    minSize: 90,
    maxSize: 140,
    align: 'text-right',
    sortable: true,
  },
  {
    key: 'created',
    label: t('imagesView.columns.created'),
    size: 140,
    minSize: 110,
    maxSize: 180,
    sortable: true,
  },
  {
    key: 'lastSeen',
    label: t('imagesView.columns.lastSeen'),
    size: 140,
    minSize: 110,
    maxSize: 180,
    sortable: true,
  },
  {
    key: 'host',
    label: t('imagesView.columns.host'),
    size: 160,
    minSize: 120,
    maxSize: 240,
    sortable: true,
  },
]);

const pickerColumns = computed<PickerColumn[]>(() =>
  tableColumns.value.map((column) => ({
    key: column.key,
    label: column.label,
    required: 'required' in column ? column.required : undefined,
  })),
);

const { hiddenColumnKeys, toggleColumn, resetColumns } = useViewColumnVisibility(
  'images',
  pickerColumns,
);

async function refresh() {
  await load();
}

async function performPrune(host: ImageHostSummary, mode: PruneMode, hostText: string) {
  pruning.value = true;
  pruningHostText.value = hostText;
  try {
    const result = await pruneImages({ host: host.id, mode });
    toast.success(
      t('imagesView.prune.success', {
        count: result.imagesDeleted,
        size: formatBytes(result.spaceReclaimed),
        host: hostText,
      }),
    );
    await load();
  } catch (e: unknown) {
    if (e instanceof ApiError && e.status === 504) {
      toast.warning(t('imagesView.prune.stillRunning', { host: hostText }));
      await load();
    } else {
      toast.error(t('imagesView.prune.failed', { host: hostText, message: errorMessage(e, '') }));
    }
  } finally {
    pruning.value = false;
    pruningHostText.value = '';
  }
}

// Only ever invoked from the prune buttons, which render exclusively when
// `canPrune` is true — i.e. `selectedHostSummary` is guaranteed non-null.
async function handlePrune(mode: PruneMode) {
  const host = selectedHostSummary.value as ImageHostSummary;
  const hostText = hostDisplayName(host.name, host.agent);

  let estimate: { images: number; reclaimable: number };
  try {
    estimate = await getPrunePreview({ host: host.id, mode });
  } catch (e: unknown) {
    toast.error(t('imagesView.prune.failed', { host: hostText, message: errorMessage(e, '') }));
    return;
  }

  confirm.require({
    severity: 'danger',
    header: t(`imagesView.prune.confirm.header.${mode}`, { host: hostText }),
    message:
      estimate.images === 0
        ? t('imagesView.prune.confirm.nothing')
        : t('imagesView.prune.confirm.message', {
            count: estimate.images,
            size: formatBytes(estimate.reclaimable),
          }),
    rejectLabel: t('common.cancel'),
    acceptLabel: t('imagesView.prune.confirm.accept'),
    accept: estimate.images === 0 ? () => {} : () => performPrune(host, mode, hostText),
  });
}
</script>

<template>
  <DataViewLayout>
    <div v-if="error"
         class="mb-3 px-3 py-2 text-2xs-plus dd-rounded"
         :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
      {{ error }}
    </div>

    <div v-for="host in hostsWithErrors" :key="host.id"
         class="mb-2 px-1 text-2xs-plus dd-text-muted">
      {{ t('imagesView.hostError', { host: host.name, message: host.error }) }}
    </div>

    <div v-if="selectedHostUnsupported" class="mb-2 px-1 text-2xs-plus dd-text-muted">
      {{ t('imagesView.hostUnsupported') }}
    </div>

    <div v-if="loading" class="text-2xs-plus dd-text-muted py-3 px-1">Loading images&hellip;</div>

    <DataFilterBar
      v-model="imagesViewMode"
      v-model:showFilters="showFilters"
      :filtered-count="tableRows.length"
      :total-count="images.length"
      :active-filter-count="activeFilterCount"
      :hide-view-toggle="cardReflowForced"
    >
      <template #filters>
        <select v-model="selectedHostId"
                :aria-label="t('imagesView.filters.host')"
                class="px-2 py-1.5 dd-rounded text-2xs-plus font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
          <option value="">{{ t('imagesView.filters.allHosts') }}</option>
          <option v-for="host in hosts" :key="host.id" :value="host.id" :disabled="!host.supported">
            {{ host.name }}
          </option>
        </select>
        <label class="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer select-none">
          <input v-model="unusedOnly"
                 type="checkbox"
                 class="w-3.5 h-3.5 dd-rounded-sm accent-[var(--dd-primary)]" />
          <span class="text-2xs-plus dd-text-muted">{{ t('imagesView.filters.unusedOnly') }}</span>
        </label>
      </template>
      <template #extra-buttons>
        <AppButton size="xs" variant="text-muted" weight="medium" :disabled="loading" @click="refresh">
          <AppIcon name="refresh" :size="14" class="mr-1" /> {{ t('imagesView.refresh') }}
        </AppButton>
        <template v-if="canPrune">
          <AppButton size="xs" variant="outlined" weight="medium" :disabled="pruning" @click="handlePrune('dangling')">
            {{ t('imagesView.prune.dangling') }}
          </AppButton>
          <AppButton size="xs" variant="outlined" weight="medium" :disabled="pruning" @click="handlePrune('unused')">
            {{ t('imagesView.prune.unused') }}
          </AppButton>
        </template>
        <span v-if="pruning" class="text-2xs dd-text-muted">
          {{ t('imagesView.prune.inProgress', { host: pruningHostText }) }}
        </span>
        <DataTableColumnPicker
          :columns="pickerColumns"
          :hidden-keys="hiddenColumnKeys"
          @toggle="toggleColumn"
          @reset="resetColumns" />
      </template>
    </DataFilterBar>

    <DataTable
      v-if="tableRows.length > 0 && !loading"
      :columns="tableColumns"
      storage-key="images"
      :rows="tableRows"
      row-key="id"
      :hidden-column-keys="hiddenColumnKeys"
      :prefer-cards="imagesViewMode === 'cards'"
      v-model:sort-key="sortKey"
      v-model:sort-asc="sortAsc"
      @update:card-reflow-forced="cardReflowForced = $event"
    >
      <template #cell-repository="{ row }">
        <span class="block truncate font-medium dd-text" v-tooltip.top="row.repository">{{ row.repository }}</span>
      </template>
      <template #cell-tag="{ row }">
        <span v-if="row.tagText" class="font-mono text-2xs dd-text-secondary">{{ row.tagText }}</span>
        <AppBadge v-else-if="row.dangling" tone="neutral" size="xs">{{ t('imagesView.dangling') }}</AppBadge>
        <span v-else class="dd-text-muted">&mdash;</span>
      </template>
      <template #cell-imageId="{ row }">
        <span class="font-mono text-2xs dd-text-secondary">{{ row.shortId }}</span>
      </template>
      <template #cell-size="{ row }">
        <span class="dd-text-secondary">{{ row.sizeLabel }}</span>
      </template>
      <template #cell-containers="{ row }">
        <span class="dd-text-secondary">{{ row.containers }}</span>
      </template>
      <template #cell-created="{ row }">
        <span class="dd-text-secondary" v-tooltip.top="formatAbsoluteTime(row.createdAt)">{{ row.createdLabel }}</span>
      </template>
      <template #cell-lastSeen="{ row }">
        <span class="dd-text-muted" v-tooltip.top="row.lastSeenAt ? formatAbsoluteTime(row.lastSeenAt) : ''">{{ row.lastSeenLabel }}</span>
      </template>
      <template #cell-host="{ row }">
        <span class="dd-text-secondary">{{ row.hostText }}</span>
      </template>
      <template #card="{ row }">
        <div class="flex flex-col flex-1">
          <div class="px-4 pt-4 pb-2 flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-sm-plus font-semibold truncate dd-text">{{ row.repository }}</div>
              <div class="text-2xs-plus truncate mt-0.5 dd-text-muted font-mono">
                <span v-if="row.tagText">{{ row.tagText }}</span>
                <AppBadge v-else-if="row.dangling" tone="neutral" size="xs">{{ t('imagesView.dangling') }}</AppBadge>
                <span v-else>{{ row.shortId }}</span>
              </div>
            </div>
          </div>
          <div class="px-4 py-3">
            <div class="grid grid-cols-2 gap-2 text-2xs-plus">
              <div>
                <span class="dd-text-muted">{{ t('imagesView.columns.size') }}</span>
                <span class="ml-1 font-semibold dd-text">{{ row.sizeLabel }}</span>
              </div>
              <div>
                <span class="dd-text-muted">{{ t('imagesView.columns.containers') }}</span>
                <span class="ml-1 font-semibold dd-text">{{ row.containers }}</span>
              </div>
              <div>
                <span class="dd-text-muted">{{ t('imagesView.columns.created') }}</span>
                <span class="ml-1 font-semibold dd-text">{{ row.createdLabel }}</span>
              </div>
              <div>
                <span class="dd-text-muted">{{ t('imagesView.columns.lastSeen') }}</span>
                <span class="ml-1 font-semibold dd-text">{{ row.lastSeenLabel }}</span>
              </div>
            </div>
          </div>
          <div class="px-4 py-2.5 mt-auto"
               :style="{ backgroundColor: 'var(--dd-bg-elevated)' }">
            <span class="text-2xs dd-text-muted">{{ row.hostText }}</span>
          </div>
        </div>
      </template>
    </DataTable>

    <EmptyState
      v-if="tableRows.length === 0 && !loading"
      icon="images"
      :message="t('imagesView.empty.description')"
    />
  </DataViewLayout>
</template>
