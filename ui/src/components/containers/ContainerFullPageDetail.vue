<script setup lang="ts">
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
  error,
  registryColorBg,
  registryColorText,
  registryLabel,
  updateKindColor,
  detailTabs,
  activeDetailTab,
} = useContainersViewTemplateContext();
</script>

<template>
  <div data-test="container-full-page-detail" class="flex flex-col flex-1 min-h-0 pr-2 sm:pr-[15px]">
    <div
      class="shrink-0 mb-4 dd-rounded overflow-hidden"
      :style="{
        backgroundColor: 'var(--dd-bg-card)',
        border: '1px solid var(--dd-border-strong)',
      }">
      <div class="px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div class="flex items-center gap-4 min-w-0">
          <button
            class="flex items-center gap-2 px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated shrink-0"
            :style="{ border: '1px solid var(--dd-border-strong)' }"
            @click="closeFullPage">
            <AppIcon name="arrow-left" :size="11" />
            Back
          </button>
          <div class="flex items-center gap-3 min-w-0">
            <div
              class="w-3 h-3 rounded-full shrink-0"
              :style="{ backgroundColor: selectedContainer.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
            <div class="min-w-0">
              <h1 class="text-base sm:text-lg font-bold truncate dd-text">
                {{ selectedContainer.name }}
              </h1>
              <div class="flex items-center gap-2 mt-0.5 flex-wrap">
                <span class="text-[11px] sm:text-[12px] font-mono dd-text-secondary truncate max-w-[180px] sm:max-w-none">
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
                  class="badge text-[9px] uppercase font-bold max-sm:hidden"
                  :style="{
                    backgroundColor: registryColorBg(selectedContainer.registry),
                    color: registryColorText(selectedContainer.registry),
                  }">
                  {{
                    registryLabel(
                      selectedContainer.registry,
                      selectedContainer.registryUrl,
                      selectedContainer.registryName,
                    )
                  }}
                </span>
                <span
                  v-if="selectedContainer.newTag"
                  class="badge text-[9px] max-sm:hidden"
                  :style="{
                    backgroundColor: updateKindColor(selectedContainer.updateKind).bg,
                    color: updateKindColor(selectedContainer.updateKind).text,
                  }">
                  {{ selectedContainer.updateKind }} update: {{ selectedContainer.newTag }}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button
            v-if="selectedContainer.status === 'running'"
            class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors"
            :class="actionInProgress === selectedContainer.name ? 'opacity-50 cursor-not-allowed' : ''"
            :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)', border: '1px solid var(--dd-danger)' }"
            :disabled="actionInProgress === selectedContainer.name"
            aria-label="Stop container"
            @click="confirmStop(selectedContainer.name)">
            <AppIcon :name="actionInProgress === selectedContainer.name ? 'spinner' : 'stop'" :size="12" :class="actionInProgress === selectedContainer.name ? 'dd-spin' : ''" />
            Stop
          </button>
          <button
            v-else
            class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors"
            :class="actionInProgress === selectedContainer.name ? 'opacity-50 cursor-not-allowed' : ''"
            :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)', border: '1px solid var(--dd-success)' }"
            :disabled="actionInProgress === selectedContainer.name"
            aria-label="Start container"
            @click="startContainer(selectedContainer.name)">
            <AppIcon :name="actionInProgress === selectedContainer.name ? 'spinner' : 'play'" :size="12" :class="actionInProgress === selectedContainer.name ? 'dd-spin' : ''" />
            Start
          </button>
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors"
            :class="actionInProgress === selectedContainer.name ? 'opacity-50 cursor-not-allowed' : 'dd-text-muted hover:dd-text'"
            :style="{ border: '1px solid var(--dd-border-strong)' }"
            :disabled="actionInProgress === selectedContainer.name"
            aria-label="Restart container"
            @click="confirmRestart(selectedContainer.name)">
            <AppIcon :name="actionInProgress === selectedContainer.name ? 'spinner' : 'restart'" :size="12" :class="actionInProgress === selectedContainer.name ? 'dd-spin' : ''" />
            Restart
          </button>
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors"
            :class="actionInProgress === selectedContainer.name ? 'opacity-50 cursor-not-allowed' : 'dd-text-muted hover:dd-text'"
            :style="{ border: '1px solid var(--dd-border-strong)' }"
            :disabled="actionInProgress === selectedContainer.name"
            aria-label="Scan container"
            @click="scanContainer(selectedContainer.name)">
            <AppIcon :name="actionInProgress === selectedContainer.name ? 'spinner' : 'security'" :size="12" :class="actionInProgress === selectedContainer.name ? 'dd-spin' : ''" />
            Scan
          </button>
          <button
            v-if="selectedContainer.newTag && selectedContainer.bouncer === 'blocked'"
            class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-bold transition-colors"
            :class="actionInProgress === selectedContainer.name ? 'opacity-50 cursor-not-allowed' : ''"
            :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)', border: '1px solid var(--dd-danger)' }"
            :disabled="actionInProgress === selectedContainer.name"
            aria-label="Update blocked by security scan"
            @click="confirmForceUpdate(selectedContainer.name)">
            <AppIcon name="lock" :size="12" />
            Blocked
          </button>
          <button
            v-else-if="selectedContainer.newTag"
            class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-bold transition-colors"
            :class="actionInProgress === selectedContainer.name ? 'opacity-50 cursor-not-allowed' : ''"
            :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)', border: '1px solid var(--dd-success)' }"
            :disabled="actionInProgress === selectedContainer.name"
            aria-label="Update container"
            @click="confirmUpdate(selectedContainer.name)">
            <AppIcon :name="actionInProgress === selectedContainer.name ? 'spinner' : 'cloud-download'" :size="12" :class="actionInProgress === selectedContainer.name ? 'dd-spin' : ''" />
            Update
          </button>
          <button
            class="flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors"
            :class="actionInProgress === selectedContainer.name ? 'opacity-50 cursor-not-allowed' : ''"
            :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)', border: '1px solid var(--dd-danger)' }"
            :disabled="actionInProgress === selectedContainer.name"
            aria-label="Delete container"
            @click="confirmDelete(selectedContainer.name)">
            <AppIcon :name="actionInProgress === selectedContainer.name ? 'spinner' : 'trash'" :size="12" :class="actionInProgress === selectedContainer.name ? 'dd-spin' : ''" />
            Delete
          </button>
        </div>
      </div>

      <div class="flex overflow-x-auto scrollbar-hide px-5 gap-1" :style="{ borderTop: '1px solid var(--dd-border)' }">
        <button
          v-for="tab in detailTabs"
          :key="tab.id"
          class="whitespace-nowrap shrink-0 px-4 py-3 text-[12px] font-medium transition-colors relative"
          :class="activeDetailTab === tab.id ? 'text-drydock-secondary' : 'dd-text-muted hover:dd-text'"
          @click="activeDetailTab = tab.id">
          <AppIcon :name="tab.icon" :size="12" class="mr-1.5" />
          {{ tab.label }}
          <div
            v-if="activeDetailTab === tab.id"
            class="absolute bottom-0 left-0 right-0 h-[2px] bg-drydock-secondary rounded-t-full" />
        </button>
      </div>
    </div>

    <div
      v-if="error"
      class="shrink-0 mb-4 px-4 py-3 dd-rounded-lg flex items-center gap-3 text-[12px] font-medium"
      :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)', border: '1px solid var(--dd-danger)' }">
      <AppIcon name="warning" :size="14" class="shrink-0" />
      <span class="min-w-0 break-words">{{ error }}</span>
      <button class="ml-auto shrink-0 hover:opacity-70 transition-opacity" aria-label="Dismiss error" @click="error = null">
        <AppIcon name="x" :size="12" />
      </button>
    </div>

    <ContainerFullPageTabContent />
  </div>
</template>
