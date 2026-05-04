<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { ContainerReleaseNotes } from '../../types/container';
import AppIconButton from '../AppIconButton.vue';
import type { IconButtonSize } from '../appIconButtonSizes';

const { t } = useI18n();

const props = withDefaults(
  defineProps<{
    releaseNotes?: ContainerReleaseNotes | null;
    currentReleaseNotes?: ContainerReleaseNotes | null;
    releaseLink?: string;
    iconOnly?: boolean;
    iconSize?: IconButtonSize;
  }>(),
  { iconSize: 'sm' },
);

const currentExpanded = ref(false);
const updateExpanded = ref(false);

const sameNotes = computed(() => {
  const updateNotes = props.releaseNotes;
  const currentNotes = props.currentReleaseNotes;
  if (!updateNotes || !currentNotes) return false;
  return updateNotes.url === currentNotes.url || updateNotes.title === currentNotes.title;
});

const showCurrentPanel = computed(() => {
  if (!props.currentReleaseNotes) return false;
  if (props.releaseNotes && sameNotes.value) return false;
  return true;
});

const iconHref = computed(
  () => props.releaseNotes?.url ?? props.currentReleaseNotes?.url ?? props.releaseLink,
);
const iconTestId = computed(() => {
  if (props.releaseNotes) return 'release-notes-link';
  if (props.currentReleaseNotes) return 'current-release-notes-link';
  return 'release-link';
});

function truncateBody(body: string, maxLength: number = 200): string {
  if (body.length <= maxLength) return body;
  return `${body.slice(0, maxLength)}...`;
}
</script>

<template>
  <!-- Icon-only variant: tappable icon that opens the most relevant external URL directly -->
  <AppIconButton
    v-if="iconOnly && iconHref"
    icon="file-text"
    :size="iconSize"
    variant="muted"
    :href="iconHref"
    target="_blank"
    rel="noopener noreferrer"
    :tooltip="t('containerComponents.releaseNotesLink.releaseNotes')"
    :aria-label="t('containerComponents.releaseNotesLink.releaseNotes')"
    :data-test="iconTestId"
    @click.stop
  />
  <!-- Inline release notes: render up to two panels (current running tag + new update tag) -->
  <div
    v-else-if="props.releaseNotes || props.currentReleaseNotes"
    class="inline-flex flex-col gap-1.5"
    data-test="release-notes-link"
  >
    <!-- Current running tag -->
    <div v-if="showCurrentPanel" class="inline-flex flex-col" data-test="current-release-notes-panel">
      <AppButton size="none" variant="plain" weight="none"
        class="inline-flex items-center gap-1 text-2xs-plus underline hover:no-underline transition-colors"
        style="color: var(--dd-info);"
        @click.stop="currentExpanded = !currentExpanded"
      >
        <AppIcon name="file-text" :size="12" />
        {{ t('containerComponents.releaseNotesLink.releaseNotes') }} — {{ props.currentReleaseNotes?.title }} {{ t('containerComponents.releaseNotesLink.currentSuffix') }}
        <AppIcon :name="currentExpanded ? 'chevron-up' : 'chevron-down'" :size="10" />
      </AppButton>
      <div
        v-if="currentExpanded && props.currentReleaseNotes"
        class="mt-2 px-2.5 py-2 dd-rounded text-2xs-plus space-y-1.5"
        :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
        @click.stop
      >
        <div class="font-semibold dd-text">{{ props.currentReleaseNotes.title }}</div>
        <div class="dd-text-secondary whitespace-pre-line break-words">{{ truncateBody(props.currentReleaseNotes.body) }}</div>
        <a
          :href="props.currentReleaseNotes.url"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 text-2xs underline hover:no-underline"
          style="color: var(--dd-info);"
        >
          {{ t('containerComponents.releaseNotesLink.viewFullNotes') }}
          <AppIcon name="external-link" :size="10" />
        </a>
      </div>
    </div>
    <!-- New update target tag -->
    <div v-if="props.releaseNotes" class="inline-flex flex-col" data-test="update-release-notes-panel">
      <AppButton size="none" variant="plain" weight="none"
        class="inline-flex items-center gap-1 text-2xs-plus underline hover:no-underline transition-colors"
        style="color: var(--dd-info);"
        @click.stop="updateExpanded = !updateExpanded"
      >
        <AppIcon name="file-text" :size="12" />
        <template v-if="props.currentReleaseNotes && !sameNotes">
          {{ t('containerComponents.releaseNotesLink.releaseNotes') }} — {{ props.releaseNotes.title }} {{ t('containerComponents.releaseNotesLink.availableSuffix') }}
        </template>
        <template v-else>
          {{ t('containerComponents.releaseNotesLink.releaseNotes') }}
        </template>
        <AppIcon :name="updateExpanded ? 'chevron-up' : 'chevron-down'" :size="10" />
      </AppButton>
      <div
        v-if="updateExpanded"
        class="mt-2 px-2.5 py-2 dd-rounded text-2xs-plus space-y-1.5"
        :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
        @click.stop
      >
        <div class="font-semibold dd-text">{{ props.releaseNotes.title }}</div>
        <div class="dd-text-secondary whitespace-pre-line break-words">{{ truncateBody(props.releaseNotes.body) }}</div>
        <a
          :href="props.releaseNotes.url"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 text-2xs underline hover:no-underline"
          style="color: var(--dd-info);"
        >
          {{ t('containerComponents.releaseNotesLink.viewFullNotes') }}
          <AppIcon name="external-link" :size="10" />
        </a>
      </div>
    </div>
  </div>
  <!-- Fallback: simple external release link -->
  <a
    v-else-if="props.releaseLink"
    :href="props.releaseLink"
    target="_blank"
    rel="noopener noreferrer"
    class="inline-flex items-center gap-1 text-2xs-plus underline hover:no-underline"
    style="color: var(--dd-info);"
    data-test="release-link"
  >
    <AppIcon name="file-text" :size="12" />
    {{ t('containerComponents.releaseNotesLink.releaseNotes') }}
  </a>
</template>
