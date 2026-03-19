<script setup lang="ts">
import { useContainersViewTemplateContext } from './containersViewTemplateContext';
import { getContainerViewKey } from '../../utils/container-view-key';
import { imageAge } from '../../utils/audit-helpers';
import UpdateMaturityBadge from './UpdateMaturityBadge.vue';
import SuggestedTagBadge from './SuggestedTagBadge.vue';
import ReleaseNotesLink from './ReleaseNotesLink.vue';

const {
  filteredContainers,
  renderGroups,
  groupByStack,
  toggleGroupCollapse,
  collapsedGroups,
  groupUpdateInProgress,
  containerActionsEnabled,
  containerActionsDisabledReason,
  actionInProgress,
  updateAllInGroup,
  tt,
  containerViewMode,
  tableColumns,
  containerSortKey,
  containerSortAsc,
  selectedContainer,
  isCompact,
  selectContainer,
  tableActionStyle,
  openActionsMenu,
  toggleActionsMenu,
  confirmUpdate,
  confirmStop,
  startContainer,
  confirmRestart,
  scanContainer,
  confirmForceUpdate,
  skipUpdate,
  closeActionsMenu,
  confirmDelete,
  displayContainers,
  actionsMenuStyle,
  updateKindColor,
  hasRegistryError,
  registryErrorTooltip,
  containerPolicyTooltip,
  getContainerListPolicyState,
  serverBadgeColor,
  parseServer,
  registryColorBg,
  registryColorText,
  registryLabel,
  activeFilterCount,
  filterSearch,
  clearFilters,
} = useContainersViewTemplateContext();
</script>

