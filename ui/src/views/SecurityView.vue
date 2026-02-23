<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useBreakpoints } from '../composables/useBreakpoints';
import { getAllContainers, scanContainer } from '../services/container';

interface Vulnerability {
  id: string;
  severity: string;
  package: string;
  version: string;
  fixedIn: string | null;
  image: string;
  publishedDate: string;
}

interface ImageSummary {
  image: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
  fixable: number;
  vulns: Vulnerability[];
}

function severityColor(sev: string) {
  if (sev === 'CRITICAL') return { bg: 'var(--dd-danger-muted)', text: 'var(--dd-danger)' };
  if (sev === 'HIGH') return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)' };
  if (sev === 'MEDIUM') return { bg: 'var(--dd-caution-muted)', text: 'var(--dd-caution)' };
  return { bg: 'var(--dd-info-muted)', text: 'var(--dd-info)' };
}

function severityIcon(sev: string): string {
  if (sev === 'CRITICAL') return 'warning';
  if (sev === 'HIGH') return 'chevrons-up';
  if (sev === 'MEDIUM') return 'neutral';
  return 'chevron-down';
}

const { isMobile, windowNarrow: isCompact } = useBreakpoints();

const loading = ref(true);
const error = ref<string | null>(null);
const securityVulnerabilities = ref<Vulnerability[]>([]);

async function fetchVulnerabilities() {
  loading.value = true;
  error.value = null;
  try {
    const containers = await getAllContainers();
    const vulns: Vulnerability[] = [];

    for (const container of containers) {
      const scan = container.security?.scan;
      if (!scan || !Array.isArray(scan.vulnerabilities)) continue;

      const imageName = container.displayName || container.name || 'unknown';
      for (const v of scan.vulnerabilities) {
        vulns.push({
          id: v.id ?? 'unknown',
          severity: (v.severity ?? 'UNKNOWN').toUpperCase(),
          package: v.packageName ?? v.package ?? 'unknown',
          version: v.installedVersion ?? v.version ?? '',
          fixedIn: v.fixedVersion ?? v.fixedIn ?? null,
          image: imageName,
          publishedDate: v.publishedDate ?? '',
        });
      }
    }

    securityVulnerabilities.value = vulns;
  } catch (e: any) {
    error.value = e?.message ?? 'Failed to load vulnerability data';
  } finally {
    loading.value = false;
  }
}

function handleSseScanCompleted() {
  fetchVulnerabilities();
}

const scanning = ref(false);
const scanProgress = ref({ done: 0, total: 0 });

async function scanAllContainers() {
  scanning.value = true;
  scanProgress.value = { done: 0, total: 0 };
  try {
    const containers = await getAllContainers();
    scanProgress.value.total = containers.length;
    for (const container of containers) {
      try {
        await scanContainer(container.id);
      } catch {
        // Individual scan failures shouldn't stop the batch
      }
      scanProgress.value.done++;
    }
    await fetchVulnerabilities();
  } finally {
    scanning.value = false;
  }
}

// -- View mode --
const securityViewMode = ref<'table' | 'cards' | 'list'>('table');

// -- Filters --
const showSecFilters = ref(false);
const secFilterSeverity = ref('all');
const secFilterFix = ref('all');

const activeSecFilterCount = computed(
  () =>
    [secFilterSeverity, secFilterFix].filter(
      (f) => f.value !== 'all',
    ).length,
);

function clearSecFilters() {
  secFilterSeverity.value = 'all';
  secFilterFix.value = 'all';
}

// -- Sorting --
const securitySortField = ref('critical');
const securitySortAsc = ref(false);

const severityOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

// -- Group vulnerabilities by image --
const imageSummaries = computed<ImageSummary[]>(() => {
  const map = new Map<string, ImageSummary>();

  for (const v of securityVulnerabilities.value) {
    let summary = map.get(v.image);
    if (!summary) {
      summary = { image: v.image, critical: 0, high: 0, medium: 0, low: 0, total: 0, fixable: 0, vulns: [] };
      map.set(v.image, summary);
    }
    if (v.severity === 'CRITICAL') summary.critical++;
    else if (v.severity === 'HIGH') summary.high++;
    else if (v.severity === 'MEDIUM') summary.medium++;
    else summary.low++;
    if (v.fixedIn) summary.fixable++;
    summary.total++;
    summary.vulns.push(v);
  }

  // Sort vulns within each image by severity
  for (const s of map.values()) {
    s.vulns.sort((a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99));
  }

  return [...map.values()];
});

