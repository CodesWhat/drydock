<script setup lang="ts">
import AppButton from '../AppButton.vue';
import UpdateMaturityBadge from './UpdateMaturityBadge.vue';
import SuggestedTagBadge from './SuggestedTagBadge.vue';
import ReleaseNotesLink from './ReleaseNotesLink.vue';
import ProjectLink from './ProjectLink.vue';
import { useContainersViewTemplateContext } from './containersViewTemplateContext';

const {
  selectedContainer,
  selectedRuntimeOrigins,
  runtimeOriginStyle,
  runtimeOriginLabel,
  selectedRuntimeDriftWarnings,
  selectedComposePaths,
  selectedLifecycleHooks,
  lifecycleHookTemplateVariables,
  selectedAutoRollbackConfig,
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
  registryColorBg,
  registryColorText,
  registryLabel,
  updateKindColor,
} = useContainersViewTemplateContext();
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
    <!-- Ports card -->
    <div class="dd-rounded overflow-hidden"
          :style="{ backgroundColor: 'var(--dd-bg-card)' }">
      <div class="px-4 py-3 flex items-center gap-2">
        <AppIcon name="network" :size="12" class="dd-text-muted" />
        <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">Ports</span>
        <span class="badge text-3xs ml-auto dd-bg-elevated dd-text-muted">{{ selectedContainer.details.ports.length }}</span>
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
        <p v-else class="text-2xs-plus dd-text-muted italic">No ports exposed</p>
      </div>
    </div>

    <!-- Volumes card -->
    <div class="dd-rounded overflow-hidden"
          :style="{ backgroundColor: 'var(--dd-bg-card)' }">
      <div class="px-4 py-3 flex items-center gap-2">
        <AppIcon name="hard-drive" :size="12" class="dd-text-muted" />
        <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">Volumes</span>
        <span class="badge text-3xs ml-auto dd-bg-elevated dd-text-muted">{{ selectedContainer.details.volumes.length }}</span>
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
        <p v-else class="text-2xs-plus dd-text-muted italic">No volumes mounted</p>
      </div>
    </div>

    <!-- Compose files card -->
    <div v-if="selectedComposePaths.length > 0"
          class="dd-rounded overflow-hidden"
          :style="{ backgroundColor: 'var(--dd-bg-card)' }">
      <div class="px-4 py-3 flex items-center gap-2">
        <AppIcon name="stack" :size="12" class="dd-text-muted" />
        <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">Compose Files</span>
        <span class="badge text-3xs ml-auto dd-bg-elevated dd-text-muted">{{ selectedComposePaths.length }}</span>
      </div>
      <div class="p-4">
        <div class="space-y-1.5">
          <div
            v-for="(composePath, index) in selectedComposePaths"
            :key="`${composePath}-${index}`"
            class="flex items-center gap-2 px-3 py-2 dd-rounded text-xs font-mono"
            :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
          >
            <span v-if="selectedComposePaths.length > 1" class="text-3xs dd-text-muted">#{{ index + 1 }}</span>
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
        <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">Version</span>
      </div>
      <div class="p-4 space-y-3">
        <div class="flex items-center gap-3 px-3 py-2 dd-rounded text-xs font-mono"
              :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
          <span class="dd-text-secondary">Current:</span>
          <CopyableTag :tag="selectedContainer.currentTag" class="font-bold dd-text">{{ selectedContainer.currentTag }}</CopyableTag>
        </div>
        <div v-if="selectedContainer.newTag" class="flex items-center gap-3 px-3 py-2 dd-rounded text-xs font-mono"
              :style="{ backgroundColor: 'var(--dd-success-muted)' }">
          <span style="color: var(--dd-success);">Latest:</span>
          <CopyableTag :tag="selectedContainer.newTag!" class="font-bold" style="color: var(--dd-success);">{{ selectedContainer.newTag }}</CopyableTag>
          <span class="badge text-3xs"
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
        <div v-if="selectedContainer.updateKind || selectedContainer.updateMaturity || selectedContainer.suggestedTag" class="flex items-center gap-1.5 flex-wrap">
          <UpdateMaturityBadge :maturity="selectedContainer.updateMaturity" :tooltip="selectedContainer.updateMaturityTooltip" />
          <SuggestedTagBadge :tag="selectedContainer.suggestedTag" :current-tag="selectedContainer.currentTag" />
        </div>
        <ReleaseNotesLink :release-notes="selectedContainer.releaseNotes" :release-link="selectedContainer.releaseLink" />
        <ProjectLink :source-repo="selectedContainer.sourceRepo" />
        <div class="pt-1 space-y-1.5">
          <div class="text-2xs font-semibold uppercase tracking-wider dd-text-muted">Tag Filters</div>
          <div class="flex items-start gap-2 px-3 py-2 dd-rounded text-2xs-plus"
                :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
            <span class="dd-text-secondary shrink-0">Include:</span>
            <span class="font-mono dd-text break-all">{{ selectedContainer.includeTags || 'Not set' }}</span>
          </div>
          <div class="flex items-start gap-2 px-3 py-2 dd-rounded text-2xs-plus"
                :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
            <span class="dd-text-secondary shrink-0">Exclude:</span>
            <span class="font-mono dd-text break-all">{{ selectedContainer.excludeTags || 'Not set' }}</span>
          </div>
          <div class="flex items-start gap-2 px-3 py-2 dd-rounded text-2xs-plus"
                :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
            <span class="dd-text-secondary shrink-0">Transform:</span>
            <span class="font-mono dd-text break-all">{{ selectedContainer.transformTags || 'Not set' }}</span>
          </div>
        </div>
        <div class="pt-1 space-y-1.5">
          <div class="text-2xs font-semibold uppercase tracking-wider dd-text-muted">Trigger Filters</div>
          <div class="flex items-start gap-2 px-3 py-2 dd-rounded text-2xs-plus"
                :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
            <span class="dd-text-secondary shrink-0">Include:</span>
            <span class="font-mono dd-text break-all">{{ selectedContainer.triggerInclude || 'Not set' }}</span>
          </div>
          <div class="flex items-start gap-2 px-3 py-2 dd-rounded text-2xs-plus"
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
        <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">Registry</span>
      </div>
      <div class="p-4">
        <div class="flex items-center gap-3 px-3 py-2 dd-rounded text-xs"
              :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
          <span class="badge text-3xs uppercase font-bold"
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
        <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">Runtime Process</span>
      </div>
      <div class="p-4 space-y-2">
        <div class="flex items-center justify-between gap-3 px-3 py-2 dd-rounded text-xs"
              :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
          <span class="dd-text-secondary">Entrypoint</span>
          <span class="badge text-2xs font-bold uppercase"
                :style="runtimeOriginStyle(selectedRuntimeOrigins.entrypoint)">
            {{ runtimeOriginLabel(selectedRuntimeOrigins.entrypoint) }}
          </span>
        </div>
        <div class="flex items-center justify-between gap-3 px-3 py-2 dd-rounded text-xs"
              :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
          <span class="dd-text-secondary">Cmd</span>
          <span class="badge text-2xs font-bold uppercase"
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
        <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">Lifecycle Hooks</span>
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
        <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">Auto-Rollback</span>
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
        <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">Security</span>
        <AppButton size="xs" class="ml-auto" :disabled="detailVulnerabilityLoading || detailSbomLoading"
                @click="loadDetailSecurityData">
          {{ detailVulnerabilityLoading || detailSbomLoading ? 'Refreshing...' : 'Refresh' }}
        </AppButton>
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
          <div class="flex items-center gap-2 flex-wrap text-2xs-plus">
            <span class="badge text-2xs font-bold"
                  :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
              critical {{ vulnerabilitySummary.critical }}
            </span>
            <span class="badge text-2xs font-bold"
                  :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }">
              high {{ vulnerabilitySummary.high }}
            </span>
            <span class="badge text-2xs font-bold"
                  :style="{ backgroundColor: 'var(--dd-caution-muted)', color: 'var(--dd-caution)' }">
              medium {{ vulnerabilitySummary.medium }}
            </span>
            <span class="badge text-2xs font-bold"
                  :style="{ backgroundColor: 'var(--dd-info-muted)', color: 'var(--dd-info)' }">
              low {{ vulnerabilitySummary.low }}
            </span>
            <span class="dd-text-muted ml-auto">{{ vulnerabilityTotal }} total</span>
          </div>
          <div v-if="vulnerabilityPreview.length > 0" class="space-y-1.5">
            <div v-for="vulnerability in vulnerabilityPreview" :key="vulnerability.id"
                  class="flex items-center gap-2 px-3 py-2 dd-rounded text-2xs-plus"
                  :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              <span class="badge text-3xs font-bold uppercase"
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
                    class="px-2 py-1 dd-rounded text-2xs font-semibold uppercase tracking-wide outline-none cursor-pointer dd-bg dd-text">
              <option value="spdx-json">spdx-json</option>
              <option value="cyclonedx-json">cyclonedx-json</option>
            </select>
            <AppButton size="xs" :disabled="detailSbomLoading"
                    @click="loadDetailSbom">
              {{ detailSbomLoading ? 'Loading SBOM...' : 'Refresh SBOM' }}
            </AppButton>
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
                class="px-3 py-2 dd-rounded text-2xs-plus space-y-1"
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
</template>
