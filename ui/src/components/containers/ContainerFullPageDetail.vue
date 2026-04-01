<script setup lang="ts">
import AppBadge from '@/components/AppBadge.vue';
import AppIconButton from '@/components/AppIconButton.vue';
import AppTabBar from '@/components/AppTabBar.vue';
import StatusDot from '@/components/StatusDot.vue';
import { getContainerActionKey } from '../../utils/container-action-key';
import ContainerFullPageTabContent from './ContainerFullPageTabContent.vue';
import { useContainersViewTemplateContext } from './containersViewTemplateContext';

const {
  selectedContainer,
  closeFullPage,
  confirmStop,
  startContainer,
  confirmRestart,
  scanContainer,
  confirmUpdate,
  confirmForceUpdate,
  confirmDelete,
  actionInProgress,
  isContainerUpdateInProgress,
  error,
  registryColorBg,
  registryColorText,
  registryLabel,
  updateKindColor,
  detailTabs,
  activeDetailTab,
} = useContainersViewTemplateContext();

function isActionInProgress(container: { id?: unknown; name?: unknown }) {
  return (
    actionInProgress.value.has(getContainerActionKey(container)) ||
    isContainerUpdateInProgress(container)
  );
}

function getStatusLabel(container: { id?: unknown; name?: unknown; status?: string }) {
  return isActionInProgress(container) ? 'Updating' : (container.status ?? 'unknown');
}

function getStatusTone(container: { id?: unknown; name?: unknown; status?: string }) {
  return isActionInProgress(container)
    ? 'warning'
    : container.status === 'running'
      ? 'success'
      : 'danger';
}
</script>

