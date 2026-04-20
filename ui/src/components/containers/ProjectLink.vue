<script setup lang="ts">
import { computed } from 'vue';
import AppIconButton from '../AppIconButton.vue';

const props = defineProps<{
  sourceRepo?: string;
  iconOnly?: boolean;
}>();

const trimmed = computed(() => props.sourceRepo?.trim() ?? '');

const projectUrl = computed(() => `https://${trimmed.value}`);

const iconName = computed(() => {
  const host = trimmed.value.split('/')[0];
  if (host === 'github.com') return 'github';
  if (host === 'gitlab.com') return 'gitlab';
  return 'external-link';
});
</script>

<template>
  <AppIconButton
    v-if="trimmed && iconOnly"
    :icon="iconName"
    size="sm"
    variant="muted"
    :href="projectUrl"
    target="_blank"
    rel="noopener noreferrer"
    :tooltip="'View project'"
    aria-label="View project"
    data-test="project-link"
    @click.stop
  />
  <a
    v-else-if="trimmed"
    :href="projectUrl"
    target="_blank"
    rel="noopener noreferrer"
    class="inline-flex items-center gap-1 text-2xs-plus underline hover:no-underline"
    style="color: var(--dd-info);"
    data-test="project-link"
  >
    <AppIcon :name="iconName" :size="12" />
    View project
  </a>
</template>