const filteredSummaries = computed(() => {
  let list = [...imageSummaries.value];

  // Filter: only include images that have vulns matching the severity filter
  if (secFilterSeverity.value !== 'all') {
    const sev = secFilterSeverity.value;
    list = list.filter((s) => {
      if (sev === 'CRITICAL') return s.critical > 0;
      if (sev === 'HIGH') return s.high > 0;
      if (sev === 'MEDIUM') return s.medium > 0;
      return s.low > 0;
    });
  }
  if (secFilterFix.value !== 'all') {
    list = list.filter((s) =>
      secFilterFix.value === 'yes' ? s.fixable > 0 : s.fixable < s.total,
    );
  }

  const field = securitySortField.value;
  const asc = securitySortAsc.value;
  list.sort((a, b) => {
    let cmp = 0;
    if (field === 'image') {
      cmp = a.image.localeCompare(b.image);
    } else {
      const av = (a as Record<string, unknown>)[field] as number ?? 0;
      const bv = (b as Record<string, unknown>)[field] as number ?? 0;
      cmp = av - bv;
    }
    return asc ? cmp : -cmp;
  });

  return list;
});

// -- Detail panel --
const selectedImage = ref<ImageSummary | null>(null);
const detailOpen = ref(false);

function openDetail(summary: ImageSummary) {
  selectedImage.value = summary;
  detailOpen.value = true;
}

// Detail panel vuln sort
const detailSortField = ref('severity');
const detailSortAsc = ref(true);

const selectedImageVulns = computed(() => {
  if (!selectedImage.value) return [];
  let list = [...selectedImage.value.vulns];

  const field = detailSortField.value;
  const asc = detailSortAsc.value;
  list.sort((a, b) => {
    let cmp = 0;
    if (field === 'severity') {
      cmp = (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99);
    } else {
      const av = String((a as Record<string, unknown>)[field] ?? '');
      const bv = String((b as Record<string, unknown>)[field] ?? '');
      cmp = av.localeCompare(bv);
    }
    return asc ? cmp : -cmp;
  });
  return list;
});

// -- Table columns --
const tableColumns = computed(() => {
  if (isCompact.value) {
    return [
      { key: 'image', label: 'Image', align: 'text-left', width: '99%' },
      { key: 'total', label: 'Total', align: 'text-center', sortable: true },
    ];
  }
  return [
    { key: 'image', label: 'Image', align: 'text-left', width: '99%' },
    { key: 'critical', label: 'Critical', align: 'text-center', sortable: true },
    { key: 'high', label: 'High', align: 'text-center', sortable: true },
    { key: 'medium', label: 'Medium', align: 'text-center', sortable: true },
    { key: 'low', label: 'Low', align: 'text-center', sortable: true },
    { key: 'fixable', label: 'Fixable', align: 'text-center', sortable: true },
    { key: 'total', label: 'Total', align: 'text-center', sortable: true },
  ];
});

// Highest severity for an image (used for compact mode indicator)
function highestSeverity(summary: ImageSummary): string {
  if (summary.critical > 0) return 'CRITICAL';
  if (summary.high > 0) return 'HIGH';
  if (summary.medium > 0) return 'MEDIUM';
  return 'LOW';
}

// -- Column picker (kept for non-compact table) --
const showSecColumnPicker = ref(false);
const secColumnPickerStyle = ref<Record<string, string>>({});

function toggleSecColumnPicker(event: MouseEvent) {
  showSecColumnPicker.value = !showSecColumnPicker.value;
  if (showSecColumnPicker.value) {
    const btn = event.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    secColumnPickerStyle.value = {
      position: 'fixed',
      top: `${rect.bottom + 4}px`,
      left: `${rect.left}px`,
    };
  }
}

function handleGlobalClick() {
  showSecColumnPicker.value = false;
}
onMounted(() => {
  fetchVulnerabilities();
  document.addEventListener('click', handleGlobalClick);
  globalThis.addEventListener('dd:sse-scan-completed', handleSseScanCompleted as EventListener);
});
onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick);
  globalThis.removeEventListener(
    'dd:sse-scan-completed',
    handleSseScanCompleted as EventListener,
  );
});
</script>