<template>
  <div data-test="container-full-page-detail" class="flex flex-col flex-1 min-h-0 overflow-hidden pr-2 sm:pr-[15px]">
    <div
      class="shrink-0 mb-4 dd-rounded overflow-hidden"
      :style="{
        backgroundColor: 'var(--dd-bg-card)',
      }">
      <div class="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div class="flex items-center gap-4 min-w-0">
          <AppButton size="none" variant="plain" weight="none"
            class="flex items-center gap-2 px-3 py-1.5 dd-rounded text-2xs-plus font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated shrink-0"
            @click="closeFullPage">
            <AppIcon name="arrow-left" :size="11" />
            Back
          </AppButton>
          <div class="flex items-center gap-3 min-w-0">
            <StatusDot
              :status="isActionInProgress(selectedContainer) ? 'warning' : selectedContainer.status === 'running' ? 'running' : 'stopped'"
              :pulse="isActionInProgress(selectedContainer)"
              v-tooltip.top="getStatusLabel(selectedContainer)"
              size="lg" />
            <div class="min-w-0">
              <h1 class="text-base sm:text-lg font-bold truncate dd-text">
                {{ selectedContainer.name }}
              </h1>
              <div class="flex items-center gap-2 mt-0.5 flex-wrap">
                <span class="text-2xs-plus sm:text-xs font-mono dd-text-secondary truncate max-w-[180px] sm:max-w-none">
                  {{ selectedContainer.image }}:{{ selectedContainer.currentTag }}
                </span>
                <AppBadge
                  :tone="getStatusTone(selectedContainer)"
                  size="xs">
                  {{ getStatusLabel(selectedContainer) }}
                </AppBadge>
                <AppBadge
                  size="xs"
                  :custom="{
                    bg: registryColorBg(selectedContainer.registry),
                    text: registryColorText(selectedContainer.registry),
                  }"
                  class="max-sm:hidden">
                  {{
                    registryLabel(
                      selectedContainer.registry,
                      selectedContainer.registryUrl,
                      selectedContainer.registryName,
                    )
                  }}
                </AppBadge>
                <AppBadge
                  v-if="selectedContainer.newTag"
                  size="xs"
                  :custom="{
                    bg: updateKindColor(selectedContainer.updateKind).bg,
                    text: updateKindColor(selectedContainer.updateKind).text,
                  }"
                  class="max-sm:hidden">
                  {{ selectedContainer.updateKind }} update: {{ selectedContainer.newTag }}
                </AppBadge>
              </div>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <AppButton size="none" variant="plain" weight="none"
            v-if="selectedContainer.status === 'running'"
            class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-2xs-plus font-semibold transition-colors"
            :class="isActionInProgress(selectedContainer) ? 'opacity-50 cursor-not-allowed' : ''"
            :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)', border: '1px solid var(--dd-danger)' }"
            :disabled="isActionInProgress(selectedContainer)"
            aria-label="Stop container"
            @click="confirmStop(selectedContainer)">
            <AppIcon :name="isActionInProgress(selectedContainer) ? 'spinner' : 'stop'" :size="12" :class="isActionInProgress(selectedContainer) ? 'dd-spin' : ''" />
            Stop
          </AppButton>
          <AppButton size="none" variant="plain" weight="none"
            v-else
            class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-2xs-plus font-semibold transition-colors"
            :class="isActionInProgress(selectedContainer) ? 'opacity-50 cursor-not-allowed' : ''"
            :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)', border: '1px solid var(--dd-success)' }"
            :disabled="isActionInProgress(selectedContainer)"
            aria-label="Start container"
            @click="startContainer(selectedContainer)">
            <AppIcon :name="isActionInProgress(selectedContainer) ? 'spinner' : 'play'" :size="12" :class="isActionInProgress(selectedContainer) ? 'dd-spin' : ''" />
            Start
          </AppButton>
          <AppButton size="none" variant="plain" weight="none"
            class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-2xs-plus font-semibold transition-colors"
            :class="isActionInProgress(selectedContainer) ? 'opacity-50 cursor-not-allowed' : 'dd-text-muted hover:dd-text'"
            :disabled="isActionInProgress(selectedContainer)"
            aria-label="Restart container"
            @click="confirmRestart(selectedContainer)">
            <AppIcon :name="isActionInProgress(selectedContainer) ? 'spinner' : 'restart'" :size="12" :class="isActionInProgress(selectedContainer) ? 'dd-spin' : ''" />
            Restart
          </AppButton>
          <AppButton size="none" variant="plain" weight="none"
            class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-2xs-plus font-semibold transition-colors"
            :class="isActionInProgress(selectedContainer) ? 'opacity-50 cursor-not-allowed' : 'dd-text-muted hover:dd-text'"
            :disabled="isActionInProgress(selectedContainer)"
            aria-label="Scan container"
            @click="scanContainer(selectedContainer)">
            <AppIcon :name="isActionInProgress(selectedContainer) ? 'spinner' : 'security'" :size="12" :class="isActionInProgress(selectedContainer) ? 'dd-spin' : ''" />
            Scan
          </AppButton>
          <AppButton size="none" variant="plain" weight="none"
            v-if="selectedContainer.newTag && selectedContainer.bouncer === 'blocked'"
            class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-2xs-plus font-bold transition-colors"
            :class="isActionInProgress(selectedContainer) ? 'opacity-50 cursor-not-allowed' : ''"
            :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)', border: '1px solid var(--dd-danger)' }"
            :disabled="isActionInProgress(selectedContainer)"
            aria-label="Update blocked by security scan"
            @click="confirmForceUpdate(selectedContainer)">
            <AppIcon name="lock" :size="12" />
            Blocked
          </AppButton>
          <AppButton size="none" variant="plain" weight="none"
            v-else-if="selectedContainer.newTag"
            class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-2xs-plus font-bold transition-colors"
            :class="isActionInProgress(selectedContainer) ? 'opacity-50 cursor-not-allowed' : ''"
            :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)', border: '1px solid var(--dd-success)' }"
            :disabled="isActionInProgress(selectedContainer)"
            aria-label="Update container"
            @click="confirmUpdate(selectedContainer)">
            <AppIcon :name="isActionInProgress(selectedContainer) ? 'spinner' : 'cloud-download'" :size="12" :class="isActionInProgress(selectedContainer) ? 'dd-spin' : ''" />
            Update
          </AppButton>
          <AppButton size="none" variant="plain" weight="none"
            class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-2xs-plus font-semibold transition-colors"
            :class="isActionInProgress(selectedContainer) ? 'opacity-50 cursor-not-allowed' : ''"
            :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)', border: '1px solid var(--dd-danger)' }"
            :disabled="isActionInProgress(selectedContainer)"
            aria-label="Delete container"
            @click="confirmDelete(selectedContainer)">
            <AppIcon :name="isActionInProgress(selectedContainer) ? 'spinner' : 'trash'" :size="12" :class="isActionInProgress(selectedContainer) ? 'dd-spin' : ''" />
            Delete
          </AppButton>
        </div>
      </div>

      <div class="px-5">
        <AppTabBar
          :tabs="detailTabs"
          :model-value="activeDetailTab"
          @update:model-value="activeDetailTab = $event" />
      </div>
    </div>

    <div
      v-if="error"
      class="shrink-0 mb-4 px-4 py-3 dd-rounded-lg flex items-center gap-3 text-xs font-medium"
      :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)', border: '1px solid var(--dd-danger)' }">
      <AppIcon name="warning" :size="14" class="shrink-0" />
      <span class="min-w-0 break-words">{{ error }}</span>
      <AppIconButton icon="x" size="toolbar" variant="plain"
              class="ml-auto shrink-0 hover:opacity-70"
              aria-label="Dismiss error"
              @click="error = null" />
    </div>

    <ContainerFullPageTabContent />
  </div>
</template>
