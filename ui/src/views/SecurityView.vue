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

// ── View mode ──
const securityViewMode = ref<'table' | 'cards' | 'list'>('table');

// ── Filters ──
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

// ── Sorting ──
const securitySortField = ref('severity');
const securitySortAsc = ref(true);

function toggleSecuritySort(key: string) {
  if (securitySortField.value === key) {
    securitySortAsc.value = !securitySortAsc.value;
  } else {
    securitySortField.value = key;
    securitySortAsc.value = true;
  }
}

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

// ── Column visibility ──
const secAllColumns = [
  {
    key: 'severity',
    label: 'Severity',
    align: 'text-left',
    px: 'px-5',
    style: 'width: 99%;',
    required: true,
  },
  { key: 'cve', label: 'CVE', align: 'text-left', px: 'px-5', style: '', required: false },
  { key: 'package', label: 'Package', align: 'text-left', px: 'px-5', style: '', required: false },
  { key: 'fixedIn', label: 'Fix', align: 'text-center', px: 'px-5', style: '', required: false },
  { key: 'image', label: 'Image', align: 'text-left', px: 'px-5', style: '', required: false },
  {
    key: 'published',
    label: 'Published',
    align: 'text-right',
    px: 'px-5',
    style: '',
    required: false,
  },
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

// ── Expandable list items ──
const expandedItems = ref<Set<string>>(new Set());

function toggleExpandItem(key: string) {
  if (expandedItems.value.has(key)) expandedItems.value.delete(key);
  else expandedItems.value.add(key);
}
</script>

<template>
  <AppLayout>
    <div>
      <!-- Filter bar -->
      <div class="shrink-0 mb-4">
        <div class="px-3 py-2 dd-rounded relative z-[1]"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }">
          <div class="flex items-center gap-2.5">
            <!-- Filter toggle button -->
            <div class="relative">
              <button class="w-7 h-7 dd-rounded flex items-center justify-center text-[11px] transition-colors border"
                      :class="showSecFilters || activeSecFilterCount > 0 ? 'dd-text dd-bg-elevated' : 'dd-text-muted hover:dd-text dd-bg-card'"
                      :style="{ borderColor: activeSecFilterCount > 0 ? 'var(--dd-primary)' : 'var(--dd-border-strong)' }"
                      title="Filters"
                      @click.stop="showSecFilters = !showSecFilters">
                <AppIcon name="filter" :size="11" />
              </button>
              <span v-if="activeSecFilterCount > 0"
                    class="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center text-white"
                    style="background: var(--dd-primary);">
                {{ activeSecFilterCount }}
              </span>
            </div>

            <!-- Result count + view toggle -->
            <div class="flex items-center gap-2 ml-auto">
              <span class="text-[10px] font-semibold tabular-nums shrink-0 px-2 py-1 dd-rounded dd-text-muted dd-bg-card">
                {{ filteredSecurityVulns.length }}/{{ securityVulnerabilities.length }}
              </span>
              <div class="flex items-center dd-rounded overflow-hidden border"
                   :style="{ borderColor: 'var(--dd-border-strong)' }">
                <button v-for="vm in ([
                  { id: 'table' as const, icon: 'table' },
                  { id: 'cards' as const, icon: 'grid' },
                  { id: 'list' as const, icon: 'list' },
                ])" :key="vm.id"
                        class="w-7 h-7 flex items-center justify-center text-[11px] transition-colors"
                        :class="securityViewMode === vm.id ? 'dd-text dd-bg-elevated' : 'dd-text-muted hover:dd-text dd-bg-card'"
                        :style="vm.id !== 'table' ? { borderLeft: '1px solid var(--dd-border-strong)' } : {}"
                        :title="vm.id.charAt(0).toUpperCase() + vm.id.slice(1) + ' view'"
                        @click="securityViewMode = vm.id">
                  <AppIcon :name="vm.icon" :size="11" />
                </button>
              </div>
              <!-- Column picker -->
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
            </div>
          </div>
          <!-- Collapsible filter panel -->
          <div v-if="showSecFilters" @click.stop
               class="flex flex-wrap items-center gap-2 mt-2 pt-2"
               :style="{ borderTop: '1px solid var(--dd-border)' }">
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
          </div>
        </div>
      </div>

      <!-- Table view -->
      <div v-if="securityViewMode === 'table' && filteredSecurityVulns.length > 0"
           class="dd-rounded overflow-hidden"
           :style="{ border: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-card)' }">
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <th v-for="col in secActiveColumns" :key="col.key"
                    :class="[col.align, col.px, 'whitespace-nowrap py-2.5 font-semibold uppercase tracking-wider text-[10px] select-none cursor-pointer transition-colors', securitySortField === col.key ? 'dd-text-secondary' : 'dd-text-muted hover:dd-text-secondary']"
                    :style="col.style"
                    @click="toggleSecuritySort(col.key)">
                  {{ col.label }}
                  <span v-if="securitySortField === col.key" class="inline-block ml-0.5 text-[8px]">{{ securitySortAsc ? '&#9650;' : '&#9660;' }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(vuln, i) in filteredSecurityVulns" :key="vuln.id"
                  class="transition-colors hover:dd-bg-elevated"
                  :style="{
                    backgroundColor: i % 2 === 0 ? 'var(--dd-bg-card)' : 'var(--dd-bg-inset)',
                    borderBottom: i < filteredSecurityVulns.length - 1 ? '1px solid var(--dd-border-strong)' : 'none',
                  }">
                <!-- Severity (always visible, contains compact fold) -->
                <td :class="['px-5 py-3']">
                  <div class="flex items-start gap-2 min-w-0">
                    <span class="badge text-[9px] uppercase font-bold shrink-0"
                          :style="{ backgroundColor: severityColor(vuln.severity).bg, color: severityColor(vuln.severity).text }">
                      {{ vuln.severity }}
                    </span>
                    <!-- Compact mode: folded info -->
                    <div v-if="isCompact" class="min-w-0 flex-1">
                      <div class="font-medium font-mono text-[11px] truncate dd-text">{{ vuln.id }}</div>
                      <div class="text-[10px] mt-0.5 truncate dd-text-muted">{{ vuln.package }} {{ vuln.version }}</div>
                      <div class="flex items-center gap-1.5 mt-1.5">
                        <span v-if="vuln.fixedIn"
                              class="badge px-1.5 py-0 text-[9px]"
                              style="background: var(--dd-success-muted); color: var(--dd-success);">
                          <AppIcon name="config" :size="9" />
                        </span>
                        <span v-else class="badge px-1.5 py-0 text-[9px]"
                              style="background: var(--dd-neutral-muted); color: var(--dd-neutral);">
                          <AppIcon name="xmark" :size="9" />
                        </span>
                        <span class="badge text-[7px] font-bold px-1.5 py-0 dd-bg-elevated dd-text-secondary">
                          {{ vuln.image }}
                        </span>
                        <span class="text-[9px] dd-text-muted ml-auto">{{ vuln.publishedDate }}</span>
                      </div>
                    </div>
                  </div>
                </td>
                <!-- CVE ID -->
                <td v-if="secVisibleColumns.has('cve') && !isCompact" class="px-5 py-3 font-medium font-mono dd-text">
                  {{ vuln.id }}
                </td>
                <!-- Package -->
                <td v-if="secVisibleColumns.has('package') && !isCompact" class="px-5 py-3">
                  <div>
                    <span class="font-medium dd-text">{{ vuln.package }}</span>
                    <span class="ml-1.5 text-[10px] dd-text-muted">{{ vuln.version }}</span>
                  </div>
                </td>
                <!-- Fixed In -->
                <td v-if="secVisibleColumns.has('fixedIn') && !isCompact" class="px-5 py-3 text-center">
                  <span v-if="vuln.fixedIn"
                        class="px-1.5 py-0.5 dd-rounded-sm text-[10px] font-medium"
                        style="background: var(--dd-success-muted); color: var(--dd-success);">
                    {{ vuln.fixedIn }}
                  </span>
                  <span v-else class="text-[10px] dd-text-muted">No fix</span>
                </td>
                <!-- Image -->
                <td v-if="secVisibleColumns.has('image') && !isCompact" class="px-5 py-3 dd-text-secondary">
                  {{ vuln.image }}
                </td>
                <!-- Published -->
                <td v-if="secVisibleColumns.has('published') && !isCompact" class="px-5 py-3 text-right dd-text-muted">
                  {{ vuln.publishedDate }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Card view -->
      <div v-if="securityViewMode === 'cards' && filteredSecurityVulns.length > 0"
           class="grid gap-4"
           style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">
        <div v-for="vuln in filteredSecurityVulns" :key="vuln.id"
             class="dd-rounded overflow-hidden flex flex-col"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
               borderLeftWidth: '4px',
               borderLeftColor: severityColor(vuln.severity).text,
             }">
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
        </div>
      </div>

      <!-- List view -->
      <div v-if="securityViewMode === 'list' && filteredSecurityVulns.length > 0"
           class="space-y-2">
        <div v-for="vuln in filteredSecurityVulns" :key="vuln.id"
             class="dd-rounded overflow-hidden transition-all"
             :style="{
               backgroundColor: 'var(--dd-bg-card)',
               border: '1px solid var(--dd-border-strong)',
             }">
          <!-- List item header -->
          <div class="flex items-center gap-3 px-5 py-3 cursor-pointer transition-colors hover:dd-bg-elevated"
               @click="toggleExpandItem('sec-' + vuln.id)">
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
            <AppIcon :name="expandedItems.has('sec-' + vuln.id) ? 'chevron-up' : 'chevron-down'" :size="10" class="shrink-0 dd-text-muted" />
          </div>
          <!-- Expanded details -->
          <div v-if="expandedItems.has('sec-' + vuln.id)"
               class="px-5 pb-4 pt-1"
               :style="{ borderTop: '1px solid var(--dd-border-strong)' }">
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
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div v-if="filteredSecurityVulns.length === 0"
           class="flex flex-col items-center justify-center py-16 dd-rounded"
           :style="{
             backgroundColor: 'var(--dd-bg-card)',
             border: '1px solid var(--dd-border-strong)',
           }">
        <AppIcon name="security" :size="24" class="mb-3 dd-text-muted" />
        <p class="text-sm font-medium mb-1 dd-text-secondary">
          No vulnerabilities match your filters
        </p>
        <button class="text-xs font-medium mt-2 px-3 py-1.5 dd-rounded transition-colors text-drydock-secondary bg-drydock-secondary/10 hover:bg-drydock-secondary/20"
                @click="clearSecFilters">
          Clear all filters
        </button>
      </div>
    </div>
  </AppLayout>
</template>
