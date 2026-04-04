<script setup lang="ts">
import AppButton from '../AppButton.vue';
import { hasTrackedContainerAction } from '../../utils/container-action-key';
import { useContainersViewTemplateContext } from './containersViewTemplateContext';

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
          <span class="dd-text-label dd-text-muted">Update Workflow</span>
        </div>
        <div class="p-4 space-y-4">
          <!-- Actions group -->
          <div>
            <div class="text-3xs uppercase tracking-wider mb-1.5 dd-text-muted">Actions</div>
            <div class="flex flex-wrap gap-2">
              <AppButton size="md" variant="outlined" :disabled="previewLoading"
                      @click="runContainerPreview">
                {{ previewLoading ? 'Previewing...' : 'Preview Update' }}
              </AppButton>
              <AppButton v-if="selectedContainer.bouncer === 'blocked'" size="md" variant="plain" :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)', border: '1px solid var(--dd-danger)' }"
                      :disabled="isActionInProgress(selectedContainer)"
                      @click="confirmForceUpdate(selectedContainer)">
                <AppIcon name="lock" :size="10" class="mr-1 inline" />Force Update
              </AppButton>
              <AppButton v-else
                      size="md"
                      :disabled="!selectedContainer.newTag || isActionInProgress(selectedContainer)"
                      @click="confirmUpdate(selectedContainer)">
                Update Now
              </AppButton>
              <AppButton size="md" variant="outlined" :disabled="isActionInProgress(selectedContainer)"
                      @click="scanContainer(selectedContainer)">
                Scan Now
              </AppButton>
            </div>
          </div>
          <!-- Skip & Snooze group -->
          <div>
            <div class="text-3xs uppercase tracking-wider mb-1.5 dd-text-muted">Skip & Snooze</div>
            <div class="flex flex-wrap gap-2">
              <AppButton size="md" variant="outlined" :disabled="!selectedContainer.newTag || policyInProgress !== null"
                      @click="skipCurrentForSelected">
                Skip This Update
              </AppButton>
              <AppButton size="md" variant="outlined" :disabled="policyInProgress !== null"
                      @click="snoozeSelected(1)">
                Snooze 1d
              </AppButton>
              <AppButton size="md" variant="outlined" :disabled="policyInProgress !== null"
                      @click="snoozeSelected(7)">
                Snooze 7d
              </AppButton>
              <input
                v-model="snoozeDateInput"
                type="date"
                class="px-2.5 py-1.5 dd-rounded text-2xs-plus outline-none dd-bg dd-text"
                :disabled="policyInProgress !== null" />
              <AppButton size="md" variant="outlined" :disabled="!snoozeDateInput || policyInProgress !== null"
                      @click="snoozeSelectedUntilDate">
                Snooze Until
              </AppButton>
              <AppButton size="md" variant="outlined" :disabled="!selectedSnoozeUntil || policyInProgress !== null"
                      @click="unsnoozeSelected">
                Unsnooze
              </AppButton>
            </div>
          </div>
          <!-- Maturity group -->
          <div>
            <div class="text-3xs uppercase tracking-wider mb-1.5 dd-text-muted">Maturity</div>
            <div class="flex flex-wrap gap-2 items-center">
              <select
                v-model="maturityModeInput"
                class="px-2.5 py-1.5 dd-rounded text-2xs-plus outline-none dd-bg dd-text"
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
                class="w-[104px] px-2.5 py-1.5 dd-rounded text-2xs-plus outline-none dd-bg dd-text"
                :disabled="policyInProgress !== null"
              />
              <AppButton size="md" variant="outlined" :disabled="policyInProgress !== null"
                      @click="setMaturityPolicySelected(maturityModeInput)">
                Apply Maturity
              </AppButton>
              <AppButton size="md" variant="outlined" :disabled="!selectedHasMaturityPolicy || policyInProgress !== null"
                      @click="clearMaturityPolicySelected">
                Clear Maturity
              </AppButton>
            </div>
          </div>
          <!-- Reset group -->
          <div>
            <div class="text-3xs uppercase tracking-wider mb-1.5 dd-text-muted">Reset</div>
            <div class="flex flex-wrap gap-2">
              <AppButton size="md" variant="outlined" :disabled="(selectedSkipTags.length === 0 && selectedSkipDigests.length === 0) || policyInProgress !== null"
                      @click="clearSkipsSelected">
                Clear Skips
              </AppButton>
              <AppButton size="md" variant="outlined" :disabled="Object.keys(selectedUpdatePolicy).length === 0 || policyInProgress !== null"
                      @click="confirmClearPolicy">
                Clear Policy
              </AppButton>
            </div>
          </div>
          <div class="space-y-1 text-2xs-plus dd-text-muted">
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
                      class="inline-flex items-center gap-1.5 px-2 py-1 dd-rounded text-2xs-plus font-mono"
                      :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text">{{ tag }}</span>
                  <AppButton size="none" variant="plain" weight="none" class="inline-flex items-center justify-center w-4 h-4 dd-rounded-sm transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          tooltip="Remove skip"
                          :disabled="policyInProgress !== null"
                          @click="removeSkipTagSelected(tag)">
                    <AppIcon name="xmark" :size="9" />
                  </AppButton>
                </span>
              </div>
            </div>
            <div v-if="selectedSkipDigests.length > 0">
              Skipped digests:
              <div class="mt-1 flex flex-wrap gap-1.5">
                <span v-for="digest in selectedSkipDigests" :key="`skip-digest-full-${digest}`"
                      class="inline-flex items-center gap-1.5 px-2 py-1 dd-rounded text-2xs-plus font-mono"
                      :style="{ backgroundColor: 'var(--dd-bg-inset)' }">
                  <span class="dd-text">{{ digest }}</span>
                  <AppButton size="none" variant="plain" weight="none" class="inline-flex items-center justify-center w-4 h-4 dd-rounded-sm transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated"
                          tooltip="Remove skip"
                          :disabled="policyInProgress !== null"
                          @click="removeSkipDigestSelected(digest)">
                    <AppIcon name="xmark" :size="9" />
                  </AppButton>
                </span>
              </div>
            </div>
            <div v-if="!selectedSnoozeUntil && selectedSkipTags.length === 0 && selectedSkipDigests.length === 0 && !selectedHasMaturityPolicy"
                  class="italic">
              No active update policy.
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
          <span class="dd-text-label dd-text-muted">Preview</span>
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
                <pre class="mt-1 p-2 dd-rounded whitespace-pre-wrap break-all text-2xs-plus dd-text font-mono"
                      :style="{ backgroundColor: 'var(--dd-bg-inset)' }">{{ detailComposePreview.patch }}</pre>
              </div>
            </template>
          </div>
          <div v-else class="dd-text-muted italic">
            Run a preview to inspect the planned update operations.
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
          <span class="dd-text-label dd-text-muted">Associated Triggers</span>
        </div>
        <div class="p-4 space-y-2">
          <div v-if="triggersLoading" class="text-xs dd-text-muted">Loading triggers...</div>
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
                {{ triggerRunInProgress === getTriggerKey(trigger) ? 'Running...' : 'Run' }}
              </AppButton>
            </div>
          </div>
          <p v-else class="text-xs dd-text-muted italic">No triggers associated with this container</p>
          <p v-if="triggerMessage" class="text-2xs-plus" style="color: var(--dd-success);">{{ triggerMessage }}</p>
          <p v-if="triggerError" class="text-2xs-plus" style="color: var(--dd-danger);">{{ triggerError }}</p>
        </div>
      </div>

      <div class="dd-rounded overflow-hidden"
            :style="{ backgroundColor: 'var(--dd-bg-card)' }">
        <div class="px-4 py-3 flex items-center gap-2">
          <AppIcon name="recent-updates" :size="12" class="dd-text-muted" />
          <span class="dd-text-label dd-text-muted">Backups &amp; Rollback</span>
        </div>
        <div class="p-4 space-y-2">
          <div>
            <AppButton size="md" variant="outlined" :disabled="backupsLoading || detailBackups.length === 0 || rollbackInProgress !== null"
                    @click="confirmRollback()">
              {{ rollbackInProgress === 'latest' ? 'Rolling back...' : 'Rollback Latest' }}
            </AppButton>
          </div>
          <div v-if="backupsLoading" class="text-xs dd-text-muted">Loading backups...</div>
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
                {{ rollbackInProgress === backup.id ? 'Rolling...' : 'Use' }}
              </AppButton>
            </div>
          </div>
          <p v-else class="text-xs dd-text-muted italic">No backups available yet</p>
          <p v-if="rollbackMessage" class="text-2xs-plus" style="color: var(--dd-success);">{{ rollbackMessage }}</p>
          <p v-if="rollbackError" class="text-2xs-plus" style="color: var(--dd-danger);">{{ rollbackError }}</p>
        </div>
      </div>

      <div class="dd-rounded overflow-hidden"
            :style="{ backgroundColor: 'var(--dd-bg-card)' }">
        <div class="px-4 py-3 flex items-center gap-2">
          <AppIcon name="audit" :size="12" class="dd-text-muted" />
          <span class="dd-text-label dd-text-muted">Update Operation History</span>
        </div>
        <div class="p-4 space-y-2">
          <div v-if="updateOperationsLoading" class="text-xs dd-text-muted">Loading operation history...</div>
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
              <div class="text-2xs-plus dd-text-muted">
                {{ formatTimestamp(operation.updatedAt || operation.createdAt) }}
              </div>
            </div>
          </div>
          <p v-else class="text-xs dd-text-muted italic">No update operations recorded yet</p>
          <p v-if="updateOperationsError" class="text-2xs-plus" style="color: var(--dd-danger);">{{ updateOperationsError }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
