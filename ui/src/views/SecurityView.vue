<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useBreakpoints } from '../composables/useBreakpoints';
import { getAllContainers } from '../services/container';

interface Vulnerability {
  id: string;
  severity: string;
  package: string;
  version: string;
  fixedIn: string | null;
  image: string;
  publishedDate: string;
}

function severityColor(sev: string) {
  if (sev === 'CRITICAL') return { bg: 'var(--dd-danger-muted)', text: 'var(--dd-danger)' };
  if (sev === 'HIGH') return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)' };
  if (sev === 'MEDIUM') return { bg: 'var(--dd-caution-muted)', text: 'var(--dd-caution)' };
  return { bg: 'var(--dd-info-muted)', text: 'var(--dd-info)' };
}

const { windowNarrow: isCompact } = useBreakpoints();

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

onMounted(fetchVulnerabilities);

// -- View mode --
const securityViewMode = ref<'table' | 'cards' | 'list'>('table');

// -- Filters --
const showSecFilters = ref(false);
const secFilterSeverity = ref('all');
const secFilterStatus = ref('all');
const secFilterImage = ref('all');
const secFilterFix = ref('all');

const secImageNames = computed(() =>
  [...new Set(securityVulnerabilities.value.map((v) => v.image))].sort(),
);

const activeSecFilterCount = computed(
  () =>
    [secFilterSeverity, secFilterStatus, secFilterImage, secFilterFix].filter(
      (f) => f.value !== 'all',
    ).length,
);

function clearSecFilters() {
  secFilterSeverity.value = 'all';
  secFilterStatus.value = 'all';
  secFilterImage.value = 'all';
  secFilterFix.value = 'all';
}

// -- Sorting --
const securitySortField = ref('severity');
const securitySortAsc = ref(true);

const severityOrder: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