<template>
  <div data-test="containers-grouped-views">
      <!-- GROUPED / FLAT CONTAINER VIEWS -->
      <template v-if="filteredContainers.length > 0">
      <template v-for="group in renderGroups" :key="group.key">

        <!-- Group header (only shown when grouping is active) -->
        <div v-if="groupByStack && group.key !== '__flat__'"
             class="flex items-center gap-2 px-3 py-2.5 mb-3 cursor-pointer select-none dd-rounded transition-colors hover:dd-bg-elevated"
             :style="{ backgroundColor: 'var(--dd-bg-elevated)' }"
             :class="group.key === renderGroups[0]?.key ? '' : 'mt-6'"
             role="button"
             tabindex="0"
             @keydown.enter.space.prevent="toggleGroupCollapse(group.key)"
             @click="toggleGroupCollapse(group.key)">
          <AppIcon :name="collapsedGroups.has(group.key) ? 'chevron-right' : 'chevron-down'" :size="10" class="dd-text-muted shrink-0" />
          <AppIcon name="stack" :size="12" class="dd-text-muted shrink-0" />
          <span class="text-xs font-semibold dd-text">{{ group.name ?? 'Ungrouped' }}</span>
          <span class="badge text-3xs font-bold dd-bg-elevated dd-text-muted">{{ group.containerCount }}</span>
          <span v-if="group.updatesAvailable > 0" class="badge text-3xs font-bold"
                :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' }">
            {{ group.updatesAvailable }} update{{ group.updatesAvailable === 1 ? '' : 's' }}
          </span>
          <AppButton size="none" variant="plain" weight="none"
            v-if="group.updatableCount > 0 || !containerActionsEnabled"
            class="ml-auto inline-flex items-center justify-center px-2 py-1 dd-rounded border text-2xs font-semibold transition-colors"
            :class="!containerActionsEnabled || groupUpdateInProgress.has(group.key) || actionInProgress
              ? 'dd-text-muted cursor-not-allowed opacity-60'
              : 'dd-text hover:dd-bg-elevated'"
            :disabled="!containerActionsEnabled || groupUpdateInProgress.has(group.key) || actionInProgress !== null"
            v-tooltip.top="tt(containerActionsEnabled ? 'Update all in group' : containerActionsDisabledReason)"
            @click.stop="updateAllInGroup(group)">
            <AppIcon
              :name="!containerActionsEnabled ? 'lock' : groupUpdateInProgress.has(group.key) ? 'spinner' : 'cloud-download'"
              :size="11"
              class="mr-1"
              :class="!containerActionsEnabled ? '' : groupUpdateInProgress.has(group.key) ? 'dd-spin' : ''" />
            {{ containerActionsEnabled ? 'Update all' : 'Actions disabled' }}
          </AppButton>
        </div>

        <!-- Group body (collapsible) -->
        <div v-show="!collapsedGroups.has(group.key)">

      <!-- TABLE VIEW -->
      <DataTable v-if="containerViewMode === 'table'"
                 :columns="tableColumns"
                 :rows="group.containers"
                 :row-key="getContainerViewKey"
                 :sort-key="containerSortKey"
                 :sort-asc="containerSortAsc"
                 :selected-key="selectedContainer ? getContainerViewKey(selectedContainer) : null"
                 :show-actions="true"
                 :virtual-scroll="false"
                 @update:sort-key="containerSortKey = $event"
                 @update:sort-asc="containerSortAsc = $event"
                 @row-click="selectContainer($event)">
        <!-- Container icon (own column) -->
        <template #cell-icon="{ row: c }">
          <AppIcon v-if="c._pending || actionInProgress === c.name" name="spinner" :size="14" class="dd-spin dd-text-muted" />
          <ContainerIcon v-else :icon="c.icon" :size="20" />
        </template>

        <!-- Container name + image (+ compact actions & badges) -->
        <template #cell-name="{ row: c }">
          <div class="min-w-0" :class="{ 'opacity-50': c._pending }">
              <div class="flex items-center gap-2">
                <div class="font-medium truncate dd-text flex-1">{{ c.name }}</div>
              </div>
              <div class="text-2xs mt-0.5 truncate dd-text-muted">{{ c.image }}</div>
              <!-- Compact mode: folded badge row -->
              <div v-if="isCompact" class="flex items-center gap-1.5 mt-1.5 min-w-0 overflow-hidden">
                <span v-if="c.newTag" class="inline-flex items-center gap-0.5 text-3xs font-semibold dd-text-secondary min-w-0">
                  <span class="truncate max-w-[80px]">{{ c.currentTag }}</span>
                  <AppIcon name="arrow-right" :size="11" class="dd-text-muted mx-0.5 shrink-0" />
                  <CopyableTag :tag="c.newTag" class="truncate max-w-[100px]" style="color: var(--dd-primary);" @click.stop>{{ c.newTag }}</CopyableTag>
                </span>
                <span
                  v-else-if="c.noUpdateReason"
                  class="inline-flex items-center gap-1 text-3xs min-w-0"
                  style="color: var(--dd-warning);"
                  v-tooltip.top="c.noUpdateReason"
                >
                  <AppIcon name="warning" :size="10" class="shrink-0" />
                  <span class="truncate max-w-[130px]">{{ c.noUpdateReason }}</span>
                </span>
                <div class="flex items-center gap-1.5 ml-auto shrink-0">
                <span v-if="c.updateKind" class="badge px-1.5 py-0 text-3xs"
                      :style="{ backgroundColor: updateKindColor(c.updateKind).bg, color: updateKindColor(c.updateKind).text }"
                      v-tooltip.top="tt(c.updateKind)">
                  <AppIcon :name="c.updateKind === 'major' ? 'chevrons-up' : c.updateKind === 'minor' ? 'chevron-up' : c.updateKind === 'patch' ? 'hashtag' : 'fingerprint'" :size="12" />
                </span>
                <UpdateMaturityBadge :maturity="c.updateMaturity" :tooltip="c.updateMaturityTooltip" size="sm" />
                <SuggestedTagBadge :tag="c.suggestedTag" :current-tag="c.currentTag" />
                <span v-if="c.bouncer === 'blocked'" class="badge px-1.5 py-0 text-3xs"
                      style="background: var(--dd-danger-muted); color: var(--dd-danger);"
                      v-tooltip.top="tt('Blocked')">
                  <AppIcon name="blocked" :size="12" />
                </span>
                <span v-else-if="c.bouncer !== 'safe'" class="badge px-1.5 py-0 text-3xs"
                      style="background: var(--dd-warning-muted); color: var(--dd-warning);"
                      v-tooltip.top="tt(c.bouncer)">
                  <AppIcon name="warning" :size="12" />
                </span>
                <span v-if="hasRegistryError(c)" class="badge px-1.5 py-0 text-3xs"
                      style="background: var(--dd-danger-muted); color: var(--dd-danger);"
                      aria-label="Registry error"
                      v-tooltip.top="tt(registryErrorTooltip(c))">
                  <AppIcon name="warning" :size="12" />
                </span>
                <span v-if="getContainerListPolicyState(c.name).snoozed"
                      class="badge px-1.5 py-0 text-3xs"
                      style="background: var(--dd-info-muted); color: var(--dd-info);"
                      aria-label="Snoozed updates"
                      v-tooltip.top="tt(containerPolicyTooltip(c.name, 'snoozed'))">
                  <AppIcon name="pause" :size="12" />
                </span>
                <span v-if="getContainerListPolicyState(c.name).skipped"
                      class="badge px-1.5 py-0 text-3xs"
                      style="background: var(--dd-warning-muted); color: var(--dd-warning);"
                      aria-label="Skipped updates"
                      v-tooltip.top="tt(containerPolicyTooltip(c.name, 'skipped'))">
                  <AppIcon name="skip-forward" :size="12" />
                </span>
                <span v-if="getContainerListPolicyState(c.name).maturityBlocked"
                      class="badge px-1.5 py-0 text-3xs"
                      style="background: var(--dd-primary-muted); color: var(--dd-primary);"
                      aria-label="Maturity-blocked updates"
                      v-tooltip.top="tt(containerPolicyTooltip(c.name, 'maturity'))">
                  <AppIcon name="clock" :size="12" />
                </span>
                <span class="badge px-1.5 py-0 text-3xs"
                      :style="{
                        backgroundColor: c.status === 'running' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                        color: c.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)',
                      }"
                      v-tooltip.top="tt(c.status)">
                  <AppIcon :name="c.status === 'running' ? 'play' : 'stop'" :size="12" />
                </span>
                <span class="badge px-1.5 py-0 text-3xs"
                      :style="{ backgroundColor: serverBadgeColor(c.server).bg, color: serverBadgeColor(c.server).text }">
                  <AppIcon :name="parseServer(c.server).name === 'Local' ? 'home' : 'remote'" :size="12" />
                </span>
                </div>
              </div>
          </div>
        </template>
        <!-- Version comparison -->
        <template #cell-version="{ row: c }">
          <div v-if="c.newTag" class="flex items-center justify-center gap-1.5 min-w-0 max-w-[260px]">
            <span class="text-2xs-plus dd-text-secondary truncate shrink-0 max-w-[100px]" v-tooltip.top="c.currentTag">{{ c.currentTag }}</span>
            <AppIcon name="arrow-right" :size="8" class="dd-text-muted shrink-0" />
            <CopyableTag :tag="c.newTag" class="text-2xs-plus font-semibold truncate max-w-[140px]" style="color: var(--dd-primary);" @click.stop>{{ c.newTag }}</CopyableTag>
          </div>
          <div v-else class="text-center">
            <span class="text-2xs-plus dd-text-secondary truncate block max-w-[140px] mx-auto" v-tooltip.top="c.currentTag">{{ c.currentTag }}</span>
            <div v-if="getContainerListPolicyState(c.name).snoozed || getContainerListPolicyState(c.name).skipped || getContainerListPolicyState(c.name).maturityBlocked"
                 class="mt-1 inline-flex items-center justify-center gap-1">
              <span v-if="getContainerListPolicyState(c.name).snoozed"
                    class="inline-flex items-center justify-center"
                    style="color: var(--dd-info);"
                    aria-label="Snoozed updates"
                    v-tooltip.top="tt(containerPolicyTooltip(c.name, 'snoozed'))">
                <AppIcon name="pause" :size="11" />
              </span>
              <span v-if="getContainerListPolicyState(c.name).skipped"
                    class="inline-flex items-center justify-center"
                    style="color: var(--dd-warning);"
                    aria-label="Skipped updates"
                    v-tooltip.top="tt(containerPolicyTooltip(c.name, 'skipped'))">
                <AppIcon name="skip-forward" :size="11" />
              </span>
              <span v-if="getContainerListPolicyState(c.name).maturityBlocked"
                    class="inline-flex items-center justify-center"
                    style="color: var(--dd-primary);"
                    aria-label="Maturity-blocked updates"
                    v-tooltip.top="tt(containerPolicyTooltip(c.name, 'maturity'))">
                <AppIcon name="clock" :size="11" />
              </span>
            </div>
            <div
              v-if="c.noUpdateReason"
              class="mt-1 inline-flex items-center gap-1 text-2xs max-w-[220px] justify-center"
              style="color: var(--dd-warning);"
              v-tooltip.top="c.noUpdateReason"
            >
              <AppIcon name="warning" :size="10" class="shrink-0" />
              <span class="truncate">{{ c.noUpdateReason }}</span>
            </div>
          </div>
        </template>
        <!-- Kind badge -->
        <template #cell-kind="{ row: c }">
          <div class="inline-flex items-center gap-1">
          <span v-if="c.updateKind" class="badge text-3xs uppercase font-bold"
                :style="{ backgroundColor: updateKindColor(c.updateKind).bg, color: updateKindColor(c.updateKind).text }">
            {{ c.updateKind }}
          </span>
          <UpdateMaturityBadge :maturity="c.updateMaturity" :tooltip="c.updateMaturityTooltip" />
          <SuggestedTagBadge :tag="c.suggestedTag" :current-tag="c.currentTag" />
          <span v-if="!c.updateKind && !c.updateMaturity && !(c.suggestedTag && (!c.currentTag || c.currentTag.toLowerCase() === 'latest'))" class="text-2xs dd-text-muted">&mdash;</span>
          </div>
        </template>
        <!-- Status -->
        <template #cell-status="{ row: c }">
          <AppIcon :name="c.status === 'running' ? 'play' : 'stop'" :size="13" class="shrink-0 md:!hidden"
                   :style="{ color: c.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
          <span class="badge text-3xs font-bold max-md:!hidden"
                :style="{
                  backgroundColor: c.status === 'running' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                  color: c.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)',
                }">
            {{ c.status }}
          </span>
        </template>
        <!-- Bouncer icon -->
        <template #cell-bouncer="{ row: c }">
          <span v-if="c.bouncer === 'safe'" class="dd-text-muted">–</span>
          <span v-else-if="c.bouncer === 'blocked'" v-tooltip.top="tt('Blocked')" class="cursor-default">
            <AppIcon name="blocked" :size="14" style="color: var(--dd-danger);" />
          </span>
          <span v-else v-tooltip.top="tt(c.bouncer)" class="cursor-default">
            <AppIcon name="warning" :size="14" style="color: var(--dd-warning);" />
          </span>
        </template>
        <!-- Image Age -->
        <template #cell-imageAge="{ row: c }">
          <span class="text-2xs-plus dd-text-secondary whitespace-nowrap"
                v-tooltip.top="c.imageCreated ? tt(new Date(c.imageCreated).toLocaleString()) : undefined">
            {{ imageAge(c.imageCreated) }}
          </span>
        </template>
        <!-- Server -->
        <template #cell-server="{ row: c }">
          <span class="badge text-3xs font-bold"
                :style="{ backgroundColor: serverBadgeColor(c.server).bg, color: serverBadgeColor(c.server).text }">
            {{ c.server }}
          </span>
        </template>
        <!-- Registry badge -->
        <template #cell-registry="{ row: c }">
          <div class="inline-flex items-center justify-center gap-1.5">
            <span class="badge text-3xs uppercase tracking-wide font-bold"
                  :style="{ backgroundColor: registryColorBg(c.registry), color: registryColorText(c.registry) }">
              {{ registryLabel(c.registry, c.registryUrl, c.registryName) }}
            </span>
            <span v-if="hasRegistryError(c)"
                  class="inline-flex items-center justify-center"
                  style="color: var(--dd-danger);"
                  aria-label="Registry error"
                  v-tooltip.top="tt(registryErrorTooltip(c))">
              <AppIcon name="warning" :size="12" />
            </span>
          </div>
        </template>
        <!-- Actions -->
        <template #actions="{ row: c }">
          <template v-if="!containerActionsEnabled">
            <div class="flex items-center justify-end gap-2">
              <span class="text-2xs dd-text-muted">Actions disabled</span>
              <AppButton size="none" variant="plain" weight="none"
                class="w-8 h-8 dd-rounded flex items-center justify-center cursor-not-allowed dd-text-muted opacity-60"
                :disabled="true"
                v-tooltip.top="tt(containerActionsDisabledReason)"
                @click.stop
              >
                <AppIcon name="lock" :size="13" />
              </AppButton>
            </div>
          </template>
          <!-- Icon-style actions (compact) -->
          <template v-else-if="tableActionStyle === 'icons'">
            <div class="flex items-center justify-end gap-0.5">
              <AppButton size="none" variant="plain" weight="none" v-if="c.newTag && c.bouncer === 'blocked'"
                      class="w-8 h-8 dd-rounded flex items-center justify-center transition-[color,background-color,border-color,opacity,transform,box-shadow] cursor-not-allowed dd-text-muted opacity-50"
                      v-tooltip.top="tt('Blocked by Bouncer')" @click.stop>
                <AppIcon name="lock" :size="13" />
              </AppButton>
              <AppButton size="none" variant="plain" weight="none" v-else-if="c.newTag"
                      class="w-8 h-8 dd-rounded flex items-center justify-center transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                      :class="actionInProgress === c.name ? 'dd-text-muted opacity-50 cursor-not-allowed' : 'dd-text-muted hover:dd-text-success hover:dd-bg-hover hover:scale-110 active:scale-95'"
                      :disabled="actionInProgress === c.name"
                      v-tooltip.top="tt('Update')" @click.stop="confirmUpdate(c.name)">
                <AppIcon name="cloud-download" :size="16" />
              </AppButton>
              <AppButton size="none" variant="plain" weight="none" v-else-if="c.status === 'running'"
                      class="w-8 h-8 dd-rounded flex items-center justify-center transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                      :class="actionInProgress === c.name ? 'dd-text-muted opacity-50 cursor-not-allowed' : 'dd-text-muted hover:dd-text-danger hover:dd-bg-hover hover:scale-110 active:scale-95'"
                      :disabled="actionInProgress === c.name"
                      v-tooltip.top="tt('Stop')" @click.stop="confirmStop(c.name)">
                <AppIcon name="stop" :size="14" />
              </AppButton>
              <AppButton size="none" variant="plain" weight="none" v-else
                      class="w-8 h-8 dd-rounded flex items-center justify-center transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                      :class="actionInProgress === c.name ? 'dd-text-muted opacity-50 cursor-not-allowed' : 'dd-text-muted hover:dd-text-success hover:dd-bg-hover hover:scale-110 active:scale-95'"
                      :disabled="actionInProgress === c.name"
                      v-tooltip.top="tt('Start')" @click.stop="startContainer(c.name)">
                <AppIcon name="play" :size="14" />
              </AppButton>
              <AppButton size="none" variant="plain" weight="none" class="w-8 h-8 dd-rounded flex items-center justify-center transition-[color,background-color,border-color,opacity,transform,box-shadow]"
                      :class="[
                        actionInProgress === c.name ? 'dd-text-muted opacity-50 cursor-not-allowed' : 'dd-text-muted hover:dd-text hover:dd-bg-hover hover:scale-110 active:scale-95',
                        openActionsMenu === c.name && actionInProgress !== c.name ? 'dd-bg-elevated dd-text' : '',
                      ]"
                      :disabled="actionInProgress === c.name"
                      v-tooltip.top="tt('More')" @click.stop="toggleActionsMenu(c.name, $event)">
                <AppIcon name="more" :size="13" />
              </AppButton>
            </div>
          </template>
          <!-- Button-style actions (full) -->
          <template v-else>
            <div v-if="c.newTag" class="inline-flex items-center gap-1">
              <!-- Blocked: muted split button -->
              <div v-if="c.bouncer === 'blocked'" class="inline-flex dd-rounded overflow-hidden" style="min-width: 110px;"
