<script setup lang="ts">
import { reactive, ref } from 'vue';
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
  LOG_AUTO_FETCH_INTERVALS,
  containerAutoFetchInterval,
  getContainerLogs,
  containerLogRef,
  containerHandleLogScroll,
  containerScrollBlocked,
  containerResumeAutoScroll,
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
  clearPolicySelected,
  policyMessage,
  policyError,
  removeSkipTagSelected,
  removeSkipDigestSelected,
  detailPreview,
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
  rollbackToBackup,
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
  updateContainer,
  registryColorBg,
  registryColorText,
  registryLabel,
} = useContainersViewTemplateContext();
</script>

<template>
        <!-- Tab content -->
        <div class="p-4" data-test="container-side-tab-content">

          <!-- Overview tab -->
          <div v-if="activeDetailTab === 'overview'" class="space-y-5">
            <!-- Ports -->
            <div v-if="selectedContainer.details.ports.length > 0">
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Ports</div>
              <div class="space-y-1">
                <div v-for="port in selectedContainer.details.ports" :key="port"
                     class="flex items-center gap-2 px-2.5 py-1.5 dd-rounded text-[11px] font-mono"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <AppIcon name="network" :size="11" class="dd-text-muted" />
                  <span class="dd-text">{{ port }}</span>
                </div>
              </div>
            </div>

            <!-- Volumes -->
            <div v-if="selectedContainer.details.volumes.length > 0">
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Volumes</div>
              <div class="space-y-1">
                <div v-for="vol in selectedContainer.details.volumes" :key="vol"
                     class="flex items-center gap-2 px-2.5 py-1.5 dd-rounded text-[11px] font-mono"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <AppIcon name="hard-drive" :size="11" class="dd-text-muted" />
                  <span class="truncate dd-text">{{ vol }}</span>
                </div>
              </div>
            </div>

            <!-- Version info -->
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Version</div>
              <div class="flex items-center gap-2 px-2.5 py-1.5 dd-rounded text-[11px] font-mono"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <span class="dd-text-secondary">Current:</span>
                <span class="font-bold dd-text">{{ selectedContainer.currentTag }}</span>
                <template v-if="selectedContainer.newTag">
                  <AppIcon name="arrow-right" :size="8" class="dd-text-muted" />
                  <span class="font-bold" style="color: var(--dd-success);">{{ selectedContainer.newTag }}</span>
                </template>
              </div>
              <div
                v-if="!selectedContainer.newTag && selectedContainer.noUpdateReason"
                class="mt-2 flex items-start gap-2 px-2.5 py-1.5 dd-rounded text-[11px]"
                :style="{ backgroundColor: 'var(--dd-warning-muted)' }"
              >
                <AppIcon name="warning" :size="11" class="shrink-0 mt-0.5" style="color: var(--dd-warning);" />
                <span class="flex-1 min-w-0 whitespace-normal break-words" style="color: var(--dd-warning);">{{ selectedContainer.noUpdateReason }}</span>
              </div>
              <a
                v-if="selectedContainer.releaseLink"
                :href="selectedContainer.releaseLink"
                target="_blank"
                rel="noopener noreferrer"
                class="mt-2 inline-flex items-center text-[11px] underline hover:no-underline"
                style="color: var(--dd-info);"
              >
                Release notes
              </a>
            </div>

            <!-- Tag filter regex -->
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Tag Filters</div>
              <div class="space-y-1">
                <div class="flex items-center gap-2 px-2.5 py-1.5 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary shrink-0">Include:</span>
                  <span class="font-mono dd-text break-all">{{ selectedContainer.includeTags || 'Not set' }}</span>
                </div>
                <div class="flex items-center gap-2 px-2.5 py-1.5 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary shrink-0">Exclude:</span>
                  <span class="font-mono dd-text break-all">{{ selectedContainer.excludeTags || 'Not set' }}</span>
                </div>
                <div class="flex items-center gap-2 px-2.5 py-1.5 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary shrink-0">Transform:</span>
                  <span class="font-mono dd-text break-all">{{ selectedContainer.transformTags || 'Not set' }}</span>
                </div>
              </div>
            </div>

            <!-- Trigger filter include/exclude -->
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Trigger Filters</div>
              <div class="space-y-1">
                <div class="flex items-center gap-2 px-2.5 py-1.5 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary shrink-0">Include:</span>
                  <span class="font-mono dd-text break-all">{{ selectedContainer.triggerInclude || 'Not set' }}</span>
                </div>
                <div class="flex items-center gap-2 px-2.5 py-1.5 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary shrink-0">Exclude:</span>
                  <span class="font-mono dd-text break-all">{{ selectedContainer.triggerExclude || 'Not set' }}</span>
                </div>
              </div>
            </div>

            <!-- Registry -->
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Registry</div>
              <div class="flex items-center gap-2 px-2.5 py-1.5 dd-rounded text-[11px]"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                <span class="badge text-[9px] uppercase font-bold"
                      :style="{ backgroundColor: registryColorBg(selectedContainer.registry), color: registryColorText(selectedContainer.registry) }">
                  {{ registryLabel(selectedContainer.registry, selectedContainer.registryUrl, selectedContainer.registryName) }}
                </span>
                <span class="font-mono dd-text-secondary">{{ selectedContainer.image }}</span>
              </div>
              <div v-if="selectedContainer.registryError"
                   class="mt-2 flex items-start gap-2 px-2.5 py-1.5 dd-rounded text-[11px]"
                   :style="{ backgroundColor: 'var(--dd-danger-muted)' }">
                <AppIcon name="warning" :size="11" class="shrink-0 mt-0.5" style="color: var(--dd-danger);" />
                <span class="flex-1 min-w-0 whitespace-normal break-words" style="color: var(--dd-danger);">{{ selectedContainer.registryError }}</span>
              </div>
            </div>

            <!-- Runtime process -->
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Runtime Process</div>
              <div class="space-y-1">
                <div class="flex items-center justify-between gap-3 px-2.5 py-1.5 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary">Entrypoint</span>
                  <span class="badge text-[9px] font-bold uppercase"
                        :style="runtimeOriginStyle(selectedRuntimeOrigins.entrypoint)">
                    {{ runtimeOriginLabel(selectedRuntimeOrigins.entrypoint) }}
                  </span>
                </div>
                <div class="flex items-center justify-between gap-3 px-2.5 py-1.5 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary">Cmd</span>
                  <span class="badge text-[9px] font-bold uppercase"
                        :style="runtimeOriginStyle(selectedRuntimeOrigins.cmd)">
                    {{ runtimeOriginLabel(selectedRuntimeOrigins.cmd) }}
                  </span>
                </div>
              </div>
              <div v-if="selectedRuntimeDriftWarnings.length > 0" class="mt-2 space-y-1">
                <div v-for="warning in selectedRuntimeDriftWarnings" :key="warning"
                     class="flex items-start gap-2 px-2.5 py-1.5 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-warning-muted)' }">
                  <AppIcon name="warning" :size="11" class="shrink-0 mt-0.5" style="color: var(--dd-warning);" />
                  <span class="flex-1 min-w-0 whitespace-normal break-words" style="color: var(--dd-warning);">{{ warning }}</span>
                </div>
              </div>
            </div>

            <!-- Lifecycle hooks -->
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Lifecycle Hooks</div>
              <div class="space-y-1">
                <div class="flex items-start justify-between gap-3 px-2.5 py-1.5 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary shrink-0">Pre-update</span>
                  <span class="font-mono dd-text text-right break-all">{{ selectedLifecycleHooks.preUpdate || 'Not configured' }}</span>
                </div>
                <div class="flex items-start justify-between gap-3 px-2.5 py-1.5 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary shrink-0">Post-update</span>
                  <span class="font-mono dd-text text-right break-all">{{ selectedLifecycleHooks.postUpdate || 'Not configured' }}</span>
                </div>
                <div class="flex items-center justify-between gap-3 px-2.5 py-1.5 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary">Timeout</span>
                  <span class="font-mono dd-text">{{ selectedLifecycleHooks.timeoutLabel }}</span>
                </div>
              </div>
              <div v-if="selectedLifecycleHooks.preAbortBehavior"
                   class="mt-2 px-2.5 py-1.5 dd-rounded text-[11px]"
                   :style="{ backgroundColor: 'var(--dd-info-muted)' }">
                <span style="color: var(--dd-info);">{{ selectedLifecycleHooks.preAbortBehavior }}</span>
              </div>
              <div class="mt-2 px-2.5 py-1.5 dd-rounded text-[11px]"
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

            <!-- Auto-rollback -->
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Auto-Rollback</div>
              <div class="space-y-1">
                <div class="flex items-center justify-between gap-3 px-2.5 py-1.5 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary">Status</span>
                  <span class="font-mono dd-text">{{ selectedAutoRollbackConfig.enabledLabel }}</span>
                </div>
                <div class="flex items-center justify-between gap-3 px-2.5 py-1.5 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary">Window</span>
                  <span class="font-mono dd-text">{{ selectedAutoRollbackConfig.windowLabel }}</span>
                </div>
                <div class="flex items-center justify-between gap-3 px-2.5 py-1.5 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary">Interval</span>
                  <span class="font-mono dd-text">{{ selectedAutoRollbackConfig.intervalLabel }}</span>
                </div>
              </div>
            </div>

            <!-- Image metadata -->
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Image Metadata</div>
              <div class="space-y-1">
                <div class="flex items-center justify-between gap-3 px-2.5 py-1.5 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary">Architecture</span>
                  <span class="font-mono dd-text">{{ selectedImageMetadata.architecture || 'Unknown' }}</span>
                </div>
                <div class="flex items-center justify-between gap-3 px-2.5 py-1.5 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary">OS</span>
                  <span class="font-mono dd-text">{{ selectedImageMetadata.os || 'Unknown' }}</span>
                </div>
                <div class="px-2.5 py-1.5 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <div class="dd-text-secondary">Digest</div>
                  <div class="font-mono dd-text break-all">
                    {{ selectedImageMetadata.digest || 'Unknown' }}
                  </div>
                </div>
                <div class="flex items-center justify-between gap-3 px-2.5 py-1.5 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text-secondary">Created</span>
                  <span class="font-mono dd-text">
                    {{ selectedImageMetadata.created ? formatTimestamp(selectedImageMetadata.created) : 'Unknown' }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Security -->
            <div>
              <div class="flex items-center justify-between gap-2 mb-2">
                <div class="text-[10px] font-semibold uppercase tracking-wider dd-text-muted">Security</div>
                <button class="px-2 py-1 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                        :style="{ border: '1px solid var(--dd-border-strong)' }"
                        :disabled="detailVulnerabilityLoading || detailSbomLoading"
                        @click="loadDetailSecurityData">
                  {{ detailVulnerabilityLoading || detailSbomLoading ? 'Refreshing...' : 'Refresh' }}
                </button>
              </div>

              <div v-if="detailVulnerabilityLoading"
                   class="px-2.5 py-1.5 dd-rounded text-[11px] dd-text-muted"
                   :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                Loading vulnerability data...
              </div>
              <div v-else-if="detailVulnerabilityError"
                   class="px-2.5 py-1.5 dd-rounded text-[11px]"
                   :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
                {{ detailVulnerabilityError }}
              </div>
              <div v-else class="space-y-1.5">
                <div class="flex items-center gap-1.5 flex-wrap text-[10px]">
                  <span class="badge text-[9px] font-bold"
                        :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
                    critical {{ vulnerabilitySummary.critical }}
                  </span>
                  <span class="badge text-[9px] font-bold"
                        :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
                    high {{ vulnerabilitySummary.high }}
                  </span>
                  <span class="badge text-[9px] font-bold"
                        :style="{ backgroundColor: 'var(--dd-caution-muted)', color: 'var(--dd-caution)' }">
                    medium {{ vulnerabilitySummary.medium }}
                  </span>
                  <span class="badge text-[9px] font-bold"
                        :style="{ backgroundColor: 'var(--dd-info-muted)', color: 'var(--dd-info)' }">
                    low {{ vulnerabilitySummary.low }}
                  </span>
                  <span class="text-[10px] dd-text-muted ml-auto">{{ vulnerabilityTotal }} total</span>
                </div>

                <div v-if="vulnerabilityPreview.length > 0" class="space-y-1">
                  <div v-for="vulnerability in vulnerabilityPreview" :key="vulnerability.id"
                       class="flex items-center gap-2 px-2.5 py-1.5 dd-rounded text-[10px]"
                       :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                    <span class="badge text-[9px] font-bold uppercase"
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
                <div v-else class="px-2.5 py-1.5 dd-rounded text-[11px] dd-text-muted italic"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  No vulnerabilities reported for this container.
                </div>
              </div>

              <div class="mt-2 space-y-1.5">
                <div class="flex items-center gap-2">
                  <select v-model="selectedSbomFormat"
                          class="px-2 py-1 dd-rounded text-[10px] font-semibold uppercase tracking-wide border outline-none cursor-pointer dd-bg dd-text dd-border-strong">
                    <option value="spdx-json">spdx-json</option>
                    <option value="cyclonedx-json">cyclonedx-json</option>
                  </select>
                  <button class="px-2 py-1 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="detailSbomLoading"
                          @click="loadDetailSbom">
                    {{ detailSbomLoading ? 'Loading SBOM...' : 'Refresh SBOM' }}
                  </button>
                </div>
                <div v-if="detailSbomError"
                     class="px-2.5 py-1.5 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
                  {{ detailSbomError }}
                </div>
                <div v-else-if="detailSbomLoading"
                     class="px-2.5 py-1.5 dd-rounded text-[11px] dd-text-muted"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  Loading SBOM document...
                </div>
                <div v-else-if="sbomDocument"
                     class="px-2.5 py-1.5 dd-rounded text-[10px] space-y-0.5"
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
                <div v-else
                     class="px-2.5 py-1.5 dd-rounded text-[11px] dd-text-muted italic"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  SBOM document is not available yet.
                </div>
              </div>
            </div>
          </div>

          <!-- Logs tab -->
          <div v-if="activeDetailTab === 'logs'">
            <div class="dd-rounded overflow-hidden"
                 :style="{ backgroundColor: 'var(--dd-bg-code)' }">
              <div class="px-3 py-2 flex items-center justify-between gap-2"
                   style="border-bottom: 1px solid var(--dd-log-divider);">
                <span class="text-[10px] font-semibold uppercase tracking-wider" style="color: var(--dd-text-muted);">
                  Container Logs
                </span>
                <div class="flex items-center gap-2">
                  <select v-model.number="containerAutoFetchInterval"
                          class="px-1.5 py-1 dd-rounded text-[9px] font-semibold uppercase tracking-wide border outline-none cursor-pointer dd-bg dd-text dd-border-strong">
                    <option v-for="opt in LOG_AUTO_FETCH_INTERVALS" :key="opt.value" :value="opt.value">
                      {{ opt.label }}
                    </option>
                  </select>
                  <span class="text-[9px] font-mono" style="color: var(--dd-text-muted);">
                    {{ getContainerLogs(selectedContainer.name).length }} lines
                  </span>
                </div>
              </div>
              <div ref="containerLogRef" class="overflow-auto" style="max-height: calc(100vh - 400px);"
                   @scroll="containerHandleLogScroll">
                <div v-for="(line, i) in getContainerLogs(selectedContainer.name)" :key="i"
                     class="px-3 py-0.5 font-mono text-[10px] leading-relaxed whitespace-pre"
                     :style="{ borderBottom: i < getContainerLogs(selectedContainer.name).length - 1 ? '1px solid var(--dd-log-line)' : 'none' }">
                  <span style="color: var(--dd-text-muted);">{{ line.substring(0, 24) }}</span>
                  <span :style="{ color: line.includes('[error]') || line.includes('[crit]') || line.includes('[emerg]') ? 'var(--dd-danger)' : line.includes('[warn]') ? 'var(--dd-warning)' : 'var(--dd-text-secondary)' }">{{ line.substring(24) }}</span>
                </div>
              </div>
              <div v-if="containerScrollBlocked && containerAutoFetchInterval > 0"
                   class="flex items-center justify-between px-3 py-1.5 text-[9px]"
                   style="border-top: 1px solid var(--dd-log-divider);">
                <span class="font-semibold" style="color: var(--dd-warning);">Auto-scroll paused</span>
                <button class="px-2 py-0.5 dd-rounded text-[9px] font-semibold"
                        :style="{ backgroundColor: 'var(--dd-warning)', color: 'var(--dd-bg)' }"
                        @click="containerResumeAutoScroll">
                  Resume
                </button>
              </div>
            </div>
          </div>

          <!-- Environment tab -->
          <div v-if="activeDetailTab === 'environment'" class="space-y-5">
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Environment Variables</div>
              <div v-if="selectedContainer.details.env.length > 0" class="space-y-1">
                <div v-for="e in selectedContainer.details.env" :key="e.key"
                     class="flex items-center gap-2 px-2.5 py-1.5 dd-rounded text-[11px] font-mono"
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
              <p v-else class="text-[11px] dd-text-muted italic">No environment variables configured</p>
            </div>
            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Volumes</div>
              <div v-if="selectedContainer.details.volumes.length > 0" class="space-y-1">
                <div v-for="vol in selectedContainer.details.volumes" :key="vol"
                     class="flex items-center gap-2 px-2.5 py-1.5 dd-rounded text-[11px] font-mono"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <AppIcon name="hard-drive" :size="11" class="dd-text-muted" />
                  <span class="truncate dd-text">{{ vol }}</span>
                </div>
              </div>
              <p v-else class="text-[11px] dd-text-muted italic">No volumes mounted</p>
            </div>
          </div>

          <!-- Labels tab -->
          <div v-if="activeDetailTab === 'labels'">
            <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Labels</div>
            <div v-if="selectedContainer.details.labels.length > 0" class="flex flex-wrap gap-1.5">
              <span v-for="label in selectedContainer.details.labels" :key="label"
                    class="badge text-[10px] font-semibold"
                    :style="{
                      backgroundColor: 'var(--dd-neutral-muted)',
                      color: 'var(--dd-text-secondary)',
                    }">
                {{ label }}
              </span>
            </div>
            <p v-else class="text-[11px] dd-text-muted italic">No labels assigned</p>
          </div>

          <!-- Actions tab -->
          <div v-if="activeDetailTab === 'actions'" class="space-y-5">
            <div class="space-y-3">
              <div class="text-[10px] font-semibold uppercase tracking-wider dd-text-muted">Update Workflow</div>
              <!-- Actions group -->
              <div>
                <div class="text-[9px] uppercase tracking-wider mb-1.5 dd-text-muted">Actions</div>
                <div class="flex flex-wrap gap-1.5">
                  <button class="px-2.5 py-1.5 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="previewLoading"
                          @click="runContainerPreview">
                    {{ previewLoading ? 'Previewing...' : 'Preview Update' }}
                  </button>
                  <button class="px-2.5 py-1.5 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="!selectedContainer.newTag || actionInProgress === selectedContainer.name"
                          @click="updateContainer(selectedContainer.name)">
                    Update Now
                  </button>
                  <button class="px-2.5 py-1.5 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="actionInProgress === selectedContainer.name"
                          @click="scanContainer(selectedContainer.name)">
                    Scan Now
                  </button>
                </div>
              </div>
              <!-- Skip & Snooze group -->
              <div>
                <div class="text-[9px] uppercase tracking-wider mb-1.5 dd-text-muted">Skip & Snooze</div>
                <div class="flex flex-wrap gap-1.5">
                  <button class="px-2.5 py-1.5 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="!selectedContainer.newTag || policyInProgress !== null"
                          @click="skipCurrentForSelected">
                    Skip This Update
                  </button>
                  <button class="px-2.5 py-1.5 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="policyInProgress !== null"
                          @click="snoozeSelected(1)">
                    Snooze 1d
                  </button>
                  <button class="px-2.5 py-1.5 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="policyInProgress !== null"
                          @click="snoozeSelected(7)">
                    Snooze 7d
                  </button>
                  <input
                    v-model="snoozeDateInput"
                    type="date"
                    class="px-2 py-1.5 dd-rounded text-[10px] border outline-none dd-bg dd-text dd-border-strong"
                    :disabled="policyInProgress !== null" />
                  <button class="px-2.5 py-1.5 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="!snoozeDateInput || policyInProgress !== null"
                          @click="snoozeSelectedUntilDate">
                    Snooze Until
                  </button>
                  <button class="px-2.5 py-1.5 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="!selectedSnoozeUntil || policyInProgress !== null"
                          @click="unsnoozeSelected">
                    Unsnooze
                  </button>
                </div>
              </div>
              <!-- Reset group -->
              <div>
                <div class="text-[9px] uppercase tracking-wider mb-1.5 dd-text-muted">Reset</div>
                <div class="flex flex-wrap gap-1.5">
                  <button class="px-2.5 py-1.5 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="selectedSkipTags.length === 0 && selectedSkipDigests.length === 0"
                          @click="clearSkipsSelected">
                    Clear Skips
                  </button>
                  <button class="px-2.5 py-1.5 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="Object.keys(selectedUpdatePolicy).length === 0"
                          @click="clearPolicySelected">
                    Clear Policy
                  </button>
                </div>
              </div>
              <div class="mt-2 space-y-1 text-[10px] dd-text-muted">
                <div v-if="selectedSnoozeUntil">
                  Snoozed until:
                  <span class="dd-text">{{ formatTimestamp(selectedSnoozeUntil) }}</span>
                </div>
                <div v-if="selectedSkipTags.length > 0">
                  Skipped tags:
                  <div class="mt-1 flex flex-wrap gap-1">
                    <span v-for="tag in selectedSkipTags" :key="`skip-tag-${tag}`"
                          class="inline-flex items-center gap-1 px-1.5 py-0.5 dd-rounded text-[10px] font-mono"
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
                  <div class="mt-1 flex flex-wrap gap-1">
                    <span v-for="digest in selectedSkipDigests" :key="`skip-digest-${digest}`"
                          class="inline-flex items-center gap-1 px-1.5 py-0.5 dd-rounded text-[10px] font-mono"
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
                <div v-if="!selectedSnoozeUntil && selectedSkipTags.length === 0 && selectedSkipDigests.length === 0"
                     class="italic">
                  No active update policy.
                </div>
              </div>
              <p v-if="policyMessage" class="mt-2 text-[10px]" style="color: var(--dd-success);">{{ policyMessage }}</p>
              <p v-if="policyError" class="mt-2 text-[10px]" style="color: var(--dd-danger);">{{ policyError }}</p>
            </div>

            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Preview</div>
              <div class="space-y-1.5">
                <div v-if="previewLoading" class="px-2.5 py-2 dd-rounded text-[11px] dd-text-muted"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  Generating preview...
                </div>
                <div v-else-if="detailPreview" class="px-2.5 py-2 dd-rounded text-[11px] space-y-1"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
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
                  </template>
                </div>
                <div v-else class="px-2.5 py-2 dd-rounded text-[11px] dd-text-muted italic"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  Run a preview to see what update actions will be executed.
                </div>
              </div>
              <p v-if="previewError" class="mt-2 text-[10px]" style="color: var(--dd-danger);">{{ previewError }}</p>
            </div>

            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Associated Triggers</div>
              <div v-if="triggersLoading" class="text-[11px] dd-text-muted">Loading triggers...</div>
              <div v-else-if="detailTriggers.length > 0" class="space-y-1.5">
                <div v-for="trigger in detailTriggers" :key="getTriggerKey(trigger)"
                     class="flex items-center justify-between gap-2 px-2.5 py-2 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <div class="min-w-0">
                    <div class="font-semibold dd-text truncate">{{ trigger.type }}.{{ trigger.name }}</div>
                    <div v-if="trigger.agent" class="text-[10px] dd-text-muted">agent: {{ trigger.agent }}</div>
                  </div>
                  <button class="px-2 py-1 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="triggerRunInProgress !== null"
                          @click="runAssociatedTrigger(trigger)">
                    {{ triggerRunInProgress === getTriggerKey(trigger) ? 'Running...' : 'Run' }}
                  </button>
                </div>
              </div>
              <p v-else class="text-[11px] dd-text-muted italic">No triggers associated with this container</p>
              <p v-if="triggerMessage" class="mt-2 text-[10px]" style="color: var(--dd-success);">{{ triggerMessage }}</p>
              <p v-if="triggerError" class="mt-2 text-[10px]" style="color: var(--dd-danger);">{{ triggerError }}</p>
            </div>

            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Backups &amp; Rollback</div>
              <div class="mb-2">
                <button class="px-2.5 py-1.5 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                        :style="{ border: '1px solid var(--dd-border-strong)' }"
                        :disabled="backupsLoading || detailBackups.length === 0 || rollbackInProgress !== null"
                        @click="rollbackToBackup()">
                  {{ rollbackInProgress === 'latest' ? 'Rolling back...' : 'Rollback Latest' }}
                </button>
              </div>
              <div v-if="backupsLoading" class="text-[11px] dd-text-muted">Loading backups...</div>
              <div v-else-if="detailBackups.length > 0" class="space-y-1.5">
                <div v-for="backup in detailBackups" :key="backup.id"
                     class="flex items-center justify-between gap-2 px-2.5 py-2 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <div class="min-w-0">
                    <div class="font-semibold dd-text font-mono truncate">{{ backup.imageName }}:{{ backup.imageTag }}</div>
                    <div class="text-[10px] dd-text-muted">{{ formatTimestamp(backup.timestamp) }}</div>
                  </div>
                  <button class="px-2 py-1 dd-rounded text-[10px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :style="{ border: '1px solid var(--dd-border-strong)' }"
                          :disabled="rollbackInProgress !== null"
                          @click="rollbackToBackup(backup.id)">
                    {{ rollbackInProgress === backup.id ? 'Rolling...' : 'Use' }}
                  </button>
                </div>
              </div>
              <p v-else class="text-[11px] dd-text-muted italic">No backups available yet</p>
              <p v-if="rollbackMessage" class="mt-2 text-[10px]" style="color: var(--dd-success);">{{ rollbackMessage }}</p>
              <p v-if="rollbackError" class="mt-2 text-[10px]" style="color: var(--dd-danger);">{{ rollbackError }}</p>
            </div>

            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Update Operation History</div>
              <div v-if="updateOperationsLoading" class="text-[11px] dd-text-muted">Loading operation history...</div>
              <div v-else-if="detailUpdateOperations.length > 0" class="space-y-1.5">
                <div v-for="operation in detailUpdateOperations" :key="operation.id"
                     class="space-y-1 px-2.5 py-2 dd-rounded text-[11px]"
                     :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <div class="flex items-center justify-between gap-2">
                    <div class="font-mono text-[10px] dd-text-muted truncate">{{ operation.id }}</div>
                    <span class="badge text-[9px] font-semibold uppercase"
                          :style="getOperationStatusStyle(operation.status)">
                      {{ formatOperationStatus(operation.status) }}
                    </span>
                  </div>
                  <div class="dd-text-muted">Phase:
                    <span class="dd-text font-mono">{{ formatOperationPhase(operation.phase) }}</span>
                  </div>
                  <div v-if="operation.fromVersion || operation.toVersion" class="dd-text-muted">
                    Version:
                    <span class="dd-text font-mono">{{ operation.fromVersion || '?' }}</span>
                    <span class="dd-text-muted"> → </span>
                    <span class="dd-text font-mono">{{ operation.toVersion || '?' }}</span>
                  </div>
                  <div v-if="operation.rollbackReason" class="dd-text-muted">
                    Rollback reason:
                    <span class="dd-text font-mono">{{ formatRollbackReason(operation.rollbackReason) }}</span>
                  </div>
                  <div v-if="operation.lastError" class="dd-text-muted">
                    Last error:
                    <span class="dd-text">{{ operation.lastError }}</span>
                  </div>
                  <div class="text-[10px] dd-text-muted">
                    {{ formatTimestamp(operation.updatedAt || operation.createdAt) }}
                  </div>
                </div>
              </div>
              <p v-else class="text-[11px] dd-text-muted italic">No update operations recorded yet</p>
              <p v-if="updateOperationsError" class="mt-2 text-[10px]" style="color: var(--dd-danger);">{{ updateOperationsError }}</p>
            </div>
          </div>

        </div>
</template>
