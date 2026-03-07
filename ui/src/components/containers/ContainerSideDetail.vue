<script setup lang="ts">
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
  confirmStop,
  startContainer,
  confirmRestart,
  scanContainer,
  updateContainer,
  confirmDelete,
  tt,
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
          <button
            v-if="selectedContainer.status === 'running'"
            class="w-7 h-7 dd-rounded flex items-center justify-center transition-[color,background-color,border-color,opacity,transform,box-shadow] dd-text-muted hover:dd-text-danger hover:dd-bg-hover hover:scale-110 active:scale-95"
            v-tooltip.top="tt('Stop')"
            @click="confirmStop(selectedContainer.name)">
            <AppIcon name="stop" :size="12" />
          </button>
          <button
            v-else
            class="w-7 h-7 dd-rounded flex items-center justify-center transition-[color,background-color,border-color,opacity,transform,box-shadow] dd-text-muted hover:dd-text-success hover:dd-bg-hover hover:scale-110 active:scale-95"
            v-tooltip.top="tt('Start')"
            @click="startContainer(selectedContainer.name)">
            <AppIcon name="play" :size="12" />
          </button>
          <button
            class="w-7 h-7 dd-rounded flex items-center justify-center transition-[color,background-color,border-color,opacity,transform,box-shadow] dd-text-muted hover:dd-text hover:dd-bg-hover hover:scale-110 active:scale-95"
            v-tooltip.top="tt('Restart')"
            @click="confirmRestart(selectedContainer.name)">
            <AppIcon name="restart" :size="12" />
          </button>
          <button
            class="w-7 h-7 dd-rounded flex items-center justify-center transition-[color,background-color,border-color,opacity,transform,box-shadow] dd-text-muted hover:dd-text-secondary hover:dd-bg-hover hover:scale-110 active:scale-95"
            v-tooltip.top="tt('Scan')"
            @click="scanContainer(selectedContainer.name)">
            <AppIcon name="security" :size="12" />
          </button>
          <button
            v-if="selectedContainer.newTag"
            class="w-7 h-7 dd-rounded flex items-center justify-center transition-[color,background-color,border-color,opacity,transform,box-shadow] dd-text-muted hover:dd-text-success hover:dd-bg-hover hover:scale-110 active:scale-95"
            v-tooltip.top="tt('Update')"
            @click="updateContainer(selectedContainer.name)">
            <AppIcon name="cloud-download" :size="14" />
          </button>
          <button
            class="w-7 h-7 dd-rounded flex items-center justify-center transition-[color,background-color,border-color,opacity,transform,box-shadow] dd-text-muted hover:dd-text-danger hover:dd-bg-hover hover:scale-110 active:scale-95"
            v-tooltip.top="tt('Delete')"
            @click="confirmDelete(selectedContainer.name)">
            <AppIcon name="trash" :size="12" />
          </button>
        </div>
      </template>
      <template #header>
        <div class="flex items-center gap-2 min-w-0">
          <div
            class="w-2.5 h-2.5 rounded-full shrink-0"
            :style="{ backgroundColor: selectedContainer.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
          <span class="text-sm font-bold truncate dd-text">
            {{ selectedContainer.name }}
          </span>
        </div>
      </template>
      <template #subtitle>
        <span class="text-[11px] font-mono dd-text-secondary">
          {{ selectedContainer.image }}:{{ selectedContainer.currentTag }}
        </span>
        <span
          class="badge text-[9px]"
          :style="{
            backgroundColor:
              selectedContainer.status === 'running'
                ? 'var(--dd-success-muted)'
                : 'var(--dd-danger-muted)',
            color: selectedContainer.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)',
          }">
          {{ selectedContainer.status }}
        </span>
        <span
          class="badge text-[9px] font-medium"
          :style="{ backgroundColor: 'var(--dd-neutral-muted)', color: 'var(--dd-text-secondary)' }">
          {{ selectedContainer.server }}
        </span>
      </template>
      <template #tabs>
        <div
          class="shrink-0 flex overflow-x-auto scrollbar-hide px-4 gap-1"
          :style="{ borderBottom: '1px solid var(--dd-border)' }">
          <button
            v-for="tab in detailTabs"
            :key="tab.id"
            class="whitespace-nowrap shrink-0 py-2.5 text-[11px] font-medium transition-colors relative"
            :class="[
              activeDetailTab === tab.id ? 'text-drydock-secondary' : 'dd-text-muted hover:dd-text',
              panelSize === 'sm' ? 'px-2' : 'px-3',
            ]"
            v-tooltip.top="panelSize === 'sm' ? tt(tab.label) : undefined"
            @click="activeDetailTab = tab.id">
            <AppIcon :name="tab.icon" :size="12" :class="panelSize === 'sm' ? '' : 'mr-1'" />
            <template v-if="panelSize !== 'sm'">{{ tab.label }}</template>
            <div
              v-if="activeDetailTab === tab.id"
              class="absolute bottom-0 left-0 right-0 h-[2px] bg-drydock-secondary rounded-t-full" />
          </button>
        </div>
      </template>

      <ContainerSideTabContent />
    </DetailPanel>
  </div>
</template>
