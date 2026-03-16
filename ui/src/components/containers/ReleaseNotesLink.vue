<script setup lang="ts">
import { ref } from 'vue';
import type { ContainerReleaseNotes } from '../../types/container';

const props = defineProps<{
  releaseNotes?: ContainerReleaseNotes | null;
  releaseLink?: string;
}>();

const expanded = ref(false);

function toggleExpand() {
  expanded.value = !expanded.value;
}

function truncateBody(body: string, maxLength: number = 200): string {
  if (body.length <= maxLength) return body;
  return `${body.slice(0, maxLength)}...`;
}
</script>

<template>
  <!-- Inline release notes with expandable preview -->
  <div v-if="props.releaseNotes" class="inline-flex flex-col" data-test="release-notes-link">
    <button
      class="inline-flex items-center gap-1 text-[0.6875rem] underline hover:no-underline transition-colors"
      style="color: var(--dd-info);"
      @click.stop="toggleExpand"
    >
      <AppIcon name="file-text" :size="12" />
      Release notes
      <AppIcon :name="expanded ? 'chevron-up' : 'chevron-down'" :size="10" />
    </button>
    <div
      v-if="expanded"
      class="mt-2 px-2.5 py-2 dd-rounded text-[0.6875rem] space-y-1.5"
      :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
      @click.stop
    >
      <div class="font-semibold dd-text">{{ props.releaseNotes.title }}</div>
      <div class="dd-text-secondary whitespace-pre-line break-words">{{ truncateBody(props.releaseNotes.body) }}</div>
      <a
        :href="props.releaseNotes.url"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-1 text-[0.625rem] underline hover:no-underline"
        style="color: var(--dd-info);"
      >
        View full notes
        <AppIcon name="external-link" :size="10" />
      </a>
    </div>
  </div>
  <!-- Fallback: simple external release link -->
  <a
    v-else-if="props.releaseLink"
    :href="props.releaseLink"
    target="_blank"
    rel="noopener noreferrer"
    class="inline-flex items-center gap-1 text-[0.6875rem] underline hover:no-underline"
    style="color: var(--dd-info);"
    data-test="release-link"
  >
    <AppIcon name="file-text" :size="12" />
    Release notes
  </a>
</template>
