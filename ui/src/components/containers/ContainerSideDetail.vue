<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import AppIconButton from '@/components/AppIconButton.vue';
import AppBadge from '@/components/AppBadge.vue';
import AppTabBar from '@/components/AppTabBar.vue';
import StatusDot from '@/components/StatusDot.vue';
import { hasTrackedContainerAction } from '../../utils/container-action-key';
import ContainerSideTabContent from './ContainerSideTabContent.vue';
import { useContainersViewTemplateContext } from './containersViewTemplateContext';

const { t } = useI18n();

const {
  selectedContainer,
  detailPanelOpen,
  isMobile,
  panelSize,
  closePanel,
  openFullPage,
  detailTabs,
  activeDetailTab,
  actionInProgress,
  isContainerUpdateInProgress,
  isContainerUpdateQueued,
  confirmStop,
  startContainer,
  confirmRestart,
  scanContainer,
  confirmUpdate,
  confirmForceUpdate,
  confirmDelete,
} = useContainersViewTemplateContext();

function isActionQueued(container: { id?: unknown; name?: unknown }) {
  return isContainerUpdateQueued(container);
}

function isActionInProgress(container: { id?: unknown; name?: unknown }) {
  return (
    hasTrackedContainerAction(actionInProgress.value, container) ||
    isContainerUpdateInProgress(container)
  );
}

function isActionBlocked(container: { id?: unknown; name?: unknown }) {
  return isActionInProgress(container) || isActionQueued(container);
}

function getStatusLabel(container: { id?: unknown; name?: unknown; status?: string }) {
  if (isActionInProgress(container)) {
    return t('containerComponents.sideDetail.statusUpdating');
  }
  if (isActionQueued(container)) {
    return t('containerComponents.sideDetail.statusQueued');
  }
  return container.status ?? 'unknown';
}

function getStatusTone(container: { id?: unknown; name?: unknown; status?: string }) {
  if (isActionInProgress(container)) {
    return 'warning';
  }
  if (isActionQueued(container)) {
    return 'neutral';
  }
  return container.status === 'running' ? 'success' : 'danger';
}
</script>

<template>
  <div v-if="selectedContainer" data-test="container-side-detail">
    <DetailPanel
      v-if="selectedContainer"
      :open="detailPanelOpen"
      :is-mobile="isMobile"
      :size="panelSize"
      :show-size-controls="true"
      :show-full-page="true"
      @update:open="detailPanelOpen = $event; if (!$event) closePanel()"
      @update:size="panelSize = $event"
      @full-page="openFullPage">
      <template #toolbar>
        <div class="flex items-center gap-0.5">
          <AppIconButton
            v-if="selectedContainer.status === 'running'"
            icon="stop"
            size="xs"
            variant="danger"
            :disabled="isActionBlocked(selectedContainer)"
            :tooltip="t('containerComponents.sideDetail.stopTooltip')"
            @click="confirmStop(selectedContainer)" />
          <AppIconButton
            v-else
            icon="play"
            size="xs"
            variant="success"
            :disabled="isActionBlocked(selectedContainer)"
            :tooltip="t('containerComponents.sideDetail.startTooltip')"
            @click="startContainer(selectedContainer)" />
          <AppIconButton
            icon="restart"
            size="xs"
            variant="muted"
            :disabled="isActionBlocked(selectedContainer)"
            :tooltip="t('containerComponents.sideDetail.restartTooltip')"
            @click="confirmRestart(selectedContainer)" />
          <AppIconButton
            icon="security"
            size="xs"
            variant="secondary"
            :disabled="isActionBlocked(selectedContainer)"
            :tooltip="t('containerComponents.sideDetail.scanTooltip')"
            @click="scanContainer(selectedContainer)" />
          <AppIconButton
            v-if="selectedContainer.newTag && selectedContainer.bouncer === 'blocked'"
            icon="lock"
            size="xs"
            variant="danger"
            :disabled="isActionBlocked(selectedContainer)"
            :tooltip="t('containerComponents.sideDetail.blockedForceUpdateTooltip')"
            @click="confirmForceUpdate(selectedContainer)" />
          <AppIconButton
            v-else-if="selectedContainer.newTag"
            icon="cloud-download"
            size="xs"
            variant="success"
            :disabled="isActionBlocked(selectedContainer)"
            :tooltip="t('containerComponents.sideDetail.updateTooltip')"
            @click="confirmUpdate(selectedContainer)" />
          <AppIconButton
            icon="trash"
            size="xs"
            variant="danger"
            :disabled="isActionBlocked(selectedContainer)"
            :tooltip="t('containerComponents.sideDetail.deleteTooltip')"
            @click="confirmDelete(selectedContainer)" />
        </div>
      </template>
      <template #header>
        <div class="flex items-center gap-2 min-w-0">
          <StatusDot
            :status="isActionBlocked(selectedContainer) ? 'warning' : selectedContainer.status === 'running' ? 'running' : 'stopped'"
            :pulse="isActionInProgress(selectedContainer)"
            v-tooltip.top="getStatusLabel(selectedContainer)"
            size="lg" />
          <span class="text-sm font-bold truncate dd-text">
            {{ selectedContainer.name }}
          </span>
        </div>
      </template>
      <template #subtitle>
        <span
          class="block max-w-[220px] truncate text-2xs-plus font-mono dd-text-secondary"
          v-tooltip.top="`${selectedContainer.image}:${selectedContainer.currentTag}`"
        >
          {{ selectedContainer.image }}:{{ selectedContainer.currentTag }}
        </span>
        <AppBadge
          :tone="getStatusTone(selectedContainer)"
          size="xs">
          <AppIcon
            v-if="isActionInProgress(selectedContainer)"
            name="spinner"
            :size="12"
            class="mr-1 dd-spin" />
          <AppIcon
            v-else-if="isActionQueued(selectedContainer)"
            name="clock"
            :size="12"
            class="mr-1" />
          {{ getStatusLabel(selectedContainer) }}
        </AppBadge>
        <AppBadge tone="neutral" size="xs" v-tooltip.top="selectedContainer.server">
          <span class="block max-w-[160px] truncate">
            {{ selectedContainer.server }}
          </span>
        </AppBadge>
      </template>
      <template #tabs>
        <div class="shrink-0 px-4">
          <AppTabBar
            :tabs="detailTabs"
            :model-value="activeDetailTab"
            :size="panelSize === 'sm' ? 'compact' : 'default'"
            :icon-only="panelSize === 'sm'"
            @update:model-value="activeDetailTab = $event" />
        </div>
      </template>

      <ContainerSideTabContent />
    </DetailPanel>
  </div>
</template>