<template>
  <DataViewLayout>
      <div v-if="error"
           class="mb-3 px-3 py-2 text-[11px] dd-rounded"
           :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
        {{ error }}
      </div>

      <div v-if="loading" class="text-[11px] dd-text-muted py-3 px-1">Loading vulnerability data...</div>

      <!-- Filter bar -->
      <DataFilterBar
        v-model="securityViewMode"
        v-model:showFilters="showSecFilters"
        :filtered-count="filteredSummaries.length"
        :total-count="imageSummaries.length"
        :active-filter-count="activeSecFilterCount"
        count-label="images">
        <template #filters>
          <select v-model="secFilterSeverity"
                  class="px-2 py-1.5 dd-rounded text-[11px] font-semibold uppercase tracking-wide border outline-none cursor-pointer dd-bg dd-text dd-border-strong">
            <option value="all">Severity</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
          <select v-model="secFilterFix"
                  class="px-2 py-1.5 dd-rounded text-[11px] font-semibold uppercase tracking-wide border outline-none cursor-pointer dd-bg dd-text dd-border-strong">
            <option value="all">Fix Available</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
          <button v-if="activeSecFilterCount > 0"
                  class="text-[10px] font-medium px-2 py-1 dd-rounded transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                  @click="clearSecFilters">
            Clear all
          </button>
        </template>
        <template #left>
          <button class="w-7 h-7 dd-rounded flex items-center justify-center text-[11px] transition-colors border"
                  :class="scanning ? 'dd-text-muted cursor-wait' : 'dd-text-muted hover:dd-text hover:dd-bg-elevated'"
                  :style="{ borderColor: 'var(--dd-border-strong)' }"
                  :disabled="scanning"
                  title="Scan all containers for vulnerabilities"
                  @click="scanAllContainers">
            <AppIcon name="restart" :size="11" :class="{ 'animate-spin': scanning }" />
          </button>
        </template>
      </DataFilterBar>

      <!-- Table view — grouped by image -->
      <DataTable v-if="securityViewMode === 'table' && !loading"
                 :columns="tableColumns"
                 :rows="filteredSummaries"
                 row-key="image"
                 :selected-key="selectedImage?.image"
                 v-model:sort-key="securitySortField"
                 v-model:sort-asc="securitySortAsc"
                 @row-click="openDetail($event)">
        <template #cell-image="{ row }">
          <div class="flex items-center gap-2 min-w-0">
            <AppIcon :name="severityIcon(highestSeverity(row))" :size="13" class="shrink-0 md:!hidden"
                     :style="{ color: severityColor(highestSeverity(row)).text }" />
            <span class="font-medium dd-text truncate">{{ row.image }}</span>
          </div>
        </template>
        <template #cell-critical="{ row }">
          <span v-if="row.critical > 0" class="badge text-[9px] font-bold"
                :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
            {{ row.critical }}
          </span>
          <span v-else class="text-[10px] dd-text-muted">&mdash;</span>
        </template>
        <template #cell-high="{ row }">
          <span v-if="row.high > 0" class="badge text-[9px] font-bold"
                :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
            {{ row.high }}
          </span>
          <span v-else class="text-[10px] dd-text-muted">&mdash;</span>
        </template>
        <template #cell-medium="{ row }">
          <span v-if="row.medium > 0" class="badge text-[9px] font-bold"
                :style="{ backgroundColor: 'var(--dd-caution-muted)', color: 'var(--dd-caution)' }">
            {{ row.medium }}
          </span>
          <span v-else class="text-[10px] dd-text-muted">&mdash;</span>
        </template>
        <template #cell-low="{ row }">
          <span v-if="row.low > 0" class="badge text-[9px] font-bold"
                :style="{ backgroundColor: 'var(--dd-info-muted)', color: 'var(--dd-info)' }">
            {{ row.low }}
          </span>
          <span v-else class="text-[10px] dd-text-muted">&mdash;</span>
        </template>
        <template #cell-fixable="{ row }">
          <span v-if="row.fixable > 0" class="text-[10px] font-medium" style="color: var(--dd-success);">
            {{ row.fixable }}<span class="dd-text-muted">/{{ row.total }}</span>
          </span>
          <span v-else class="text-[10px] dd-text-muted">0</span>
        </template>
        <template #cell-total="{ row }">
          <div class="flex items-center gap-1.5">
            <!-- Compact mode: inline severity pills -->
            <template v-if="isCompact">
              <span v-if="row.critical > 0" class="badge text-[8px] font-bold px-1 py-0"
                    :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
                C{{ row.critical }}
              </span>
              <span v-if="row.high > 0" class="badge text-[8px] font-bold px-1 py-0"
                    :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
                H{{ row.high }}
              </span>
              <span v-if="row.medium > 0" class="badge text-[8px] font-bold px-1 py-0"
                    :style="{ backgroundColor: 'var(--dd-caution-muted)', color: 'var(--dd-caution)' }">
                M{{ row.medium }}
              </span>
              <span v-if="row.low > 0" class="badge text-[8px] font-bold px-1 py-0"
                    :style="{ backgroundColor: 'var(--dd-info-muted)', color: 'var(--dd-info)' }">
                L{{ row.low }}
              </span>
            </template>
            <span class="text-[11px] font-semibold dd-text">{{ row.total }}</span>
          </div>
        </template>
        <template #empty>
          <div class="flex flex-col items-center justify-center py-16">
            <AppIcon name="security" :size="24" class="mb-3 dd-text-muted" />
            <p class="text-sm font-medium mb-1 dd-text-secondary">
              {{ securityVulnerabilities.length === 0 ? 'No vulnerability data yet' : 'No images match your filters' }}
            </p>
            <p v-if="securityVulnerabilities.length === 0" class="text-xs dd-text-muted mb-3">
              Run a scan to check your containers for known vulnerabilities
            </p>
            <div class="flex items-center gap-2 mt-2">
              <button v-if="activeSecFilterCount > 0"
                      class="text-xs font-medium px-3 py-1.5 dd-rounded transition-colors text-drydock-secondary bg-drydock-secondary/10 hover:bg-drydock-secondary/20"
                      @click="clearSecFilters">
                Clear all filters
              </button>
              <button v-if="securityVulnerabilities.length === 0"
                      class="text-xs font-medium px-3 py-1.5 dd-rounded transition-colors flex items-center gap-1.5"
                      :class="scanning ? 'dd-text-muted cursor-wait dd-bg-elevated' : 'text-drydock-secondary bg-drydock-secondary/10 hover:bg-drydock-secondary/20'"
                      :disabled="scanning"
                      @click="scanAllContainers">
                <AppIcon name="restart" :size="12" :class="{ 'animate-spin': scanning }" />
                {{ scanning ? `Scanning ${scanProgress.done}/${scanProgress.total}...` : 'Scan Now' }}
              </button>
            </div>
          </div>
        </template>
      </DataTable>

      <!-- Card view — one card per image -->
      <DataCardGrid v-if="securityViewMode === 'cards' && !loading"
                    :items="filteredSummaries"
                    item-key="image"
                    :selected-key="selectedImage?.image"
                    min-width="280px"
                    @item-click="openDetail($event)">
        <template #card="{ item: summary }">
          <div class="px-4 pt-4 pb-2 flex items-start justify-between">
            <div class="min-w-0">
              <div class="text-[14px] font-semibold truncate dd-text">{{ summary.image }}</div>
              <div class="text-[10px] mt-0.5 dd-text-muted">{{ summary.total }} vulnerabilities</div>
            </div>
            <AppIcon :name="severityIcon(highestSeverity(summary))" :size="16" class="shrink-0 ml-2"
                     :style="{ color: severityColor(highestSeverity(summary)).text }" />
          </div>
          <div class="px-4 py-3">
            <div class="flex items-center gap-1.5 flex-wrap">
              <span v-if="summary.critical > 0" class="badge text-[9px] font-bold"
                    :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
                {{ summary.critical }} Critical
              </span>
              <span v-if="summary.high > 0" class="badge text-[9px] font-bold"
                    :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
                {{ summary.high }} High
              </span>
              <span v-if="summary.medium > 0" class="badge text-[9px] font-bold"
                    :style="{ backgroundColor: 'var(--dd-caution-muted)', color: 'var(--dd-caution)' }">
                {{ summary.medium }} Medium
              </span>
              <span v-if="summary.low > 0" class="badge text-[9px] font-bold"
                    :style="{ backgroundColor: 'var(--dd-info-muted)', color: 'var(--dd-info)' }">
                {{ summary.low }} Low
              </span>
            </div>
          </div>
          <div class="px-4 py-2.5 flex items-center justify-between mt-auto"
               :style="{ borderTop: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-elevated)' }">
            <span v-if="summary.fixable > 0" class="text-[11px] font-medium flex items-center gap-1"
                  style="color: var(--dd-success);">
              <AppIcon name="check" :size="11" />
              {{ summary.fixable }} fixable
            </span>
            <span v-else class="text-[11px] dd-text-muted">No fixes available</span>
            <span class="text-[10px] dd-text-muted">{{ summary.total }} total</span>
          </div>
        </template>
      </DataCardGrid>

      <!-- Empty state for cards -->
      <div v-if="securityViewMode === 'cards' && filteredSummaries.length === 0 && !loading"
           class="flex flex-col items-center justify-center py-16 dd-rounded"
           :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
        <AppIcon name="security" :size="24" class="mb-3 dd-text-muted" />
        <p class="text-sm font-medium mb-1 dd-text-secondary">
          {{ securityVulnerabilities.length === 0 ? 'No vulnerability data yet' : 'No images match your filters' }}
        </p>
        <p v-if="securityVulnerabilities.length === 0" class="text-xs dd-text-muted mb-3">
          Run a scan to check your containers for known vulnerabilities
        </p>
        <div class="flex items-center gap-2 mt-2">
          <button v-if="activeSecFilterCount > 0"
                  class="text-xs font-medium px-3 py-1.5 dd-rounded transition-colors text-drydock-secondary bg-drydock-secondary/10 hover:bg-drydock-secondary/20"
                  @click="clearSecFilters">
            Clear all filters
          </button>
          <button v-if="securityVulnerabilities.length === 0"
                  class="text-xs font-medium px-3 py-1.5 dd-rounded transition-colors flex items-center gap-1.5"
                  :class="scanning ? 'dd-text-muted cursor-wait dd-bg-elevated' : 'text-drydock-secondary bg-drydock-secondary/10 hover:bg-drydock-secondary/20'"
                  :disabled="scanning"
                  @click="scanAllContainers">
            <AppIcon name="restart" :size="12" :class="{ 'animate-spin': scanning }" />
            {{ scanning ? `Scanning ${scanProgress.done}/${scanProgress.total}...` : 'Scan Now' }}
          </button>
        </div>
      </div>

      <!-- List view — one row per image, expandable -->
      <DataListAccordion v-if="securityViewMode === 'list' && !loading"
                         :items="filteredSummaries"
                         item-key="image"
                         :selected-key="selectedImage?.image"
                         @item-click="openDetail($event)">
        <template #header="{ item: summary }">
          <AppIcon :name="severityIcon(highestSeverity(summary))" :size="13" class="shrink-0"
                   :style="{ color: severityColor(highestSeverity(summary)).text }" />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold truncate dd-text">{{ summary.image }}</div>
            <div class="text-[10px] dd-text-muted mt-0.5">{{ summary.total }} vulnerabilities</div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <span v-if="summary.critical > 0" class="badge text-[8px] font-bold px-1.5 py-0"
                  :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
              {{ summary.critical }}C
            </span>
            <span v-if="summary.high > 0" class="badge text-[8px] font-bold px-1.5 py-0"
                  :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
              {{ summary.high }}H
            </span>
            <span v-if="summary.fixable > 0" class="badge text-[8px] font-bold px-1.5 py-0"
                  :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' }">
              {{ summary.fixable }} fix
            </span>
          </div>
        </template>
      </DataListAccordion>

      <!-- Empty state for list -->
      <div v-if="securityViewMode === 'list' && filteredSummaries.length === 0 && !loading"
           class="flex flex-col items-center justify-center py-16 dd-rounded"
           :style="{ backgroundColor: 'var(--dd-bg-card)', border: '1px solid var(--dd-border-strong)' }">
        <AppIcon name="security" :size="24" class="mb-3 dd-text-muted" />
        <p class="text-sm font-medium mb-1 dd-text-secondary">
          {{ securityVulnerabilities.length === 0 ? 'No vulnerability data yet' : 'No images match your filters' }}
        </p>
        <p v-if="securityVulnerabilities.length === 0" class="text-xs dd-text-muted mb-3">
          Run a scan to check your containers for known vulnerabilities
        </p>
        <div class="flex items-center gap-2 mt-2">
          <button v-if="activeSecFilterCount > 0"
                  class="text-xs font-medium px-3 py-1.5 dd-rounded transition-colors text-drydock-secondary bg-drydock-secondary/10 hover:bg-drydock-secondary/20"
                  @click="clearSecFilters">
            Clear all filters
          </button>
          <button v-if="securityVulnerabilities.length === 0"
                  class="text-xs font-medium px-3 py-1.5 dd-rounded transition-colors flex items-center gap-1.5"
                  :class="scanning ? 'dd-text-muted cursor-wait dd-bg-elevated' : 'text-drydock-secondary bg-drydock-secondary/10 hover:bg-drydock-secondary/20'"
                  :disabled="scanning"
                  @click="scanAllContainers">
            <AppIcon name="restart" :size="12" :class="{ 'animate-spin': scanning }" />
            {{ scanning ? `Scanning ${scanProgress.done}/${scanProgress.total}...` : 'Scan Now' }}
          </button>
        </div>
      </div>

    <!-- Detail panel — full vulnerability report for selected image -->
    <template #panel>
      <DetailPanel
        :open="detailOpen"
        :is-mobile="isMobile"
        :show-size-controls="true"
        :show-full-page="false"
        @update:open="detailOpen = $event; if (!$event) selectedImage = null"
      >
        <template #header>
          <div class="flex items-center gap-2.5 min-w-0">
            <AppIcon name="security" :size="14" class="shrink-0 dd-text-secondary" />
            <span class="text-sm font-bold truncate dd-text">{{ selectedImage?.image }}</span>
          </div>
        </template>

        <template #subtitle>
          <div class="flex items-center gap-2 flex-wrap">
            <span v-if="selectedImage?.critical" class="badge text-[9px] font-bold"
                  :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
              {{ selectedImage.critical }} Critical
            </span>
            <span v-if="selectedImage?.high" class="badge text-[9px] font-bold"
                  :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
              {{ selectedImage.high }} High
            </span>
            <span v-if="selectedImage?.medium" class="badge text-[9px] font-bold"
                  :style="{ backgroundColor: 'var(--dd-caution-muted)', color: 'var(--dd-caution)' }">
              {{ selectedImage.medium }} Medium
            </span>
            <span v-if="selectedImage?.low" class="badge text-[9px] font-bold"
                  :style="{ backgroundColor: 'var(--dd-info-muted)', color: 'var(--dd-info)' }">
              {{ selectedImage.low }} Low
            </span>
            <span class="text-[10px] dd-text-muted ml-auto">{{ selectedImage?.total }} total</span>
          </div>
        </template>

        <template v-if="selectedImage" #default>
          <!-- Vulnerability list -->
          <div class="divide-y" :style="{ borderColor: 'var(--dd-border)' }">
            <div v-for="vuln in selectedImageVulns" :key="vuln.id + vuln.package"
                 class="px-4 py-3 hover:dd-bg-hover transition-colors">
              <div class="flex items-center gap-2 mb-1.5">
                <AppIcon :name="severityIcon(vuln.severity)" :size="12"
                         :style="{ color: severityColor(vuln.severity).text }" />
                <span class="badge text-[8px] uppercase font-bold"
                      :style="{ backgroundColor: severityColor(vuln.severity).bg, color: severityColor(vuln.severity).text }">
                  {{ vuln.severity }}
                </span>
                <span class="font-mono text-[11px] font-semibold dd-text truncate">{{ vuln.id }}</span>
              </div>
              <div class="flex items-center gap-2 text-[11px] ml-5">
                <span class="font-medium dd-text">{{ vuln.package }}</span>
                <span class="dd-text-muted">{{ vuln.version }}</span>
                <span v-if="vuln.fixedIn" class="ml-auto badge text-[8px] font-bold px-1.5 py-0"
                      style="background: var(--dd-success-muted); color: var(--dd-success);">
                  <AppIcon name="check" :size="9" class="mr-0.5" />
                  {{ vuln.fixedIn }}
                </span>
                <span v-else class="ml-auto text-[10px] dd-text-muted">No fix</span>
              </div>
            </div>
          </div>
        </template>
      </DetailPanel>
    </template>
  </DataViewLayout>
</template>
