<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import AppBadge from '../AppBadge.vue';
import AppButton from '../AppButton.vue';
import AppIcon from '../AppIcon.vue';
import type { ContainersViewRenderGroup } from './containersViewTemplateContext';

const { t } = useI18n();

defineProps<{
  group: ContainersViewRenderGroup;
  isFirst?: boolean;
  collapsed: boolean;
  containerActionsEnabled: boolean;
  containerActionsDisabledReason: string;
  inProgress: boolean;
  frozenTotal?: number;
  doneCount?: number;
  tt: (label: string) => { value: string; showDelay: number };
}>();

const emit = defineEmits<{
  toggle: [groupKey: string];
  updateAll: [group: ContainersViewRenderGroup];
}>();
</script>

<template>
  <div
    class="flex items-center gap-2 px-3 py-2.5 mb-2 cursor-pointer select-none dd-rounded transition-colors hover:dd-bg-elevated"
    :style="{ backgroundColor: 'var(--dd-bg-elevated)' }"
    :class="isFirst ? 'mt-2' : 'mt-9'"
    role="button"
    tabindex="0"
    @keydown.enter.space.prevent="emit('toggle', group.key)"
    @click="emit('toggle', group.key)"
  >
    <AppIcon
      :name="collapsed ? 'chevron-right' : 'chevron-down'"
      :size="10"
      class="dd-text-muted shrink-0"
    />
    <AppIcon name="stack" :size="12" class="dd-text-muted shrink-0" />
    <span class="text-xs font-semibold dd-text">{{ group.name ?? t('containerComponents.groupHeader.ungrouped') }}</span>
    <AppBadge
      size="xs"
      :custom="{ bg: 'var(--dd-bg-elevated)', text: 'var(--dd-text-muted)' }"
    >
      {{ group.containerCount }}
    </AppBadge>
    <AppBadge v-if="group.updatesAvailable > 0" tone="success" size="xs">
      {{ group.updatesAvailable }} {{ group.updatesAvailable === 1 ? t('containerComponents.groupHeader.updateSingular') : t('containerComponents.groupHeader.updatePlural') }}
    </AppBadge>
    <div
      v-if="group.updatesAvailable > 0 || !containerActionsEnabled"
      data-test="group-header-update-all-sticky"
      class="ms-auto sticky end-0 z-10 flex items-center"
    >
      <AppButton
        size="compact"
        :variant="
          !containerActionsEnabled || group.updatableCount === 0 || inProgress
            ? 'muted-subtle'
            : 'success'
        "
        weight="semibold"
        class="inline-flex items-center justify-center"
        :class="
          !containerActionsEnabled || inProgress
            ? 'cursor-not-allowed'
            : ''
        "
        :disabled="!containerActionsEnabled || group.updatableCount === 0 || inProgress"
        v-tooltip.top="
          tt(
            !containerActionsEnabled
              ? containerActionsDisabledReason
              : group.updatableCount === 0
                ? t('containerComponents.groupHeader.allBlockedTooltip')
                : t('containerComponents.groupHeader.updateAllInGroupTooltip'),
          )
        "
        @click.stop="emit('updateAll', group)"
      >
        <AppIcon
          :name="
            !containerActionsEnabled || group.updatableCount === 0
              ? 'lock'
              : inProgress
                ? 'spinner'
                : 'cloud-download'
          "
          :size="14"
          class="mr-1"
          :class="!containerActionsEnabled ? '' : inProgress ? 'dd-spin' : ''"
        />
        {{
          !containerActionsEnabled
            ? t('containerComponents.groupHeader.actionsDisabled')
            : inProgress && frozenTotal !== undefined && doneCount !== undefined && frozenTotal >= 2
              ? t('containerComponents.groupHeader.updatingStack', { done: doneCount, total: frozenTotal })
              : t('containerComponents.groupHeader.updateAll')
        }}
      </AppButton>
    </div>
  </div>
</template>
