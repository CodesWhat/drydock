<script setup lang="ts">
import AppBadge from '../AppBadge.vue';
import AppButton from '../AppButton.vue';
import AppIcon from '../AppIcon.vue';
import type { ContainersViewRenderGroup } from './containersViewTemplateContext';

defineProps<{
  group: ContainersViewRenderGroup;
  isFirst?: boolean;
  collapsed: boolean;
  containerActionsEnabled: boolean;
  containerActionsDisabledReason: string;
  inProgress: boolean;
  tt: (label: string) => { value: string; showDelay: number };
}>();

const emit = defineEmits<{
  toggle: [groupKey: string];
  updateAll: [group: ContainersViewRenderGroup];
}>();
</script>

<template>
  <div
    class="flex items-center gap-2 px-3 py-2.5 mb-3 cursor-pointer select-none dd-rounded transition-colors hover:dd-bg-elevated"
    :style="{ backgroundColor: 'var(--dd-bg-elevated)' }"
    :class="isFirst ? '' : 'mt-6'"
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
    <span class="text-xs font-semibold dd-text">{{ group.name ?? 'Ungrouped' }}</span>
    <AppBadge
      size="xs"
      :custom="{ bg: 'var(--dd-bg-elevated)', text: 'var(--dd-text-muted)' }"
    >
      {{ group.containerCount }}
    </AppBadge>
    <AppBadge v-if="group.updatesAvailable > 0" tone="success" size="xs">
      {{ group.updatesAvailable }} update{{ group.updatesAvailable === 1 ? '' : 's' }}
    </AppBadge>
    <AppButton
      v-if="group.updatesAvailable > 0 || !containerActionsEnabled"
      size="none"
      variant="plain"
      weight="none"
      class="ml-auto inline-flex items-center justify-center px-2 py-1 dd-rounded border text-2xs font-semibold transition-colors"
      :class="
        !containerActionsEnabled || inProgress
          ? 'dd-text-muted cursor-not-allowed opacity-60'
          : 'dd-text hover:dd-bg-elevated'
      "
      :disabled="!containerActionsEnabled || group.updatableCount === 0 || inProgress"
      v-tooltip.top="
        tt(
          !containerActionsEnabled
            ? containerActionsDisabledReason
            : group.updatableCount === 0
              ? 'All updates blocked by security scan'
              : 'Update all in group',
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
      {{ containerActionsEnabled ? 'Update all' : 'Actions disabled' }}
    </AppButton>
  </div>
</template>
