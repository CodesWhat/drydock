<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import AppButton from '../AppButton.vue';
import { hasTrackedContainerAction } from '../../utils/container-action-key';
import { useContainersViewTemplateContext } from './containersViewTemplateContext';

const { t } = useI18n();

const {
  selectedContainer,
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
  confirmClearPolicy,
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
  formatTimestamp,
} = useContainersViewTemplateContext();

function isActionInProgress(container: { id?: unknown; name?: unknown }) {
  return hasTrackedContainerAction(actionInProgress.value, container);
}
</script>

<template>
  <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
    <div class="space-y-4">
      <div class="dd-rounded overflow-hidden"
            :style="{ backgroundColor: 'var(--dd-bg-card)' }">
        <div class="px-4 py-3 flex items-center gap-2">
          <AppIcon name="updates" :size="12" class="dd-text-muted" />
          <span class="dd-text-label dd-text-muted">{{ t('containerComponents.fullPageActions.updateWorkflow') }}</span>
        </div>
        <div class="p-4 space-y-4">
          <!-- Actions group -->
          <div>
            <div class="text-3xs uppercase tracking-wider mb-1.5 dd-text-muted">{{ t('containerComponents.fullPageActions.actionsGroup') }}</div>
            <div class="flex flex-wrap gap-2">
              <AppButton size="md" variant="outlined" :disabled="previewLoading"
                      @click="runContainerPreview">
                {{ previewLoading ? t('containerComponents.fullPageActions.previewing') : t('containerComponents.fullPageActions.previewUpdate') }}
              </AppButton>
              <AppButton v-if="selectedContainer.bouncer === 'blocked'" size="md" variant="plain" :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)', border: '1px solid var(--dd-danger)' }"
                      :disabled="isActionInProgress(selectedContainer)"
                      @click="confirmForceUpdate(selectedContainer)">
                <AppIcon name="lock" :size="10" class="mr-1 inline" />{{ t('containerComponents.fullPageActions.forceUpdate') }}
              </AppButton>
              <AppButton v-else
                      size="md" variant="outlined"
                      :disabled="!selectedContainer.newTag || isActionInProgress(selectedContainer)"
                      @click="confirmUpdate(selectedContainer)">
                {{ t('containerComponents.fullPageActions.updateNow') }}
              </AppButton>
              <AppButton size="md" variant="outlined" :disabled="isActionInProgress(selectedContainer)"
                      @click="scanContainer(selectedContainer)">
                {{ t('containerComponents.fullPageActions.scanNow') }}
              </AppButton>
            </div>
          </div>
          <!-- Skip & Snooze group -->
          <div>
            <div class="text-3xs uppercase tracking-wider mb-1.5 dd-text-muted">{{ t('containerComponents.fullPageActions.skipSnoozeGroup') }}</div>
            <div class="flex flex-wrap gap-2">
              <AppButton size="md" variant="outlined" :disabled="!selectedContainer.newTag || policyInProgress !== null"
                      @click="skipCurrentForSelected">
                {{ t('containerComponents.fullPageActions.skipThisUpdate') }}
              </AppButton>
              <AppButton size="md" variant="outlined" :disabled="policyInProgress !== null"
                      @click="snoozeSelected(1)">
                {{ t('containerComponents.fullPageActions.snooze1d') }}
              </AppButton>
              <AppButton size="md" variant="outlined" :disabled="policyInProgress !== null"
                      @click="snoozeSelected(7)">
                {{ t('containerComponents.fullPageActions.snooze7d') }}
              </AppButton>
              <input
                v-model="snoozeDateInput"
                type="date"
                class="px-2.5 py-1.5 dd-rounded text-2xs-plus outline-none dd-bg dd-text"
                :disabled="policyInProgress !== null" />
              <AppButton size="md" variant="outlined" :disabled="!snoozeDateInput || policyInProgress !== null"
                      @click="snoozeSelectedUntilDate">
                {{ t('containerComponents.fullPageActions.snoozeUntil') }}
              </AppButton>
              <AppButton size="md" variant="outlined" :disabled="!selectedSnoozeUntil || policyInProgress !== null"
                      @click="unsnoozeSelected">
                {{ t('containerComponents.fullPageActions.unsnooze') }}
              </AppButton>
            </div>
          </div>
          <!-- Maturity group -->
          <div>
            <div class="text-3xs uppercase tracking-wider mb-1.5 dd-text-muted">{{ t('containerComponents.fullPageActions.maturityGroup') }}</div>
            <div class="flex flex-wrap gap-2 items-center">
              <select
                v-model="maturityModeInput"
                class="px-2.5 py-1.5 dd-rounded text-2xs-plus outline-none dd-bg dd-text"
                :disabled="policyInProgress !== null"
              >
                <option value="all">{{ t('containerComponents.fullPageActions.allowNewMature') }}</option>
                <option value="mature">{{ t('containerComponents.fullPageActions.matureOnly') }}</option>
              </select>
              <input
                v-model.number="maturityMinAgeDaysInput"
                type="number"
                min="1"
                max="365"
                class="w-[104px] px-2.5 py-1.5 dd-rounded text-2xs-plus outline-none dd-bg dd-text"
                :disabled="policyInProgress !== null"
              />
              <AppButton size="md" variant="outlined" :disabled="policyInProgress !== null"
                      @click="setMaturityPolicySelected(maturityModeInput)">
                {{ t('containerComponents.fullPageActions.applyMaturity') }}
              </AppButton>
              <AppButton size="md" variant="outlined" :disabled="!selectedHasMaturityPolicy || policyInProgress !== null"
                      @click="clearMaturityPolicySelected">
                {{ t('containerComponents.fullPageActions.clearMaturity') }}
              </AppButton>
            </div>
          </div>
          <!-- Reset group -->
          <div>
            <div class="text-3xs uppercase tracking-wider mb-1.5 dd-text-muted">{{ t('containerComponents.fullPageActions.resetGroup') }}</div>
            <div class="flex flex-wrap gap-2">
              <AppButton size="md" variant="outlined" :disabled="(selectedSkipTags.length === 0 && selectedSkipDigests.length === 0) || policyInProgress !== null"
                      @click="clearSkipsSelected">
                {{ t('containerComponents.fullPageActions.clearSkips') }}
              </AppButton>
              <AppButton size="md" variant="outlined" :disabled="Object.keys(selectedUpdatePolicy).length === 0 || policyInProgress !== null"
                      @click="confirmClearPolicy">
                {{ t('containerComponents.fullPageActions.clearPolicy') }}
              </AppButton>
            </div>
          </div>
          <div class="space-y-1 text-2xs-plus dd-text-muted">
            <div v-if="selectedSnoozeUntil">
              {{ t('containerComponents.fullPageActions.snoozedUntil') }}
              <span class="dd-text">{{ formatTimestamp(selectedSnoozeUntil) }}</span>
            </div>
            <div v-if="selectedHasMaturityPolicy">
              {{ t('containerComponents.fullPageActions.maturityMode') }}
              <span class="dd-text">
                {{ selectedMaturityMode === 'mature' ? t('containerComponents.fullPageActions.matureOnlyMinimum', { days: selectedMaturityMinAgeDays }) : t('containerComponents.fullPageActions.allowAllUpdates') }}
              </span>
            </div>
            <div v-if="selectedSkipTags.length > 0">
              {{ t('containerComponents.fullPageActions.skippedTags') }}
              <div class="mt-1 flex flex-wrap gap-1.5">
                <span v-for="tag in selectedSkipTags" :key="`skip-tag-full-${tag}`"
                      class="inline-flex items-center gap-1.5 px-2 py-1 dd-rounded text-2xs-plus font-mono"
                      :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text">{{ tag }}</span>
                  <AppButton size="none" variant="plain" weight="none" class="inline-flex items-center justify-center w-4 h-4 dd-rounded-sm transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :tooltip="t('containerComponents.fullPageActions.removeSkip')"
                          :disabled="policyInProgress !== null"
                          @click="removeSkipTagSelected(tag)">
                    <AppIcon name="xmark" :size="9" />
                  </AppButton>
                </span>
              </div>
            </div>
            <div v-if="selectedSkipDigests.length > 0">
              {{ t('containerComponents.fullPageActions.skippedDigests') }}
              <div class="mt-1 flex flex-wrap gap-1.5">
                <span v-for="digest in selectedSkipDigests" :key="`skip-digest-full-${digest}`"
                      class="inline-flex items-center gap-1.5 px-2 py-1 dd-rounded text-2xs-plus font-mono"
                      :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text">{{ digest }}</span>
                  <AppButton size="none" variant="plain" weight="none" class="inline-flex items-center justify-center w-4 h-4 dd-rounded-sm transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          :tooltip="t('containerComponents.fullPageActions.removeSkip')"
                          :disabled="policyInProgress !== null"
                          @click="removeSkipDigestSelected(digest)">
                    <AppIcon name="xmark" :size="9" />
                  </AppButton>
                </span>
              </div>
            </div>
            <div v-if="!selectedSnoozeUntil && selectedSkipTags.length === 0 && selectedSkipDigests.length === 0 && !selectedHasMaturityPolicy"
                  class="italic">
              {{ t('containerComponents.fullPageActions.noActivePolicy') }}
            </div>
          </div>
          <p v-if="policyMessage" class="text-2xs-plus" style="color: var(--dd-success);">{{ policyMessage }}</p>
          <p v-if="policyError" class="text-2xs-plus" style="color: var(--dd-danger);">{{ policyError }}</p>
        </div>
      </div>

      <div class="dd-rounded overflow-hidden"
            :style="{ backgroundColor: 'var(--dd-bg-card)' }">
        <div class="px-4 py-3 flex items-center gap-2">
          <AppIcon name="info" :size="12" class="dd-text-muted" />
          <span class="dd-text-label dd-text-muted">{{ t('containerComponents.fullPageActions.previewSection') }}</span>
        </div>
        <div class="p-4 space-y-2 text-xs">
          <div v-if="previewLoading" class="dd-text-muted">{{ t('containerComponents.fullPageActions.generatingPreview') }}</div>
          <div v-else-if="detailPreview" class="space-y-1">
            <div v-if="detailPreview.error" style="color: var(--dd-danger);">{{ detailPreview.error }}</div>
            <template v-else>
              <div class="dd-text-muted">{{ t('containerComponents.fullPageActions.currentLabel') }} <span class="dd-text font-mono">{{ detailPreview.currentImage || '-' }}</span></div>
              <div class="dd-text-muted">{{ t('containerComponents.fullPageActions.newLabel') }} <span class="dd-text font-mono">{{ detailPreview.newImage || '-' }}</span></div>
              <div class="dd-text-muted">{{ t('containerComponents.fullPageActions.updateKindLabel') }}
                <span class="dd-text font-mono">{{ detailPreview.updateKind?.kind || detailPreview.updateKind || 'unknown' }}</span>
              </div>
              <div class="dd-text-muted">{{ t('containerComponents.fullPageActions.runningLabel') }}
                <span class="dd-text">{{ detailPreview.isRunning ? 'yes' : 'no' }}</span>
              </div>
              <div v-if="Array.isArray(detailPreview.networks)" class="dd-text-muted">
                {{ t('containerComponents.fullPageActions.networksLabel') }} <span class="dd-text font-mono">{{ detailPreview.networks.join(', ') || '-' }}</span>
              </div>
              <div v-if="detailComposePreview?.files.length" class="dd-text-muted">
                {{ detailComposePreview.files.length > 1 ? t('containerComponents.fullPageActions.composeFilesLabel') : t('containerComponents.fullPageActions.composeFileLabel') }}
                <span class="dd-text font-mono">{{ detailComposePreview.files.join(', ') }}</span>
              </div>
              <div v-if="detailComposePreview?.service" class="dd-text-muted">
                {{ t('containerComponents.fullPageActions.composeServiceLabel') }}
                <span class="dd-text font-mono">{{ detailComposePreview.service }}</span>
              </div>
              <div v-if="detailComposePreview?.writableFile" class="dd-text-muted">
                {{ t('containerComponents.fullPageActions.writableFileLabel') }}
                <span class="dd-text font-mono">{{ detailComposePreview.writableFile }}</span>
              </div>
              <div v-if="typeof detailComposePreview?.willWrite === 'boolean'" class="dd-text-muted">
                {{ t('containerComponents.fullPageActions.writesComposeFileLabel') }}
                <span class="dd-text">{{ detailComposePreview.willWrite ? 'yes' : 'no' }}</span>
              </div>
              <div v-if="detailComposePreview?.patch" class="dd-text-muted">
                {{ t('containerComponents.fullPageActions.patchPreviewLabel') }}
                <pre class="mt-1 p-2 dd-rounded whitespace-pre-wrap break-all text-2xs-plus dd-text font-mono"
                      :style="{ backgroundColor: 'var(--dd-bg-inset)' }">{{ detailComposePreview.patch }}</pre>
              </div>
            </template>
          </div>
          <div v-else class="dd-text-muted italic">
            {{ t('containerComponents.fullPageActions.previewEmptyState') }}
          </div>
          <p v-if="previewError" class="text-2xs-plus" style="color: var(--dd-danger);">{{ previewError }}</p>
        </div>
      </div>
    </div>

    <div class="space-y-4">
      <div class="dd-rounded overflow-hidden"
            :style="{ backgroundColor: 'var(--dd-bg-card)' }">
        <div class="px-4 py-3 flex items-center gap-2">
          <AppIcon name="triggers" :size="12" class="dd-text-muted" />
          <span class="dd-text-label dd-text-muted">{{ t('containerComponents.fullPageActions.associatedTriggers') }}</span>
        </div>
        <div class="p-4 space-y-2">
          <div v-if="triggersLoading" class="text-xs dd-text-muted">{{ t('containerComponents.fullPageActions.loadingTriggers') }}</div>
          <div v-else-if="detailTriggers.length > 0" class="space-y-2">
            <div v-for="trigger in detailTriggers" :key="getTriggerKey(trigger)"
                  class="flex items-center justify-between gap-3 px-3 py-2 dd-rounded"
                  :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              <div class="min-w-0">
                <div class="text-xs font-semibold dd-text truncate">{{ trigger.type }}.{{ trigger.name }}</div>
                <div v-if="trigger.agent" class="text-2xs-plus dd-text-muted">agent: {{ trigger.agent }}</div>
              </div>
              <AppButton size="md" variant="outlined" :disabled="triggerRunInProgress !== null"
                      @click="runAssociatedTrigger(trigger)">
                {{ triggerRunInProgress === getTriggerKey(trigger) ? t('containerComponents.fullPageActions.runningButton') : t('containerComponents.fullPageActions.runButton') }}
              </AppButton>
            </div>
          </div>
          <p v-else class="text-xs dd-text-muted italic">{{ t('containerComponents.fullPageActions.noTriggersAssociated') }}</p>
          <p v-if="triggerMessage" class="text-2xs-plus" style="color: var(--dd-success);">{{ triggerMessage }}</p>
          <p v-if="triggerError" class="text-2xs-plus" style="color: var(--dd-danger);">{{ triggerError }}</p>
        </div>
      </div>

      <div class="dd-rounded overflow-hidden"
            :style="{ backgroundColor: 'var(--dd-bg-card)' }">
        <div class="px-4 py-3 flex items-center gap-2">
          <AppIcon name="recent-updates" :size="12" class="dd-text-muted" />
          <span class="dd-text-label dd-text-muted">{{ t('containerComponents.fullPageActions.backupsRollback') }}</span>
        </div>
        <div class="p-4 space-y-2">
          <div>
            <AppButton size="md" variant="outlined" :disabled="backupsLoading || detailBackups.length === 0 || rollbackInProgress !== null"
                    @click="confirmRollback()">
              {{ rollbackInProgress === 'latest' ? t('containerComponents.fullPageActions.rollingBack') : t('containerComponents.fullPageActions.rollbackLatest') }}
            </AppButton>
          </div>
          <div v-if="backupsLoading" class="text-xs dd-text-muted">{{ t('containerComponents.fullPageActions.loadingBackups') }}</div>
          <div v-else-if="detailBackups.length > 0" class="space-y-2">
            <div v-for="backup in detailBackups" :key="backup.id"
                  class="flex items-center justify-between gap-3 px-3 py-2 dd-rounded"
                  :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              <div class="min-w-0">
                <div class="text-xs font-semibold dd-text font-mono truncate">{{ backup.imageName }}:{{ backup.imageTag }}</div>
                <div class="text-2xs-plus dd-text-muted">{{ formatTimestamp(backup.timestamp) }}</div>
              </div>
              <AppButton size="md" variant="outlined" :disabled="rollbackInProgress !== null"
                      @click="confirmRollback(backup.id)">
                {{ rollbackInProgress === backup.id ? t('containerComponents.fullPageActions.rollingButton') : t('containerComponents.fullPageActions.useButton') }}
              </AppButton>
            </div>
          </div>
          <p v-else class="text-xs dd-text-muted italic">{{ t('containerComponents.fullPageActions.noBackupsAvailable') }}</p>
          <p v-if="rollbackMessage" class="text-2xs-plus" style="color: var(--dd-success);">{{ rollbackMessage }}</p>
          <p v-if="rollbackError" class="text-2xs-plus" style="color: var(--dd-danger);">{{ rollbackError }}</p>
        </div>
      </div>

      <div class="dd-rounded overflow-hidden"
            :style="{ backgroundColor: 'var(--dd-bg-card)' }">
        <div class="px-4 py-3 flex items-center gap-2">
          <AppIcon name="audit" :size="12" class="dd-text-muted" />
          <span class="dd-text-label dd-text-muted">{{ t('containerComponents.fullPageActions.updateOperationHistory') }}</span>
        </div>
        <div class="p-4 space-y-2">
          <div v-if="updateOperationsLoading" class="text-xs dd-text-muted">{{ t('containerComponents.fullPageActions.loadingOperationHistory') }}</div>
          <div v-else-if="detailUpdateOperations.length > 0" class="space-y-2">
            <div v-for="operation in detailUpdateOperations" :key="`full-${operation.id}`"
                  class="space-y-1.5 px-3 py-2 dd-rounded"
                  :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
              <div class="flex items-center justify-between gap-3">
                <div class="text-2xs-plus font-mono dd-text-muted truncate">{{ operation.id }}</div>
                <span class="badge text-2xs font-semibold uppercase"
                      :style="getOperationStatusStyle(operation.status)">
                  {{ formatOperationStatus(operation.status) }}
                </span>
              </div>
              <div class="text-xs dd-text-muted">{{ t('containerComponents.fullPageActions.phaseLabel') }}
                <span class="dd-text font-mono">{{ formatOperationPhase(operation.phase) }}</span>
              </div>
              <div v-if="operation.fromVersion || operation.toVersion" class="text-xs dd-text-muted">
                {{ t('containerComponents.fullPageActions.versionLabel') }}
                <span class="dd-text font-mono">{{ operation.fromVersion || '?' }}</span>
                <span class="dd-text-muted"> → </span>
                <span class="dd-text font-mono">{{ operation.toVersion || '?' }}</span>
              </div>
              <div v-if="operation.rollbackReason" class="text-xs dd-text-muted">
                {{ t('containerComponents.fullPageActions.rollbackReasonLabel') }}
                <span class="dd-text font-mono">{{ formatRollbackReason(operation.rollbackReason) }}</span>
              </div>
              <div v-if="operation.lastError" class="text-xs dd-text-muted">
                {{ t('containerComponents.fullPageActions.lastErrorLabel') }}
                <span class="dd-text">{{ operation.lastError }}</span>
              </div>
              <div class="text-2xs-plus dd-text-muted">
                {{ formatTimestamp(operation.updatedAt || operation.createdAt) }}
              </div>
            </div>
          </div>
          <p v-else class="text-xs dd-text-muted italic">{{ t('containerComponents.fullPageActions.noUpdateOperations') }}</p>
          <p v-if="updateOperationsError" class="text-2xs-plus" style="color: var(--dd-danger);">{{ updateOperationsError }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
