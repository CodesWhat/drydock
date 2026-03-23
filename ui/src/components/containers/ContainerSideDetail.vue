<script setup lang="ts">
import AppIconButton from '@/components/AppIconButton.vue';
import AppBadge from '@/components/AppBadge.vue';
import AppTabBar from '@/components/AppTabBar.vue';
import StatusDot from '@/components/StatusDot.vue';
import ContainerSideTabContent from './ContainerSideTabContent.vue';
import { useContainersViewTemplateContext } from './containersViewTemplateContext';

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
  confirmStop,
  startContainer,
  confirmRestart,
  scanContainer,
  confirmUpdate,
  confirmForceUpdate,
  confirmDelete,
} = useContainersViewTemplateContext();
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
            :disabled="actionInProgress === selectedContainer.name"
            tooltip="Stop"
            @click="confirmStop(selectedContainer.name)" />
          <AppIconButton
            v-else
            icon="play"
            size="xs"
            variant="success"
            :disabled="actionInProgress === selectedContainer.name"
            tooltip="Start"
            @click="startContainer(selectedContainer.name)" />
          <AppIconButton
            icon="restart"
            size="xs"
            variant="muted"
            :disabled="actionInProgress === selectedContainer.name"
            tooltip="Restart"
            @click="confirmRestart(selectedContainer.name)" />
          <AppIconButton
            icon="security"
            size="xs"
            variant="secondary"
            :disabled="actionInProgress === selectedContainer.name"
            tooltip="Scan"
            @click="scanContainer(selectedContainer.name)" />
          <AppIconButton
            v-if="selectedContainer.newTag && selectedContainer.bouncer === 'blocked'"
            icon="lock"
            size="xs"
            variant="danger"
            :disabled="actionInProgress === selectedContainer.name"
            tooltip="Blocked — Force Update"
            @click="confirmForceUpdate(selectedContainer.name)" />
          <AppIconButton
            v-else-if="selectedContainer.newTag"
            icon="cloud-download"
            size="xs"
            variant="success"
            :disabled="actionInProgress === selectedContainer.name"
            tooltip="Update"
            @click="confirmUpdate(selectedContainer.name)" />
          <AppIconButton
            icon="trash"
            size="xs"
            variant="danger"
            :disabled="actionInProgress === selectedContainer.name"
            tooltip="Delete"
            @click="confirmDelete(selectedContainer.name)" />
        </div>
      </template>
      <template #header>
        <div class="flex items-center gap-2 min-w-0">
          <StatusDot
            :status="selectedContainer.status === 'running' ? 'running' : 'stopped'"
            size="lg" />
          <span class="text-sm font-bold truncate dd-text">
            {{ selectedContainer.name }}
          </span>
        </div>
      </template>
      <template #subtitle>
        <span class="text-2xs-plus font-mono dd-text-secondary">
          {{ selectedContainer.image }}:{{ selectedContainer.currentTag }}
        </span>
        <AppBadge
          :tone="selectedContainer.status === 'running' ? 'success' : 'danger'"
          size="xs">
          {{ selectedContainer.status }}
        </AppBadge>
        <AppBadge tone="neutral" size="xs">
          {{ selectedContainer.server }}
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
