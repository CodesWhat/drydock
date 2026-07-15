<script setup lang="ts">
import { computed } from 'vue';
import type { Container, ContainerReleaseNotes } from '../../types/container';
import type { IconButtonSize } from '../appIconButtonSizes';
import ProjectLink from './ProjectLink.vue';
import RegistryLink from './RegistryLink.vue';
import ReleaseNotesLink from './ReleaseNotesLink.vue';
import { registryLookup } from './registry-link';

const props = withDefaults(
  defineProps<{
    sourceRepo?: string;
    releaseNotes?: ContainerReleaseNotes | null;
    currentReleaseNotes?: ContainerReleaseNotes | null;
    releaseLink?: string;
    containerId?: string;
    fromTag?: string | null;
    toTag?: string | null;
    registry?: Container['registry'];
    registryName?: string;
    registryUrl?: string;
    iconSize?: IconButtonSize;
  }>(),
  { iconSize: 'sm' },
);

const hasSource = computed(() => Boolean(props.sourceRepo?.trim()));
const hasReleaseNotes = computed(() =>
  Boolean(props.releaseNotes || props.currentReleaseNotes || props.releaseLink?.trim()),
);
const hasRegistry = computed(() =>
  Boolean(registryLookup(props.registry, props.registryName, props.registryUrl)),
);
const hasActions = computed(() => hasSource.value || hasReleaseNotes.value || hasRegistry.value);

function stopRowActivationKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.stopPropagation();
  }
}
</script>

<template>
  <div
    v-if="hasActions"
    class="inline-flex items-center gap-1 touch-manipulation"
    data-test="container-quick-links"
    @click.stop
    @keydown="stopRowActivationKeydown"
  >
    <ProjectLink
      v-if="hasSource"
      :source-repo="sourceRepo"
      icon-only
      :icon-size="iconSize"
    />
    <ReleaseNotesLink
      v-if="hasReleaseNotes"
      :release-notes="releaseNotes"
      :current-release-notes="currentReleaseNotes"
      :release-link="releaseLink"
      :container-id="containerId"
      :from-tag="fromTag"
      :to-tag="toTag"
      icon-only
      :icon-size="iconSize"
    />
    <RegistryLink
      v-if="hasRegistry"
      :registry="registry"
      :registry-name="registryName"
      :registry-url="registryUrl"
      :icon-size="iconSize"
    />
  </div>
</template>