const filteredSecurityVulns = computed(() => {
  let list = [...securityVulnerabilities.value];

  if (secFilterSeverity.value !== 'all') {
    list = list.filter((v) => v.severity === secFilterSeverity.value);
  }
  if (secFilterImage.value !== 'all') {
    list = list.filter((v) => v.image === secFilterImage.value);
  }
  if (secFilterFix.value !== 'all') {
    list = list.filter((v) =>
      secFilterFix.value === 'yes' ? v.fixedIn !== null : v.fixedIn === null,
    );
  }

  const field = securitySortField.value;
  const asc = securitySortAsc.value;
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

// -- Column visibility --
const secAllColumns = [
  { key: 'severity', label: 'Severity', align: 'text-left', width: '99%', required: true },
  { key: 'cve', label: 'CVE', align: 'text-left', required: false },
  { key: 'package', label: 'Package', align: 'text-left', required: false },
  { key: 'fixedIn', label: 'Fix', align: 'text-center', required: false },
  { key: 'image', label: 'Image', align: 'text-left', required: false },
  { key: 'published', label: 'Published', align: 'text-right', required: false },
];

const secVisibleColumns = ref<Set<string>>(new Set(secAllColumns.map((c) => c.key)));
const showSecColumnPicker = ref(false);

function toggleSecColumn(key: string) {
  const col = secAllColumns.find((c) => c.key === key);
  if (col?.required) return;
  if (secVisibleColumns.value.has(key)) secVisibleColumns.value.delete(key);
  else secVisibleColumns.value.add(key);
}

const secActiveColumns = computed(() =>
  secAllColumns.filter(
    (c) => secVisibleColumns.value.has(c.key) && (!isCompact.value || c.required),
  ),
);
</script>

<template>
  <AppLayout>
    <div>
      <!-- Filter bar -->
      <DataFilterBar
        v-model="securityViewMode"
        v-model:showFilters="showSecFilters"
        :filtered-count="filteredSecurityVulns.length"
        :total-count="securityVulnerabilities.length"
        :active-filter-count="activeSecFilterCount">
        <template #filters>
          <select v-model="secFilterSeverity"
                  class="px-2 py-1.5 dd-rounded text-[11px] font-semibold uppercase tracking-wide border outline-none cursor-pointer dd-bg dd-text dd-border-strong">
            <option value="all">Severity</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
          <select v-model="secFilterStatus"
                  class="px-2 py-1.5 dd-rounded text-[11px] font-semibold uppercase tracking-wide border outline-none cursor-pointer dd-bg dd-text dd-border-strong">
            <option value="all">Status</option>
            <option value="clean">Clean</option>
            <option value="issues">Issues</option>
          </select>
          <select v-model="secFilterImage"
                  class="px-2 py-1.5 dd-rounded text-[11px] font-semibold uppercase tracking-wide border outline-none cursor-pointer dd-bg dd-text dd-border-strong">
            <option value="all">Image</option>
            <option v-for="img in secImageNames" :key="img" :value="img">{{ img }}</option>
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
        <template #extra-buttons>
          <div v-if="securityViewMode === 'table'" class="relative">
            <button class="w-7 h-7 dd-rounded flex items-center justify-center text-[11px] transition-colors border"
                    :class="showSecColumnPicker ? 'dd-text dd-bg-elevated' : 'dd-text-muted hover:dd-text dd-bg-card'"
                    :style="{ borderColor: 'var(--dd-border-strong)' }"
                    title="Toggle columns"
                    @click.stop="showSecColumnPicker = !showSecColumnPicker">
              <AppIcon name="config" :size="10" />
            </button>
            <div v-if="showSecColumnPicker" @click.stop
                 class="absolute right-0 top-9 z-50 min-w-[160px] py-1.5 dd-rounded shadow-lg"
                 :style="{
                   backgroundColor: 'var(--dd-bg-card)',
                   border: '1px solid var(--dd-border-strong)',
                   boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                 }">
              <div class="px-3 py-1 text-[9px] font-bold uppercase tracking-wider dd-text-muted">Columns</div>
              <button v-for="col in secAllColumns" :key="col.key"
                      class="w-full text-left px-3 py-1.5 text-[11px] font-medium transition-colors flex items-center gap-2 hover:dd-bg-elevated"
                      :class="col.required ? 'dd-text-muted cursor-not-allowed' : 'dd-text'"
                      @click="toggleSecColumn(col.key)">
                <AppIcon :name="secVisibleColumns.has(col.key) ? 'check' : 'square'" :size="10"
                         :style="secVisibleColumns.has(col.key) ? { color: 'var(--dd-primary)' } : {}" />
                {{ col.label }}
              </button>
            </div>
          </div>
        </template>
      </DataFilterBar>

      <!-- Table view -->
      <DataTable v-if="securityViewMode === 'table'"
                 :columns="secActiveColumns"
                 :rows="filteredSecurityVulns"
                 row-key="id"
                 v-model:sort-key="securitySortField"
                 v-model:sort-asc="securitySortAsc">
        <template #cell-severity="{ row }">
          <div class="flex items-start gap-2 min-w-0">
            <span class="badge text-[9px] uppercase font-bold shrink-0"
                  :style="{ backgroundColor: severityColor(row.severity).bg, color: severityColor(row.severity).text }">
              {{ row.severity }}
            </span>
            <!-- Compact mode: folded info -->
            <div v-if="isCompact" class="min-w-0 flex-1">
              <div class="font-medium font-mono text-[11px] truncate dd-text">{{ row.id }}</div>
              <div class="text-[10px] mt-0.5 truncate dd-text-muted">{{ row.package }} {{ row.version }}</div>
              <div class="flex items-center gap-1.5 mt-1.5">
                <span v-if="row.fixedIn"
                      class="badge px-1.5 py-0 text-[9px]"
                      style="background: var(--dd-success-muted); color: var(--dd-success);">
                  <AppIcon name="config" :size="9" />
                </span>
                <span v-else class="badge px-1.5 py-0 text-[9px]"
                      style="background: var(--dd-neutral-muted); color: var(--dd-neutral);">
                  <AppIcon name="xmark" :size="9" />
                </span>
                <span class="badge text-[7px] font-bold px-1.5 py-0 dd-bg-elevated dd-text-secondary">
                  {{ row.image }}
                </span>
                <span class="text-[9px] dd-text-muted ml-auto">{{ row.publishedDate }}</span>
              </div>
            </div>
          </div>
        </template>
        <template #cell-cve="{ row }">
          <span class="font-medium font-mono dd-text">{{ row.id }}</span>
        </template>
        <template #cell-package="{ row }">
          <div>
            <span class="font-medium dd-text">{{ row.package }}</span>
            <span class="ml-1.5 text-[10px] dd-text-muted">{{ row.version }}</span>
          </div>
        </template>
        <template #cell-fixedIn="{ row }">
          <span v-if="row.fixedIn"
                class="px-1.5 py-0.5 dd-rounded-sm text-[10px] font-medium"
                style="background: var(--dd-success-muted); color: var(--dd-success);">
            {{ row.fixedIn }}
          </span>
          <span v-else class="text-[10px] dd-text-muted">No fix</span>
        </template>
        <template #cell-image="{ row }">
          <span class="dd-text-secondary">{{ row.image }}</span>
        </template>
        <template #cell-published="{ row }">
          <span class="dd-text-muted">{{ row.publishedDate }}</span>
        </template>
        <template #empty>
          <EmptyState icon="security"
                      message="No vulnerabilities match your filters"
                      :show-clear="activeSecFilterCount > 0"
                      @clear="clearSecFilters" />
        </template>
      </DataTable>

      <!-- Card view -->
      <DataCardGrid v-if="securityViewMode === 'cards'"
                    :items="filteredSecurityVulns"
                    item-key="id"
                    min-width="300px">
        <template #card="{ item: vuln }">
          <div class="px-4 pt-4 pb-2 flex items-start justify-between">
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="badge text-[9px] uppercase font-bold shrink-0"
                      :style="{ backgroundColor: severityColor(vuln.severity).bg, color: severityColor(vuln.severity).text }">
                  {{ vuln.severity }}
                </span>
                <span class="font-mono text-[12px] font-semibold truncate dd-text">{{ vuln.id }}</span>
              </div>
              <div class="text-[11px] mt-1.5 dd-text-muted">
                {{ vuln.package }} <span class="dd-text-secondary">{{ vuln.version }}</span>
              </div>
            </div>
          </div>
          <div class="px-4 py-3 flex items-center gap-3">
            <span class="text-[10px] dd-text-muted">Image</span>
            <span class="text-[11px] font-medium dd-text">{{ vuln.image }}</span>
          </div>
          <div class="px-4 py-2.5 flex items-center justify-between mt-auto"
               :style="{
                 borderTop: '1px solid var(--dd-border-strong)',
                 backgroundColor: 'var(--dd-bg-elevated)',
               }">
            <span v-if="vuln.fixedIn"
                  class="text-[11px] font-medium flex items-center gap-1.5"
                  style="color: var(--dd-success);">
              <AppIcon name="restart" :size="9" />
              Fix: {{ vuln.fixedIn }}
            </span>
            <span v-else class="text-[11px] dd-text-muted">No fix available</span>
            <span class="text-[10px] dd-text-muted">{{ vuln.publishedDate }}</span>
          </div>
        </template>
      </DataCardGrid>

      <!-- Empty state for cards -->
      <EmptyState v-if="securityViewMode === 'cards' && filteredSecurityVulns.length === 0"
                  icon="security"
                  message="No vulnerabilities match your filters"
                  :show-clear="activeSecFilterCount > 0"
                  @clear="clearSecFilters" />

      <!-- List view -->
      <DataListAccordion v-if="securityViewMode === 'list'"
                         :items="filteredSecurityVulns"
                         item-key="id">
        <template #header="{ item: vuln }">
          <span class="badge text-[9px] uppercase font-bold shrink-0"
                :style="{ backgroundColor: severityColor(vuln.severity).bg, color: severityColor(vuln.severity).text }">
            {{ vuln.severity }}
          </span>
          <span class="text-sm font-semibold font-mono flex-1 min-w-0 truncate dd-text">{{ vuln.id }}</span>
          <span class="text-[11px] dd-text-secondary shrink-0">{{ vuln.package }}</span>
          <span v-if="vuln.fixedIn" class="badge text-[9px] font-bold shrink-0"
                :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' }">
            Fix: {{ vuln.fixedIn }}
          </span>
          <span v-else class="badge text-[9px] font-bold shrink-0"
                :style="{ backgroundColor: 'var(--dd-neutral-muted)', color: 'var(--dd-neutral)' }">
            No fix
          </span>
        </template>
        <template #details="{ item: vuln }">
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-3 mt-2">
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">CVE</div>
              <div class="text-[12px] font-mono dd-text">{{ vuln.id }}</div>
            </div>
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Package</div>
              <div class="text-[12px] font-mono dd-text">{{ vuln.package }} {{ vuln.version }}</div>
            </div>
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Image</div>
              <div class="text-[12px] dd-text">{{ vuln.image }}</div>
            </div>
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Severity</div>
              <span class="badge text-[10px] uppercase font-bold"
                    :style="{ backgroundColor: severityColor(vuln.severity).bg, color: severityColor(vuln.severity).text }">
                {{ vuln.severity }}
              </span>
            </div>
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Fix Available</div>
              <span v-if="vuln.fixedIn" class="badge text-[10px] font-bold"
                    :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' }">
                {{ vuln.fixedIn }}
              </span>
              <span v-else class="text-[12px] dd-text-muted">No fix available</span>
            </div>
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-0.5 dd-text-muted">Published</div>
              <div class="text-[12px] dd-text">{{ vuln.publishedDate }}</div>
            </div>
          </div>
        </template>
      </DataListAccordion>

      <!-- Empty state for list -->
      <EmptyState v-if="securityViewMode === 'list' && filteredSecurityVulns.length === 0"
                  icon="security"
                  message="No vulnerabilities match your filters"
                  :show-clear="activeSecFilterCount > 0"
                  @clear="clearSecFilters" />
    </div>
  </AppLayout>
</template>
