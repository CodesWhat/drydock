<script setup lang="ts">
import { reactive, ref } from 'vue';
import ContainerLogs from './ContainerLogs.vue';
import ContainerStats from './ContainerStats.vue';
import { revealContainerEnv } from '../../services/container';
import { useContainersViewTemplateContext } from './containersViewTemplateContext';

const revealedEnvCache = reactive(new Map<string, Map<string, string>>());
const revealedKeys = reactive(new Set<string>());
const envRevealLoading = ref(false);

function revealCacheKey(containerId: string, key: string) {
  return `${containerId}:${key}`;
}

async function toggleReveal(containerId: string, key: string) {
  const cacheKey = revealCacheKey(containerId, key);

  if (revealedKeys.has(cacheKey)) {
    revealedKeys.delete(cacheKey);
    return;
  }

  const cached = revealedEnvCache.get(containerId);
  if (cached?.has(key)) {
    revealedKeys.add(cacheKey);
    return;
  }

  envRevealLoading.value = true;
  try {
    const result = await revealContainerEnv(containerId);
    const envMap = new Map<string, string>();
    for (const entry of result.env || []) {
      envMap.set(entry.key, entry.value);
    }
    revealedEnvCache.set(containerId, envMap);
    revealedKeys.add(cacheKey);
  } catch {
    // silently fail — user can retry
  } finally {
    envRevealLoading.value = false;
  }
}

function getRevealedValue(containerId: string, key: string): string | undefined {
  const cacheKey = revealCacheKey(containerId, key);
  if (!revealedKeys.has(cacheKey)) return undefined;
  return revealedEnvCache.get(containerId)?.get(key);
}

const {
  selectedContainer,
  activeDetailTab,
  selectedRuntimeOrigins,
  runtimeOriginStyle,
  runtimeOriginLabel,
  selectedRuntimeDriftWarnings,
  selectedComposePaths,
  selectedLifecycleHooks,
  lifecycleHookTemplateVariables,
  selectedAutoRollbackConfig,
  selectedImageMetadata,
  formatTimestamp,
  detailVulnerabilityLoading,
  detailSbomLoading,
  loadDetailSecurityData,
  detailVulnerabilityError,
  vulnerabilitySummary,
  vulnerabilityTotal,
  vulnerabilityPreview,
  severityStyle,
  normalizeSeverity,
  getVulnerabilityPackage,
  selectedSbomFormat,
  loadDetailSbom,
  detailSbomError,
  sbomDocument,
  sbomComponentCount,
  sbomGeneratedAt,
  previewLoading,
  runContainerPreview,
  actionInProgress,
  policyInProgress,
  skipCurrentForSelected,
  snoozeSelected,
  snoozeDateInput,
  snoozeSelectedUntilDate,
  selectedSnoozeUntil,
  unsnoozeSelected,
  selectedSkipTags,
  selectedSkipDigests,
  clearSkipsSelected,
  selectedUpdatePolicy,
  selectedHasMaturityPolicy,
  selectedMaturityMode,
  selectedMaturityMinAgeDays,
  maturityModeInput,
  maturityMinAgeDaysInput,
  setMaturityPolicySelected,
  clearMaturityPolicySelected,
  clearPolicySelected,
  policyMessage,
  policyError,
  removeSkipTagSelected,
  removeSkipDigestSelected,
  detailPreview,
  detailComposePreview,
  previewError,
  triggersLoading,
  detailTriggers,
  getTriggerKey,
  triggerRunInProgress,
  runAssociatedTrigger,
  triggerMessage,
  triggerError,
  backupsLoading,
  detailBackups,
  rollbackInProgress,
  confirmRollback,
  rollbackMessage,
  rollbackError,
  updateOperationsLoading,
  detailUpdateOperations,
  getOperationStatusStyle,
  formatOperationStatus,
  formatOperationPhase,
  formatRollbackReason,
  updateOperationsError,
  scanContainer,
  confirmUpdate,
  confirmForceUpdate,
  registryColorBg,
  registryColorText,
  registryLabel,
  updateKindColor,
} = useContainersViewTemplateContext();
</script>