>
                <AppButton size="none" variant="plain" weight="none" class="inline-flex items-center justify-center flex-1 whitespace-nowrap px-3 py-1.5 text-2xs-plus font-bold tracking-wide cursor-not-allowed"
                        :style="{ backgroundColor: 'var(--dd-bg)', color: 'var(--dd-text-muted)' }">
                  <AppIcon name="lock" :size="11" class="mr-1" /> Blocked
                </AppButton>
                <AppButton size="none" variant="plain" weight="none" class="inline-flex items-center justify-center w-7 transition-colors dd-text-muted hover:dd-text hover:dd-bg-hover"
                        :style="{ backgroundColor: 'var(--dd-bg)' }"
                        :class="openActionsMenu === c.name ? 'dd-bg-elevated dd-text' : ''"
                        @click.stop="toggleActionsMenu(c.name, $event)">
                  <AppIcon name="chevron-down" :size="11" />
                </AppButton>
              </div>
              <!-- Updatable: split button -->
              <div v-else class="inline-flex dd-rounded overflow-hidden"
                   :class="actionInProgress === c.name ? 'opacity-50' : ''"
                   :style="{ border: '1px solid var(--dd-success)' }">
                <AppButton size="none" variant="plain" weight="none" class="inline-flex items-center justify-center whitespace-nowrap px-3 py-1.5 text-2xs-plus font-bold tracking-wide transition-colors"
                        :class="actionInProgress === c.name ? 'cursor-not-allowed' : ''"
                        :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)' }"
                        :disabled="actionInProgress === c.name"
                        @click.stop="confirmUpdate(c.name)">
                  <AppIcon name="cloud-download" :size="11" class="mr-1" /> Update
                </AppButton>
                <AppButton size="none" variant="plain" weight="none" class="inline-flex items-center justify-center w-7 transition-colors"
                        :class="actionInProgress === c.name ? 'cursor-not-allowed' : openActionsMenu === c.name ? 'brightness-125' : ''"
                        :style="{ backgroundColor: 'var(--dd-success-muted)', color: 'var(--dd-success)', borderLeft: '1px solid var(--dd-success)' }"
                        :disabled="actionInProgress === c.name"
                        @click.stop="toggleActionsMenu(c.name, $event)">
                  <AppIcon name="chevron-down" :size="11" />
                </AppButton>
              </div>
            </div>
            <div v-else class="flex items-center justify-end gap-1">
              <AppButton size="none" variant="plain" weight="none" v-if="c.status === 'running'"
                      class="w-6 h-6 dd-rounded-sm flex items-center justify-center transition-colors"
                      :class="actionInProgress === c.name ? 'dd-text-muted opacity-50 cursor-not-allowed' : 'dd-text-muted hover:dd-text-danger hover:dd-bg-hover'"
                      :disabled="actionInProgress === c.name"
                      v-tooltip.top="tt('Stop')" @click.stop="confirmStop(c.name)">
                <AppIcon name="stop" :size="11" />
              </AppButton>
              <AppButton size="none" variant="plain" weight="none" v-else
                      class="w-6 h-6 dd-rounded-sm flex items-center justify-center transition-colors"
                      :class="actionInProgress === c.name ? 'dd-text-muted opacity-50 cursor-not-allowed' : 'dd-text-muted hover:dd-text-success hover:dd-bg-hover'"
                      :disabled="actionInProgress === c.name"
                      v-tooltip.top="tt('Start')" @click.stop="startContainer(c.name)">
                <AppIcon name="play" :size="11" />
              </AppButton>
              <AppButton size="none" variant="plain" weight="none" class="w-6 h-6 dd-rounded-sm flex items-center justify-center transition-colors"
                      :class="actionInProgress === c.name ? 'dd-text-muted opacity-50 cursor-not-allowed' : 'dd-text-muted hover:dd-text hover:dd-bg-hover'"
                      :disabled="actionInProgress === c.name"
                      v-tooltip.top="tt('Restart')" @click.stop="confirmRestart(c.name)">
                <AppIcon name="restart" :size="11" />
              </AppButton>
            </div>
          </template>
        </template>
      </DataTable>

      <!-- Actions dropdown (teleported to body so it renders in all view modes) -->
      <Teleport to="body">
        <template v-for="c in displayContainers" :key="'menu-' + getContainerViewKey(c)">
          <div v-if="containerActionsEnabled && openActionsMenu === c.name"
               class="z-modal min-w-[160px] py-1 dd-rounded shadow-lg"
               :style="{
                 ...actionsMenuStyle,
                 backgroundColor: 'var(--dd-bg-card)',
                 border: '1px solid var(--dd-border-strong)',
                 boxShadow: 'var(--dd-shadow-tooltip)',
               }"
               @click.stop>
            <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" v-if="c.status === 'running'" 
                    @click="closeActionsMenu(); confirmStop(c.name)">
              <AppIcon name="stop" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-danger)' }" />
              Stop
            </AppButton>
            <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" v-else 
                    @click="closeActionsMenu(); startContainer(c.name)">
              <AppIcon name="play" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-success)' }" />
              Start
            </AppButton>
            <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" @click="closeActionsMenu(); confirmRestart(c.name)">
              <AppIcon name="restart" :size="12" class="w-3 text-center inline-flex justify-center dd-text-muted" />
              Restart
            </AppButton>
            <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" @click="closeActionsMenu(); scanContainer(c.name)">
              <AppIcon name="security" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-secondary)' }" />
              Scan
            </AppButton>
            <!-- Force update for blocked containers (even without newTag) -->
            <template v-if="c.bouncer === 'blocked' && !c.newTag">
              <div class="my-1" :style="{ borderTop: '1px solid var(--dd-border)' }" />
              <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" @click="closeActionsMenu(); confirmForceUpdate(c.name)">
                <AppIcon name="bolt" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-warning)' }" />
                Force update
              </AppButton>
            </template>
            <template v-if="c.newTag">
              <div class="my-1" :style="{ borderTop: '1px solid var(--dd-border)' }" />
              <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" v-if="c.bouncer === 'blocked'"
                      
                      @click="closeActionsMenu(); confirmForceUpdate(c.name)">
                <AppIcon name="bolt" :size="12" class="w-3 text-center inline-flex justify-center" :style="{ color: 'var(--dd-warning)' }" />
                Force update
              </AppButton>
              <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2 dd-text" @click="skipUpdate(c.name); closeActionsMenu()">
                <AppIcon name="skip-forward" :size="12" class="w-3 text-center inline-flex justify-center dd-text-muted" />
                Skip this update
              </AppButton>
            </template>
            <div class="my-1" :style="{ borderTop: '1px solid var(--dd-border)' }" />
            <AppButton size="md" variant="plain" weight="medium" class="w-full text-left flex items-center gap-2" style="color: var(--dd-danger);"
                    @click="closeActionsMenu(); confirmDelete(c.name)">
              <AppIcon name="trash" :size="12" class="w-3 text-center inline-flex justify-center" />
              Delete
            </AppButton>
          </div>
        </template>
      </Teleport>

      <!-- CONTAINER CARD GRID -->
      <DataCardGrid v-if="containerViewMode === 'cards'"
                    :items="group.containers"
                    :item-key="getContainerViewKey"
                    :selected-key="selectedContainer ? getContainerViewKey(selectedContainer) : null"
                    @item-click="selectContainer($event)">
        <template #card="{ item: c }">
          <!-- Card header -->
          <div class="px-4 pt-4 pb-2 flex items-start justify-between" :class="{ 'opacity-50': c._pending }">
            <div class="flex items-center gap-2.5 min-w-0">
              <AppIcon v-if="c._pending" name="spinner" :size="16" class="dd-spin dd-text-muted shrink-0" />
              <ContainerIcon v-else :icon="c.icon" :size="24" class="shrink-0" />
              <div class="min-w-0">
                <div class="text-sm-plus font-semibold truncate dd-text">
                  {{ c.name }}
                </div>
                <div class="text-2xs-plus truncate mt-0.5 dd-text-muted">
                  {{ c.image }}:{{ c.currentTag }} <span class="dd-text-secondary">&middot;</span> {{ parseServer(c.server).name }}<template v-if="parseServer(c.server).env"> <span class="dd-text-secondary">({{ parseServer(c.server).env }})</span></template>
                </div>
              </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0 ml-2">
              <span class="badge text-3xs uppercase tracking-wide font-bold"
                    :style="{ backgroundColor: registryColorBg(c.registry), color: registryColorText(c.registry) }">
                {{ registryLabel(c.registry, c.registryUrl, c.registryName) }}
              </span>
              <span v-if="hasRegistryError(c)"
                    class="inline-flex items-center justify-center"
                    style="color: var(--dd-danger);"
                    aria-label="Registry error"
                    v-tooltip.top="tt(registryErrorTooltip(c))">
                <AppIcon name="warning" :size="12" />
              </span>
              <span v-if="getContainerListPolicyState(c.name).snoozed"
                    class="inline-flex items-center justify-center"
                    style="color: var(--dd-info);"
                    aria-label="Snoozed updates"
                    v-tooltip.top="tt(containerPolicyTooltip(c.name, 'snoozed'))">
                <AppIcon name="pause" :size="12" />
              </span>
              <span v-if="getContainerListPolicyState(c.name).skipped"
                    class="inline-flex items-center justify-center"
                    style="color: var(--dd-warning);"
                    aria-label="Skipped updates"
                    v-tooltip.top="tt(containerPolicyTooltip(c.name, 'skipped'))">
                <AppIcon name="skip-forward" :size="12" />
              </span>
              <span v-if="getContainerListPolicyState(c.name).maturityBlocked"
                    class="inline-flex items-center justify-center"
                    style="color: var(--dd-primary);"
                    aria-label="Maturity-blocked updates"
                    v-tooltip.top="tt(containerPolicyTooltip(c.name, 'maturity'))">
                <AppIcon name="clock" :size="12" />
              </span>
            </div>
          </div>

          <!-- Card body -- inline Current / Latest -->
          <div class="px-4 py-3 min-w-0">
            <div class="flex items-center gap-2 flex-wrap min-w-0">
              <span class="text-2xs-plus dd-text-muted shrink-0">Current</span>
              <CopyableTag :tag="c.currentTag" class="text-xs font-bold dd-text truncate max-w-[120px]" @click.stop>
                {{ c.currentTag }}
              </CopyableTag>
              <template v-if="c.newTag">
                <span class="text-2xs-plus ml-1 dd-text-muted shrink-0">Latest</span>
                <CopyableTag :tag="c.newTag" class="text-xs font-bold truncate max-w-[140px]"
                      :style="{ color: updateKindColor(c.updateKind).text }" @click.stop>
                  {{ c.newTag }}
                </CopyableTag>
                <span class="ml-1 shrink-0"><UpdateMaturityBadge :maturity="c.updateMaturity" :tooltip="c.updateMaturityTooltip" /></span>
              </template>
              <template v-else>
                <span
                  v-if="c.noUpdateReason"
                  class="inline-flex items-center gap-1 ml-1 px-1.5 py-0.5 dd-rounded-sm text-2xs max-w-[220px]"
                  :style="{ backgroundColor: 'var(--dd-warning-muted)', color: 'var(--dd-warning)' }"
                  v-tooltip.top="c.noUpdateReason"
                >
                  <AppIcon name="warning" :size="11" class="shrink-0" />
                  <span class="truncate">{{ c.noUpdateReason }}</span>
                </span>
                <template v-else-if="getContainerListPolicyState(c.name).snoozed || getContainerListPolicyState(c.name).skipped || getContainerListPolicyState(c.name).maturityBlocked">
                  <span v-if="getContainerListPolicyState(c.name).snoozed"
                        class="inline-flex items-center justify-center ml-1"
                        style="color: var(--dd-info);"
                        aria-label="Snoozed updates"
                        v-tooltip.top="tt(containerPolicyTooltip(c.name, 'snoozed'))">
                    <AppIcon name="pause" :size="13" />
                  </span>
                  <span v-if="getContainerListPolicyState(c.name).skipped"
                        class="inline-flex items-center justify-center"
                        style="color: var(--dd-warning);"
                        aria-label="Skipped updates"
                        v-tooltip.top="tt(containerPolicyTooltip(c.name, 'skipped'))">
                    <AppIcon name="skip-forward" :size="13" />
                  </span>
                  <span v-if="getContainerListPolicyState(c.name).maturityBlocked"
                        class="inline-flex items-center justify-center"
                        style="color: var(--dd-primary);"
                        aria-label="Maturity-blocked updates"
                        v-tooltip.top="tt(containerPolicyTooltip(c.name, 'maturity'))">
                    <AppIcon name="clock" :size="13" />
                  </span>
                </template>
                <AppIcon v-else name="check" :size="14" class="ml-1" style="color: var(--dd-success);" />
              </template>
            </div>
            <div v-if="c.suggestedTag || c.releaseNotes || c.releaseLink" class="flex items-center gap-2 flex-wrap mt-2">
              <SuggestedTagBadge :tag="c.suggestedTag" :current-tag="c.currentTag" />
              <ReleaseNotesLink :release-notes="c.releaseNotes" :release-link="c.releaseLink" />
            </div>
          </div>

          <!-- Card footer -->
          <div class="px-4 py-2.5 flex items-center justify-between mt-auto"
               :style="{
                 borderTop: '1px solid var(--dd-border)',
                 backgroundColor: 'var(--dd-bg-elevated)',
               }">
            <span class="badge px-1.5 py-0 text-3xs md:!hidden"
                  :style="{ backgroundColor: c.status === 'running' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)', color: c.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)' }">
              <AppIcon :name="c.status === 'running' ? 'play' : 'stop'" :size="12" />
            </span>
            <span class="badge text-3xs font-bold max-md:!hidden"
                  :style="{ backgroundColor: c.status === 'running' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)', color: c.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)' }">
              {{ c.status }}
            </span>
            <div class="flex items-center gap-1.5">
              <template v-if="containerActionsEnabled">
                <AppButton size="icon-sm" variant="plain" class="dd-rounded-sm" v-if="c.status === 'running'"
                        
                        :class="actionInProgress === c.name ? 'dd-text-muted opacity-50 cursor-not-allowed' : 'dd-text-muted hover:dd-text-danger hover:dd-bg-elevated'"
                        :disabled="actionInProgress === c.name"
                        v-tooltip.top="tt('Stop')" @click.stop="confirmStop(c.name)">
                  <AppIcon name="stop" :size="14" />
                </AppButton>
                <AppButton size="icon-sm" variant="plain" class="dd-rounded-sm" v-else
                        
                        :class="actionInProgress === c.name ? 'dd-text-muted opacity-50 cursor-not-allowed' : 'dd-text-muted hover:dd-text-success hover:dd-bg-elevated'"
                        :disabled="actionInProgress === c.name"
                        v-tooltip.top="tt('Start')" @click.stop="startContainer(c.name)">
                  <AppIcon name="play" :size="14" />
                </AppButton>
                <AppButton size="icon-sm" variant="plain" class="dd-rounded-sm" :class="actionInProgress === c.name ? 'dd-text-muted opacity-50 cursor-not-allowed' : 'dd-text-muted hover:dd-text hover:dd-bg-elevated'"
                        :disabled="actionInProgress === c.name"
                        v-tooltip.top="tt('Restart')" @click.stop="confirmRestart(c.name)">
                  <AppIcon name="restart" :size="14" />
                </AppButton>
                <AppButton size="icon-sm" variant="plain" class="dd-rounded-sm" :class="actionInProgress === c.name ? 'dd-text-muted opacity-50 cursor-not-allowed' : 'dd-text-muted hover:dd-text-secondary hover:dd-bg-elevated'"
                        :disabled="actionInProgress === c.name"
                        v-tooltip.top="tt('Scan')" @click.stop="scanContainer(c.name)">
                  <AppIcon name="security" :size="14" />
                </AppButton>
                <AppButton size="icon-sm" variant="plain" class="dd-rounded-sm" v-if="c.newTag"
                        
                        :class="actionInProgress === c.name ? 'dd-text-muted opacity-50 cursor-not-allowed' : 'dd-text-muted hover:dd-text-success hover:dd-bg-elevated'"
                        :disabled="actionInProgress === c.name"
                        v-tooltip.top="tt('Update')" @click.stop="confirmUpdate(c.name)">
                  <AppIcon name="cloud-download" :size="14" />
                </AppButton>
              </template>
              <template v-else>
                <span class="text-2xs dd-text-muted">Actions disabled</span>
                <AppButton size="none" variant="plain" weight="none"
                  class="w-7 h-7 dd-rounded-sm flex items-center justify-center cursor-not-allowed dd-text-muted opacity-60"
                  :disabled="true"
                  v-tooltip.top="tt(containerActionsDisabledReason)"
                  @click.stop
                >
                  <AppIcon name="lock" :size="14" />
                </AppButton>
              </template>
            </div>
          </div>
        </template>
      </DataCardGrid>

      <!-- LIST VIEW -->
      <DataListAccordion v-if="containerViewMode === 'list'"
                         :items="group.containers"
                         :item-key="getContainerViewKey"
                         :selected-key="selectedContainer ? getContainerViewKey(selectedContainer) : null"
                         @item-click="selectContainer($event)">
        <template #header="{ item: c }">
          <AppIcon v-if="c._pending" name="spinner" :size="14" class="dd-spin dd-text-muted shrink-0" />
          <ContainerIcon v-else :icon="c.icon" :size="18" class="shrink-0" />
          <div class="min-w-0 flex-1" :class="{ 'opacity-50': c._pending }">
            <div class="text-sm font-semibold truncate dd-text">{{ c.name }}</div>
            <div class="text-2xs mt-0.5 truncate dd-text-muted" v-tooltip.top="`${c.image}:${c.currentTag}`">{{ c.image }}:{{ c.currentTag }}</div>
            <div
              v-if="!c.newTag && c.noUpdateReason"
              class="text-2xs mt-0.5 truncate"
              style="color: var(--dd-warning);"
              v-tooltip.top="c.noUpdateReason"
            >
              {{ c.noUpdateReason }}
            </div>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <!-- Update kind: icon on mobile, badge on desktop -->
            <span v-if="c.updateKind" class="badge px-1.5 py-0 text-3xs md:!hidden"
                  :style="{ backgroundColor: updateKindColor(c.updateKind).bg, color: updateKindColor(c.updateKind).text }">
              <AppIcon :name="c.updateKind === 'major' ? 'chevrons-up' : c.updateKind === 'minor' ? 'chevron-up' : c.updateKind === 'patch' ? 'hashtag' : 'fingerprint'" :size="12" />
            </span>
            <span v-if="c.updateKind" class="badge text-3xs uppercase font-bold max-md:!hidden"
                  :style="{ backgroundColor: updateKindColor(c.updateKind).bg, color: updateKindColor(c.updateKind).text }">
              {{ c.updateKind }}
            </span>
            <UpdateMaturityBadge :maturity="c.updateMaturity" :tooltip="c.updateMaturityTooltip" />
            <!-- Status: icon on mobile, badge on desktop -->
            <AppIcon :name="c.status === 'running' ? 'play' : 'stop'" :size="13" class="shrink-0 md:!hidden"
                     :style="{ color: c.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)' }" />
            <span class="badge text-3xs font-bold max-md:!hidden"
                  :style="{
                    backgroundColor: c.status === 'running' ? 'var(--dd-success-muted)' : 'var(--dd-danger-muted)',
                    color: c.status === 'running' ? 'var(--dd-success)' : 'var(--dd-danger)',
                  }">
              {{ c.status }}
            </span>
            <span v-if="hasRegistryError(c)"
                  class="inline-flex items-center justify-center"
                  style="color: var(--dd-danger);"
                  aria-label="Registry error"
                  v-tooltip.top="tt(registryErrorTooltip(c))">
              <AppIcon name="warning" :size="12" />
            </span>
            <span v-if="getContainerListPolicyState(c.name).snoozed"
                  class="inline-flex items-center justify-center"
                  style="color: var(--dd-info);"
                  aria-label="Snoozed updates"
                  v-tooltip.top="tt(containerPolicyTooltip(c.name, 'snoozed'))">
              <AppIcon name="pause" :size="12" />
            </span>
            <span v-if="getContainerListPolicyState(c.name).skipped"
                  class="inline-flex items-center justify-center"
                  style="color: var(--dd-warning);"
                  aria-label="Skipped updates"
                  v-tooltip.top="tt(containerPolicyTooltip(c.name, 'skipped'))">
              <AppIcon name="skip-forward" :size="12" />
            </span>
            <span v-if="getContainerListPolicyState(c.name).maturityBlocked"
                  class="inline-flex items-center justify-center"
                  style="color: var(--dd-primary);"
                  aria-label="Maturity-blocked updates"
                  v-tooltip.top="tt(containerPolicyTooltip(c.name, 'maturity'))">
              <AppIcon name="clock" :size="12" />
            </span>
            <!-- Bouncer: icon in badge -->
            <span v-if="c.bouncer === 'blocked'" class="badge px-1.5 py-0 text-3xs"
                  style="background: var(--dd-danger-muted); color: var(--dd-danger);">
              <AppIcon name="blocked" :size="12" />
            </span>
            <!-- Server: icon on mobile, badge on desktop -->
            <AppIcon :name="parseServer(c.server).name === 'Local' ? 'home' : 'remote'" :size="12" class="shrink-0 dd-text-muted md:!hidden" />
            <span class="badge text-5xs font-bold max-md:!hidden"
                  :style="{ backgroundColor: serverBadgeColor(c.server).bg, color: serverBadgeColor(c.server).text }">
              {{ parseServer(c.server).name }}
            </span>
          </div>
        </template>
      </DataListAccordion>

        </div><!-- /group body -->
      </template><!-- /v-for group -->
      </template><!-- /filteredContainers.length > 0 -->

      <!-- EMPTY STATE -->
      <EmptyState v-if="filteredContainers.length === 0"
                  icon="filter"
                  message="No containers match your filters"
                  :show-clear="activeFilterCount > 0 || !!filterSearch"
                  @clear="clearFilters" />
  </div>
</template>
