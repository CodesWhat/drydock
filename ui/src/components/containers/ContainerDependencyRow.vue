<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AppBadge from '../AppBadge.vue';
import AppButton from '../AppButton.vue';
import AppIcon from '../AppIcon.vue';
import type { Container, DependencyGraphNode } from '../../types/container';
import type { DependencyAdjacency } from '../../utils/dependency-graph-view';
import { getDirectChildren, getDirectParents } from '../../utils/dependency-graph-view';

const { t } = useI18n();

const props = defineProps<{
  container: Pick<Container, 'id' | 'name'>;
  adjacency: DependencyAdjacency;
  cycle: boolean;
  groupSize: number;
  containerActionsEnabled: boolean;
}>();

const emit = defineEmits<{
  'update-group': [container: Pick<Container, 'id' | 'name'>];
}>();

const parents = computed(() => getDirectParents(props.adjacency, props.container.id));
const children = computed(() => getDirectChildren(props.adjacency, props.container.id));

function nodeLabel(node: DependencyGraphNode) {
  return node.displayName || node.name;
}

// Hidden (not merely disabled) when there's nothing to bulk-update or the
// user lacks the same permission the stack header's Update All button
// checks — mirrors ContainersGroupHeader's containerActionsEnabled gating.
const showUpdateGroupButton = computed(() => props.containerActionsEnabled && props.groupSize >= 2);
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 mb-2 ml-6 dd-rounded text-2xs-plus"
    :style="{ backgroundColor: 'var(--dd-bg-elevated)' }"
    data-test="container-dependency-row"
  >
    <span v-if="parents.length" class="inline-flex items-center gap-1 min-w-0" data-test="container-dependency-parents">
      <span class="dd-text-muted font-semibold">{{ t('containerComponents.dependencyGraph.dependsOn') }}:</span>
      <span class="dd-text truncate">{{ parents.map(nodeLabel).join(', ') }}</span>
    </span>
    <span v-if="children.length" class="inline-flex items-center gap-1 min-w-0" data-test="container-dependency-children">
      <span class="dd-text-muted font-semibold">{{ t('containerComponents.dependencyGraph.requiredBy') }}:</span>
      <span class="dd-text truncate">{{ children.map(nodeLabel).join(', ') }}</span>
    </span>
    <AppBadge v-if="cycle" tone="warning" size="xs" class="shrink-0" data-test="container-dependency-cycle">
      <AppIcon name="warning" :size="10" class="mr-1" />
      {{ t('containerComponents.dependencyGraph.cycle') }}
    </AppBadge>
    <AppButton
      v-if="showUpdateGroupButton"
      size="compact"
      variant="success"
      weight="semibold"
      class="ms-auto shrink-0 inline-flex items-center justify-center whitespace-nowrap"
      data-test="container-dependency-update-group"
      @click.stop="emit('update-group', container)"
    >
      <AppIcon name="cloud-download" :size="14" class="mr-1" />
      {{ t('containerComponents.dependencyGraph.updateGroup', { count: groupSize }) }}
    </AppButton>
  </div>
</template>