<template>
      <!-- Full-page tab content -->
      <div class="flex-1 overflow-y-auto min-h-0" data-test="container-full-page-tab-content">

        <!-- Overview tab (full page) -->
        <div v-if="activeDetailTab === 'overview'" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <!-- Ports card -->
          <div class="dd-rounded overflow-hidden"
               :style="{ backgroundColor: 'var(--dd-bg-card)' }">
            <div class="px-4 py-3 flex items-center gap-2">
              <AppIcon name="network" :size="12" class="dd-text-muted" />
              <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Ports</span>
              <span class="badge text-[0.5625rem] ml-auto dd-bg-elevated dd-text-muted">{{ selectedContainer.details.ports.length }}</span>
            </div>
            <div class="p-4">
              <div v-if="selectedContainer.details.ports.length > 0" class="space-y-1.5">
                <div v-for="port in selectedContainer.details.ports" :key="port"
                     class="flex items-center gap-2 px-3 py-2 dd-rounded text-xs font-mono"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <AppIcon name="network" :size="10" class="dd-text-muted" />
                  <span class="dd-text">{{ port }}</span>
                </div>
              </div>
              <p v-else class="text-[0.6875rem] dd-text-muted italic">No ports exposed</p>
            </div>
          </div>

          <!-- Volumes card -->
          <div class="dd-rounded overflow-hidden"
               :style="{ backgroundColor: 'var(--dd-bg-card)' }">
            <div class="px-4 py-3 flex items-center gap-2">
              <AppIcon name="hard-drive" :size="12" class="dd-text-muted" />
              <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Volumes</span>
              <span class="badge text-[0.5625rem] ml-auto dd-bg-elevated dd-text-muted">{{ selectedContainer.details.volumes.length }}</span>
            </div>
            <div class="p-4">
              <div v-if="selectedContainer.details.volumes.length > 0" class="space-y-1.5">
                <div v-for="vol in selectedContainer.details.volumes" :key="vol"
                     class="flex items-center gap-2 px-3 py-2 dd-rounded text-xs font-mono"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <AppIcon name="hard-drive" :size="10" class="dd-text-muted" />
                  <span class="truncate dd-text">{{ vol }}</span>
                </div>
              </div>
              <p v-else class="text-[0.6875rem] dd-text-muted italic">No volumes mounted</p>
            </div>
          </div>

          <!-- Compose files card -->
          <div v-if="selectedComposePaths.length > 0"
               class="dd-rounded overflow-hidden"
               :style="{ backgroundColor: 'var(--dd-bg-card)' }">
            <div class="px-4 py-3 flex items-center gap-2">
              <AppIcon name="stack" :size="12" class="dd-text-muted" />
              <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Compose Files</span>
              <span class="badge text-[0.5625rem] ml-auto dd-bg-elevated dd-text-muted">{{ selectedComposePaths.length }}</span>
            </div>
            <div class="p-4">
              <div class="space-y-1.5">
                <div
                  v-for="(composePath, index) in selectedComposePaths"
                  :key="`${composePath}-${index}`"
                  class="flex items-center gap-2 px-3 py-2 dd-rounded text-xs font-mono"
                  :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
                >
                  <span v-if="selectedComposePaths.length > 1" class="text-[0.5625rem] dd-text-muted">#{{ index + 1 }}</span>
                  <span class="truncate dd-text">{{ composePath }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Version card -->
          <div class="dd-rounded overflow-hidden"
               :style="{ backgroundColor: 'var(--dd-bg-card)' }">
            <div class="px-4 py-3 flex items-center gap-2">
              <AppIcon name="updates" :size="12" class="dd-text-muted" />
              <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Version</span>
            </div>
            <div class="p-4 space-y-3">
              <div class="flex items-center gap-3 px-3 py-2 dd-rounded text-xs font-mono"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <span class="dd-text-secondary">Current:</span>
                <span class="font-bold dd-text">{{ selectedContainer.currentTag }}</span>
              </div>
              <div v-if="selectedContainer.newTag" class="flex items-center gap-3 px-3 py-2 dd-rounded text-xs font-mono"
                   :style="{ backgroundColor: 'var(--dd-success-muted)' }">
                <span style="color: var(--dd-success);">Latest:</span>
                <span class="font-bold" style="color: var(--dd-success);">{{ selectedContainer.newTag }}</span>
                <span class="badge text-[0.5625rem]"
                      :style="{ backgroundColor: updateKindColor(selectedContainer.updateKind).bg, color: updateKindColor(selectedContainer.updateKind).text }">
                  {{ selectedContainer.updateKind }}
                </span>
              </div>
              <div v-else class="flex items-center gap-2 px-3 py-2 dd-rounded text-xs"
                   :style="{ backgroundColor: 'var(--dd-success-muted)' }">
                <AppIcon name="up-to-date" :size="11" style="color: var(--dd-success);" />
                <span class="font-medium" style="color: var(--dd-success);">Up to date</span>
              </div>
              <div
                v-if="!selectedContainer.newTag && selectedContainer.noUpdateReason"
                class="flex items-start gap-2 px-3 py-2 dd-rounded text-xs"
                :style="{ backgroundColor: 'var(--dd-warning-muted)' }"
              >
                <AppIcon name="warning" :size="12" class="shrink-0 mt-0.5" style="color: var(--dd-warning);" />
                <span class="flex-1 min-w-0 whitespace-normal break-words" style="color: var(--dd-warning);">{{ selectedContainer.noUpdateReason }}</span>
              </div>
              <a
                v-if="selectedContainer.releaseLink"
                :href="selectedContainer.releaseLink"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center text-xs underline hover:no-underline"
                style="color: var(--dd-info);"
              >
                Release notes
              </a>
              <div class="pt-1 space-y-1.5">
                <div class="text-[0.625rem] font-semibold uppercase tracking-wider dd-text-muted">Tag Filters</div>
                <div class="flex items-start gap-2 px-3 py-2 dd-rounded text-[0.6875rem]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary shrink-0">Include:</span>
                  <span class="font-mono dd-text break-all">{{ selectedContainer.includeTags || 'Not set' }}</span>
                </div>
                <div class="flex items-start gap-2 px-3 py-2 dd-rounded text-[0.6875rem]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary shrink-0">Exclude:</span>
                  <span class="font-mono dd-text break-all">{{ selectedContainer.excludeTags || 'Not set' }}</span>
                </div>
                <div class="flex items-start gap-2 px-3 py-2 dd-rounded text-[0.6875rem]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary shrink-0">Transform:</span>
                  <span class="font-mono dd-text break-all">{{ selectedContainer.transformTags || 'Not set' }}</span>
                </div>
              </div>
              <div class="pt-1 space-y-1.5">
                <div class="text-[0.625rem] font-semibold uppercase tracking-wider dd-text-muted">Trigger Filters</div>
                <div class="flex items-start gap-2 px-3 py-2 dd-rounded text-[0.6875rem]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary shrink-0">Include:</span>
                  <span class="font-mono dd-text break-all">{{ selectedContainer.triggerInclude || 'Not set' }}</span>
                </div>
                <div class="flex items-start gap-2 px-3 py-2 dd-rounded text-[0.6875rem]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary shrink-0">Exclude:</span>
                  <span class="font-mono dd-text break-all">{{ selectedContainer.triggerExclude || 'Not set' }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Registry card -->
          <div class="dd-rounded overflow-hidden"
               :style="{ backgroundColor: 'var(--dd-bg-card)' }">
            <div class="px-4 py-3 flex items-center gap-2">
              <AppIcon name="registries" :size="12" class="dd-text-muted" />
              <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Registry</span>
            </div>
            <div class="p-4">
              <div class="flex items-center gap-3 px-3 py-2 dd-rounded text-xs"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <span class="badge text-[0.5625rem] uppercase font-bold"
                      :style="{ backgroundColor: registryColorBg(selectedContainer.registry), color: registryColorText(selectedContainer.registry) }">
                  {{ registryLabel(selectedContainer.registry, selectedContainer.registryUrl, selectedContainer.registryName) }}
                </span>
                <span class="font-mono dd-text-secondary">{{ selectedContainer.image }}</span>
              </div>
              <div v-if="selectedContainer.registryError"
                   class="mt-3 flex items-start gap-2 px-3 py-2 dd-rounded text-xs"
                   :style="{ backgroundColor: 'var(--dd-danger-muted)' }">
                <AppIcon name="warning" :size="12" class="shrink-0 mt-0.5" style="color: var(--dd-danger);" />
                <span class="flex-1 min-w-0 whitespace-normal break-words" style="color: var(--dd-danger);">{{ selectedContainer.registryError }}</span>
              </div>
            </div>
          </div>

          <!-- Runtime process card -->
          <div class="dd-rounded overflow-hidden"
               :style="{ backgroundColor: 'var(--dd-bg-card)' }">
            <div class="px-4 py-3 flex items-center gap-2">
              <AppIcon name="terminal" :size="12" class="dd-text-muted" />
              <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Runtime Process</span>
            </div>
            <div class="p-4 space-y-2">
              <div class="flex items-center justify-between gap-3 px-3 py-2 dd-rounded text-xs"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <span class="dd-text-secondary">Entrypoint</span>
                <span class="badge text-[0.625rem] font-bold uppercase"
                      :style="runtimeOriginStyle(selectedRuntimeOrigins.entrypoint)">
                  {{ runtimeOriginLabel(selectedRuntimeOrigins.entrypoint) }}
                </span>
              </div>
              <div class="flex items-center justify-between gap-3 px-3 py-2 dd-rounded text-xs"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <span class="dd-text-secondary">Cmd</span>
                <span class="badge text-[0.625rem] font-bold uppercase"
                      :style="runtimeOriginStyle(selectedRuntimeOrigins.cmd)">
                  {{ runtimeOriginLabel(selectedRuntimeOrigins.cmd) }}
                </span>
              </div>
              <div v-if="selectedRuntimeDriftWarnings.length > 0" class="space-y-1.5">
                <div v-for="warning in selectedRuntimeDriftWarnings" :key="warning"
                     class="flex items-start gap-2 px-3 py-2 dd-rounded text-xs"
                     :style="{ backgroundColor: 'var(--dd-warning-muted)' }">
                  <AppIcon name="warning" :size="12" class="shrink-0 mt-0.5" style="color: var(--dd-warning);" />
                  <span class="flex-1 min-w-0 whitespace-normal break-words" style="color: var(--dd-warning);">{{ warning }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Lifecycle hooks card -->
          <div class="dd-rounded overflow-hidden"
               :style="{ backgroundColor: 'var(--dd-bg-card)' }">
            <div class="px-4 py-3 flex items-center gap-2">
              <AppIcon name="triggers" :size="12" class="dd-text-muted" />
              <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Lifecycle Hooks</span>
            </div>
            <div class="p-4 space-y-2">
              <div class="flex items-start justify-between gap-3 px-3 py-2 dd-rounded text-xs"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <span class="dd-text-secondary shrink-0">Pre-update</span>
                <span class="font-mono dd-text text-right break-all">{{ selectedLifecycleHooks.preUpdate || 'Not configured' }}</span>
              </div>
              <div class="flex items-start justify-between gap-3 px-3 py-2 dd-rounded text-xs"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <span class="dd-text-secondary shrink-0">Post-update</span>
                <span class="font-mono dd-text text-right break-all">{{ selectedLifecycleHooks.postUpdate || 'Not configured' }}</span>
              </div>
              <div class="flex items-center justify-between gap-3 px-3 py-2 dd-rounded text-xs"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <span class="dd-text-secondary">Timeout</span>
                <span class="font-mono dd-text">{{ selectedLifecycleHooks.timeoutLabel }}</span>
              </div>
              <div v-if="selectedLifecycleHooks.preAbortBehavior"
                   class="px-3 py-2 dd-rounded text-xs"
                   :style="{ backgroundColor: 'var(--dd-info-muted)' }">
                <span style="color: var(--dd-info);">{{ selectedLifecycleHooks.preAbortBehavior }}</span>
              </div>
              <div class="px-3 py-2 dd-rounded text-xs"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <div class="dd-text-secondary mb-1">Template Variables</div>
                <div class="space-y-1">
                  <div v-for="variable in lifecycleHookTemplateVariables" :key="variable.name"
                       class="flex items-start justify-between gap-3">
                    <span class="font-mono dd-text">{{ variable.name }}</span>
                    <span class="dd-text-muted text-right">{{ variable.description }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Auto-rollback card -->
          <div class="dd-rounded overflow-hidden"
               :style="{ backgroundColor: 'var(--dd-bg-card)' }">
            <div class="px-4 py-3 flex items-center gap-2">
              <AppIcon name="recent-updates" :size="12" class="dd-text-muted" />
              <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Auto-Rollback</span>
            </div>
            <div class="p-4 space-y-2">
              <div class="flex items-center justify-between gap-3 px-3 py-2 dd-rounded text-xs"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <span class="dd-text-secondary">Status</span>
                <span class="font-mono dd-text">{{ selectedAutoRollbackConfig.enabledLabel }}</span>
              </div>
              <div class="flex items-center justify-between gap-3 px-3 py-2 dd-rounded text-xs"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <span class="dd-text-secondary">Window</span>
                <span class="font-mono dd-text">{{ selectedAutoRollbackConfig.windowLabel }}</span>
              </div>
              <div class="flex items-center justify-between gap-3 px-3 py-2 dd-rounded text-xs"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <span class="dd-text-secondary">Interval</span>
                <span class="font-mono dd-text">{{ selectedAutoRollbackConfig.intervalLabel }}</span>
              </div>
            </div>
          </div>

          <!-- Security card -->
          <div class="dd-rounded overflow-hidden"
               :style="{ backgroundColor: 'var(--dd-bg-card)' }">
            <div class="px-4 py-3 flex items-center gap-2">
              <AppIcon name="security" :size="12" class="dd-text-muted" />
              <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Security</span>
              <button class="ml-auto px-2 py-1 dd-rounded text-[0.625rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"

                      :disabled="detailVulnerabilityLoading || detailSbomLoading"
                      @click="loadDetailSecurityData">
                {{ detailVulnerabilityLoading || detailSbomLoading ? 'Refreshing...' : 'Refresh' }}
              </button>
            </div>
            <div class="p-4 space-y-3">
              <div v-if="detailVulnerabilityLoading"
                   class="px-3 py-2 dd-rounded text-xs dd-text-muted"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                Loading vulnerability data...
              </div>
              <div v-else-if="detailVulnerabilityError"
                   class="px-3 py-2 dd-rounded text-xs"
                   :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
                {{ detailVulnerabilityError }}
              </div>
              <template v-else>
                <div class="flex items-center gap-2 flex-wrap text-[0.6875rem]">
                  <span class="badge text-[0.625rem] font-bold"
                        :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
                    critical {{ vulnerabilitySummary.critical }}
                  </span>
                  <span class="badge text-[0.625rem] font-bold"
                        :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
                    high {{ vulnerabilitySummary.high }}
                  </span>
                  <span class="badge text-[0.625rem] font-bold"
                        :style="{ backgroundColor: 'var(--dd-caution-muted)', color: 'var(--dd-caution)' }">
                    medium {{ vulnerabilitySummary.medium }}
                  </span>
                  <span class="badge text-[0.625rem] font-bold"
                        :style="{ backgroundColor: 'var(--dd-info-muted)', color: 'var(--dd-info)' }">
                    low {{ vulnerabilitySummary.low }}
                  </span>
                  <span class="dd-text-muted ml-auto">{{ vulnerabilityTotal }} total</span>
                </div>
                <div v-if="vulnerabilityPreview.length > 0" class="space-y-1.5">
                  <div v-for="vulnerability in vulnerabilityPreview" :key="vulnerability.id"
                       class="flex items-center gap-2 px-3 py-2 dd-rounded text-[0.6875rem]"
                       :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                    <span class="badge text-[0.5625rem] font-bold uppercase"
                          :style="{
                            backgroundColor: severityStyle(normalizeSeverity(vulnerability.severity)).bg,
                            color: severityStyle(normalizeSeverity(vulnerability.severity)).text,
                          }">
                      {{ normalizeSeverity(vulnerability.severity) }}
                    </span>
                    <span class="font-mono dd-text truncate">{{ vulnerability.id }}</span>
                    <span class="dd-text-muted truncate ml-auto">{{ getVulnerabilityPackage(vulnerability) }}</span>
                  </div>
                </div>
                <p v-else class="text-xs dd-text-muted italic">No vulnerabilities reported for this container.</p>
              </template>

              <div class="pt-1 space-y-1.5"
                   :style="{ borderTop: '1px solid var(--dd-border)' }">
                <div class="flex items-center gap-2">
                  <select v-model="selectedSbomFormat"
                          class="px-2 py-1 dd-rounded text-[0.625rem] font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
                    <option value="spdx-json">spdx-json</option>
                    <option value="cyclonedx-json">cyclonedx-json</option>
                  </select>
                  <button class="px-2 py-1 dd-rounded text-[0.625rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
    
                          :disabled="detailSbomLoading"
                          @click="loadDetailSbom">
                    {{ detailSbomLoading ? 'Loading SBOM...' : 'Refresh SBOM' }}
                  </button>
                </div>
                <div v-if="detailSbomError"
                     class="px-3 py-2 dd-rounded text-xs"
                     :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
                  {{ detailSbomError }}
                </div>
                <div v-else-if="detailSbomLoading"
                     class="px-3 py-2 dd-rounded text-xs dd-text-muted"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  Loading SBOM document...
                </div>
                <div v-else-if="sbomDocument"
                     class="px-3 py-2 dd-rounded text-[0.6875rem] space-y-1"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <div class="dd-text-muted">
                    format:
                    <span class="dd-text font-mono">{{ selectedSbomFormat }}</span>
                  </div>
                  <div v-if="typeof sbomComponentCount === 'number'" class="dd-text-muted">
                    components:
                    <span class="dd-text">{{ sbomComponentCount }}</span>
                  </div>
                  <div v-if="sbomGeneratedAt" class="dd-text-muted">
                    generated:
                    <span class="dd-text">{{ formatTimestamp(sbomGeneratedAt) }}</span>
                  </div>
                </div>
                <p v-else class="text-xs dd-text-muted italic">SBOM document is not available yet.</p>
              </div>
            </div>
          </div>
        </div>

        <div v-if="activeDetailTab === 'stats'">
          <ContainerStats :container-id="selectedContainer.id" />
        </div>

        <!-- Logs tab (full page) -->
        <div v-if="activeDetailTab === 'logs'">
          <ContainerLogs
            :container-id="selectedContainer.id"
            :container-name="selectedContainer.name"
          />
        </div>

        <!-- Environment tab (full page) -->
        <div v-if="activeDetailTab === 'environment'" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div class="dd-rounded overflow-hidden"
               :style="{ backgroundColor: 'var(--dd-bg-card)' }">
            <div class="px-4 py-3 flex items-center gap-2">
              <AppIcon name="config" :size="12" class="dd-text-muted" />
              <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Environment Variables</span>
              <span class="badge text-[0.5625rem] ml-auto dd-bg-elevated dd-text-muted">{{ selectedContainer.details.env.length }}</span>
            </div>
            <div class="p-4">
              <div v-if="selectedContainer.details.env.length > 0" class="space-y-1.5">
                <div v-for="e in selectedContainer.details.env" :key="e.key"
                     class="flex items-center gap-2 px-3 py-2 dd-rounded text-xs font-mono"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="font-semibold shrink-0 text-drydock-secondary">{{ e.key }}</span>
                  <span class="dd-text-muted">=</span>
                  <span v-if="!e.sensitive" class="truncate dd-text">{{ e.value }}</span>
                  <template v-else>
                    <span v-if="getRevealedValue(selectedContainer.id, e.key)" class="truncate dd-text">{{ getRevealedValue(selectedContainer.id, e.key) }}</span>
                    <span v-else class="truncate dd-text-muted">&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;</span>
                    <button class="shrink-0 p-0.5 dd-text-muted hover:dd-text transition-colors"
                            :disabled="envRevealLoading"
                            @click="toggleReveal(selectedContainer.id, e.key)">
                      <AppIcon :name="getRevealedValue(selectedContainer.id, e.key) ? 'eye-slash' : 'eye'" :size="11" />
                    </button>
                  </template>
                </div>
              </div>
              <p v-else class="text-xs dd-text-muted italic">No environment variables configured</p>
            </div>
          </div>
          <div class="dd-rounded overflow-hidden"
               :style="{ backgroundColor: 'var(--dd-bg-card)' }">
            <div class="px-4 py-3 flex items-center gap-2">
              <AppIcon name="hard-drive" :size="12" class="dd-text-muted" />
              <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Volumes</span>
              <span class="badge text-[0.5625rem] ml-auto dd-bg-elevated dd-text-muted">{{ selectedContainer.details.volumes.length }}</span>
            </div>
            <div class="p-4">
              <div v-if="selectedContainer.details.volumes.length > 0" class="space-y-1.5">
                <div v-for="vol in selectedContainer.details.volumes" :key="vol"
                     class="flex items-center gap-2 px-3 py-2 dd-rounded text-xs font-mono"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <AppIcon name="hard-drive" :size="10" class="dd-text-muted" />
                  <span class="truncate dd-text">{{ vol }}</span>
                </div>
              </div>
              <p v-else class="text-xs dd-text-muted italic">No volumes mounted</p>
            </div>
          </div>
        </div>

        <!-- Labels tab (full page) -->
        <div v-if="activeDetailTab === 'labels'">
          <div class="dd-rounded overflow-hidden"
               :style="{ backgroundColor: 'var(--dd-bg-card)' }">
            <div class="px-4 py-3 flex items-center gap-2">
              <AppIcon name="containers" :size="12" class="dd-text-muted" />
              <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Labels</span>
              <span class="badge text-[0.5625rem] ml-auto dd-bg-elevated dd-text-muted">{{ selectedContainer.details.labels.length }}</span>
            </div>
            <div class="p-4">
              <div v-if="selectedContainer.details.labels.length > 0" class="flex flex-wrap gap-2">
                <span v-for="label in selectedContainer.details.labels" :key="label"
                      class="badge text-[0.6875rem] font-semibold px-3 py-1.5"
                      :style="{
                        backgroundColor: 'var(--dd-neutral-muted)',
                        color: 'var(--dd-text-secondary)',
                      }">
                  {{ label }}
                </span>
              </div>
              <p v-else class="text-xs dd-text-muted italic">No labels assigned</p>
            </div>
          </div>
        </div>

        <!-- Actions tab (full page) -->
        <div v-if="activeDetailTab === 'actions'" class="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div class="space-y-4">
            <div class="dd-rounded overflow-hidden"
                 :style="{ backgroundColor: 'var(--dd-bg-card)' }">
              <div class="px-4 py-3 flex items-center gap-2">
                <AppIcon name="updates" :size="12" class="dd-text-muted" />
                <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Update Workflow</span>
              </div>
              <div class="p-4 space-y-4">
                <!-- Actions group -->
                <div>
                  <div class="text-[0.5625rem] uppercase tracking-wider mb-1.5 dd-text-muted">Actions</div>
                  <div class="flex flex-wrap gap-2">
                    <button class="px-3 py-1.5 dd-rounded text-[0.6875rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
      
                            :disabled="previewLoading"
                            @click="runContainerPreview">
                      {{ previewLoading ? 'Previewing...' : 'Preview Update' }}
                    </button>
                    <button v-if="selectedContainer.bouncer === 'blocked'"
                            class="px-3 py-1.5 dd-rounded text-[0.6875rem] font-semibold transition-colors"
                            :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)', border: '1px solid var(--dd-danger)' }"
                            :disabled="actionInProgress === selectedContainer.name"
                            @click="confirmForceUpdate(selectedContainer.name)">
                      <AppIcon name="lock" :size="10" class="mr-1 inline" />Force Update
                    </button>
                    <button v-else
                            class="px-3 py-1.5 dd-rounded text-[0.6875rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
      
                            :disabled="!selectedContainer.newTag || actionInProgress === selectedContainer.name"
                            @click="confirmUpdate(selectedContainer.name)">
                      Update Now
                    </button>
                    <button class="px-3 py-1.5 dd-rounded text-[0.6875rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
      
                            :disabled="actionInProgress === selectedContainer.name"
                            @click="scanContainer(selectedContainer.name)">
                      Scan Now
                    </button>
                  </div>
                </div>
                <!-- Skip & Snooze group -->
                <div>
                  <div class="text-[0.5625rem] uppercase tracking-wider mb-1.5 dd-text-muted">Skip & Snooze</div>
                  <div class="flex flex-wrap gap-2">
                    <button class="px-3 py-1.5 dd-rounded text-[0.6875rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
      
                            :disabled="!selectedContainer.newTag || policyInProgress !== null"
                            @click="skipCurrentForSelected">
                      Skip This Update
                    </button>
                    <button class="px-3 py-1.5 dd-rounded text-[0.6875rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
      
                            :disabled="policyInProgress !== null"
                            @click="snoozeSelected(1)">
                      Snooze 1d
                    </button>
                    <button class="px-3 py-1.5 dd-rounded text-[0.6875rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
      
                            :disabled="policyInProgress !== null"
                            @click="snoozeSelected(7)">
                      Snooze 7d
                    </button>
                    <input
                      v-model="snoozeDateInput"
                      type="date"
                      class="px-2.5 py-1.5 dd-rounded text-[0.6875rem] outline-none dd-bg dd-text"
                      :disabled="policyInProgress !== null" />
                    <button class="px-3 py-1.5 dd-rounded text-[0.6875rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
      
                            :disabled="!snoozeDateInput || policyInProgress !== null"
                            @click="snoozeSelectedUntilDate">
                      Snooze Until
                    </button>
                    <button class="px-3 py-1.5 dd-rounded text-[0.6875rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
      
                            :disabled="!selectedSnoozeUntil || policyInProgress !== null"
                            @click="unsnoozeSelected">
                      Unsnooze
                    </button>
                  </div>
                </div>
                <!-- Maturity group -->
                <div>
                  <div class="text-[0.5625rem] uppercase tracking-wider mb-1.5 dd-text-muted">Maturity</div>
                  <div class="flex flex-wrap gap-2 items-center">
                    <select
                      v-model="maturityModeInput"
                      class="px-2.5 py-1.5 dd-rounded text-[0.6875rem] outline-none dd-bg dd-text"
                      :disabled="policyInProgress !== null"
                    >
                      <option value="all">Allow New + Mature</option>
                      <option value="mature">Mature Only</option>
                    </select>
                    <input
                      v-model.number="maturityMinAgeDaysInput"
                      type="number"
                      min="1"
                      max="365"
                      class="w-[104px] px-2.5 py-1.5 dd-rounded text-[0.6875rem] outline-none dd-bg dd-text"
                      :disabled="policyInProgress !== null"
                    />
                    <button class="px-3 py-1.5 dd-rounded text-[0.6875rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                            :disabled="policyInProgress !== null"
                            @click="setMaturityPolicySelected(maturityModeInput)">
                      Apply Maturity
                    </button>
                    <button class="px-3 py-1.5 dd-rounded text-[0.6875rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                            :disabled="!selectedHasMaturityPolicy || policyInProgress !== null"
                            @click="clearMaturityPolicySelected">
                      Clear Maturity
                    </button>
                  </div>
                </div>
                <!-- Reset group -->
                <div>
                  <div class="text-[0.5625rem] uppercase tracking-wider mb-1.5 dd-text-muted">Reset</div>
                  <div class="flex flex-wrap gap-2">
                    <button class="px-3 py-1.5 dd-rounded text-[0.6875rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
      
                            :disabled="selectedSkipTags.length === 0 && selectedSkipDigests.length === 0"
                            @click="clearSkipsSelected">
                      Clear Skips
                    </button>
                    <button class="px-3 py-1.5 dd-rounded text-[0.6875rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
      
                            :disabled="Object.keys(selectedUpdatePolicy).length === 0"
                            @click="clearPolicySelected">
                      Clear Policy
                    </button>
                  </div>
                </div>
                <div class="space-y-1 text-[0.6875rem] dd-text-muted">
                  <div v-if="selectedSnoozeUntil">
                    Snoozed until:
                    <span class="dd-text">{{ formatTimestamp(selectedSnoozeUntil) }}</span>
                  </div>
                  <div v-if="selectedHasMaturityPolicy">
                    Maturity mode:
                    <span class="dd-text">
                      {{ selectedMaturityMode === 'mature' ? `Mature only (${selectedMaturityMinAgeDays}d minimum)` : 'Allow all updates' }}
                    </span>
                  </div>
                  <div v-if="selectedSkipTags.length > 0">
                    Skipped tags:
                    <div class="mt-1 flex flex-wrap gap-1.5">
                      <span v-for="tag in selectedSkipTags" :key="`skip-tag-full-${tag}`"
                            class="inline-flex items-center gap-1.5 px-2 py-1 dd-rounded text-[0.6875rem] font-mono"
                            :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                        <span class="dd-text">{{ tag }}</span>
                        <button class="inline-flex items-center justify-center w-4 h-4 dd-rounded-sm transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                                :disabled="policyInProgress !== null"
                                @click="removeSkipTagSelected(tag)">
                          <AppIcon name="xmark" :size="9" />
                        </button>
                      </span>
                    </div>
                  </div>
                  <div v-if="selectedSkipDigests.length > 0">
                    Skipped digests:
                    <div class="mt-1 flex flex-wrap gap-1.5">
                      <span v-for="digest in selectedSkipDigests" :key="`skip-digest-full-${digest}`"
                            class="inline-flex items-center gap-1.5 px-2 py-1 dd-rounded text-[0.6875rem] font-mono"
                            :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                        <span class="dd-text">{{ digest }}</span>
                        <button class="inline-flex items-center justify-center w-4 h-4 dd-rounded-sm transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                                :disabled="policyInProgress !== null"
                                @click="removeSkipDigestSelected(digest)">
                          <AppIcon name="xmark" :size="9" />
                        </button>
                      </span>
                    </div>
                  </div>
                  <div v-if="!selectedSnoozeUntil && selectedSkipTags.length === 0 && selectedSkipDigests.length === 0 && !selectedHasMaturityPolicy"
                       class="italic">
                    No active update policy.
                  </div>
                </div>
                <p v-if="policyMessage" class="text-[0.6875rem]" style="color: var(--dd-success);">{{ policyMessage }}</p>
                <p v-if="policyError" class="text-[0.6875rem]" style="color: var(--dd-danger);">{{ policyError }}</p>
              </div>
            </div>

            <div class="dd-rounded overflow-hidden"
                 :style="{ backgroundColor: 'var(--dd-bg-card)' }">
              <div class="px-4 py-3 flex items-center gap-2">
                <AppIcon name="info" :size="12" class="dd-text-muted" />
                <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Preview</span>
              </div>
              <div class="p-4 space-y-2 text-xs">
                <div v-if="previewLoading" class="dd-text-muted">Generating preview...</div>
                <div v-else-if="detailPreview" class="space-y-1">
                  <div v-if="detailPreview.error" style="color: var(--dd-danger);">{{ detailPreview.error }}</div>
                  <template v-else>
                    <div class="dd-text-muted">Current: <span class="dd-text font-mono">{{ detailPreview.currentImage || '-' }}</span></div>
                    <div class="dd-text-muted">New: <span class="dd-text font-mono">{{ detailPreview.newImage || '-' }}</span></div>
                    <div class="dd-text-muted">Update kind:
                      <span class="dd-text font-mono">{{ detailPreview.updateKind?.kind || detailPreview.updateKind || 'unknown' }}</span>
                    </div>
                    <div class="dd-text-muted">Running:
                      <span class="dd-text">{{ detailPreview.isRunning ? 'yes' : 'no' }}</span>
                    </div>
                    <div v-if="Array.isArray(detailPreview.networks)" class="dd-text-muted">
                      Networks: <span class="dd-text font-mono">{{ detailPreview.networks.join(', ') || '-' }}</span>
                    </div>
                    <div v-if="detailComposePreview?.files.length" class="dd-text-muted">
                      Compose file<span v-if="detailComposePreview.files.length > 1">s</span>:
                      <span class="dd-text font-mono">{{ detailComposePreview.files.join(', ') }}</span>
                    </div>
                    <div v-if="detailComposePreview?.service" class="dd-text-muted">
                      Compose service:
                      <span class="dd-text font-mono">{{ detailComposePreview.service }}</span>
                    </div>
                    <div v-if="detailComposePreview?.writableFile" class="dd-text-muted">
                      Writable file:
                      <span class="dd-text font-mono">{{ detailComposePreview.writableFile }}</span>
                    </div>
                    <div v-if="typeof detailComposePreview?.willWrite === 'boolean'" class="dd-text-muted">
                      Writes compose file:
                      <span class="dd-text">{{ detailComposePreview.willWrite ? 'yes' : 'no' }}</span>
                    </div>
                    <div v-if="detailComposePreview?.patch" class="dd-text-muted">
                      Patch preview:
                      <pre class="mt-1 p-2 dd-rounded whitespace-pre-wrap break-all text-[0.6875rem] dd-text font-mono"
                           :style="{ backgroundColor: 'var(--dd-bg-inset)' }">{{ detailComposePreview.patch }}</pre>
                    </div>
                  </template>
                </div>
                <div v-else class="dd-text-muted italic">
                  Run a preview to inspect the planned update operations.
                </div>
                <p v-if="previewError" class="text-[0.6875rem]" style="color: var(--dd-danger);">{{ previewError }}</p>
              </div>
            </div>
          </div>

          <div class="space-y-4">
            <div class="dd-rounded overflow-hidden"
                 :style="{ backgroundColor: 'var(--dd-bg-card)' }">
              <div class="px-4 py-3 flex items-center gap-2">
                <AppIcon name="triggers" :size="12" class="dd-text-muted" />
                <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Associated Triggers</span>
              </div>
              <div class="p-4 space-y-2">
                <div v-if="triggersLoading" class="text-xs dd-text-muted">Loading triggers...</div>
                <div v-else-if="detailTriggers.length > 0" class="space-y-2">
                  <div v-for="trigger in detailTriggers" :key="getTriggerKey(trigger)"
                       class="flex items-center justify-between gap-3 px-3 py-2 dd-rounded"
                       :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                    <div class="min-w-0">
                      <div class="text-xs font-semibold dd-text truncate">{{ trigger.type }}.{{ trigger.name }}</div>
                      <div v-if="trigger.agent" class="text-[0.6875rem] dd-text-muted">agent: {{ trigger.agent }}</div>
                    </div>
                    <button class="px-2.5 py-1.5 dd-rounded text-[0.6875rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
      
                            :disabled="triggerRunInProgress !== null"
                            @click="runAssociatedTrigger(trigger)">
                      {{ triggerRunInProgress === getTriggerKey(trigger) ? 'Running...' : 'Run' }}
                    </button>
                  </div>
                </div>
                <p v-else class="text-xs dd-text-muted italic">No triggers associated with this container</p>
                <p v-if="triggerMessage" class="text-[0.6875rem]" style="color: var(--dd-success);">{{ triggerMessage }}</p>
                <p v-if="triggerError" class="text-[0.6875rem]" style="color: var(--dd-danger);">{{ triggerError }}</p>
              </div>
            </div>

            <div class="dd-rounded overflow-hidden"
                 :style="{ backgroundColor: 'var(--dd-bg-card)' }">
              <div class="px-4 py-3 flex items-center gap-2">
                <AppIcon name="recent-updates" :size="12" class="dd-text-muted" />
                <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Backups &amp; Rollback</span>
              </div>
              <div class="p-4 space-y-2">
                <div>
                  <button class="px-2.5 py-1.5 dd-rounded text-[0.6875rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
    
                          :disabled="backupsLoading || detailBackups.length === 0 || rollbackInProgress !== null"
                          @click="confirmRollback()">
                    {{ rollbackInProgress === 'latest' ? 'Rolling back...' : 'Rollback Latest' }}
                  </button>
                </div>
                <div v-if="backupsLoading" class="text-xs dd-text-muted">Loading backups...</div>
                <div v-else-if="detailBackups.length > 0" class="space-y-2">
                  <div v-for="backup in detailBackups" :key="backup.id"
                       class="flex items-center justify-between gap-3 px-3 py-2 dd-rounded"
                       :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                    <div class="min-w-0">
                      <div class="text-xs font-semibold dd-text font-mono truncate">{{ backup.imageName }}:{{ backup.imageTag }}</div>
                      <div class="text-[0.6875rem] dd-text-muted">{{ formatTimestamp(backup.timestamp) }}</div>
                    </div>
                    <button class="px-2.5 py-1.5 dd-rounded text-[0.6875rem] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
      
                            :disabled="rollbackInProgress !== null"
                            @click="confirmRollback(backup.id)">
                      {{ rollbackInProgress === backup.id ? 'Rolling...' : 'Use' }}
                    </button>
                  </div>
                </div>
                <p v-else class="text-xs dd-text-muted italic">No backups available yet</p>
                <p v-if="rollbackMessage" class="text-[0.6875rem]" style="color: var(--dd-success);">{{ rollbackMessage }}</p>
                <p v-if="rollbackError" class="text-[0.6875rem]" style="color: var(--dd-danger);">{{ rollbackError }}</p>
              </div>
            </div>

            <div class="dd-rounded overflow-hidden"
                 :style="{ backgroundColor: 'var(--dd-bg-card)' }">
              <div class="px-4 py-3 flex items-center gap-2">
                <AppIcon name="audit" :size="12" class="dd-text-muted" />
                <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Update Operation History</span>
              </div>
              <div class="p-4 space-y-2">
                <div v-if="updateOperationsLoading" class="text-xs dd-text-muted">Loading operation history...</div>
                <div v-else-if="detailUpdateOperations.length > 0" class="space-y-2">
                  <div v-for="operation in detailUpdateOperations" :key="`full-${operation.id}`"
                       class="space-y-1.5 px-3 py-2 dd-rounded"
                       :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                    <div class="flex items-center justify-between gap-3">
                      <div class="text-[0.6875rem] font-mono dd-text-muted truncate">{{ operation.id }}</div>
                      <span class="badge text-[0.625rem] font-semibold uppercase"
                            :style="getOperationStatusStyle(operation.status)">
                        {{ formatOperationStatus(operation.status) }}
                      </span>
                    </div>
                    <div class="text-xs dd-text-muted">Phase:
                      <span class="dd-text font-mono">{{ formatOperationPhase(operation.phase) }}</span>
                    </div>
                    <div v-if="operation.fromVersion || operation.toVersion" class="text-xs dd-text-muted">
                      Version:
                      <span class="dd-text font-mono">{{ operation.fromVersion || '?' }}</span>
                      <span class="dd-text-muted"> → </span>
                      <span class="dd-text font-mono">{{ operation.toVersion || '?' }}</span>
                    </div>
                    <div v-if="operation.rollbackReason" class="text-xs dd-text-muted">
                      Rollback reason:
                      <span class="dd-text font-mono">{{ formatRollbackReason(operation.rollbackReason) }}</span>
                    </div>
                    <div v-if="operation.lastError" class="text-xs dd-text-muted">
                      Last error:
                      <span class="dd-text">{{ operation.lastError }}</span>
                    </div>
                    <div class="text-[0.6875rem] dd-text-muted">
                      {{ formatTimestamp(operation.updatedAt || operation.createdAt) }}
                    </div>
                  </div>
                </div>
                <p v-else class="text-xs dd-text-muted italic">No update operations recorded yet</p>
                <p v-if="updateOperationsError" class="text-[0.6875rem]" style="color: var(--dd-danger);">{{ updateOperationsError }}</p>
              </div>
            </div>
          </div>
        </div>

      </div>
</template>
