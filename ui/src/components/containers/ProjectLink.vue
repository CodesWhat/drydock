<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import AppIconButton from '../AppIconButton.vue';

const { t } = useI18n();

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
    :tooltip="t('containerComponents.projectLink.viewProject')"
    :aria-label="t('containerComponents.projectLink.viewProject')"
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
    {{ t('containerComponents.projectLink.viewProject') }}
  </a>
</template>
