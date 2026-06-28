<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { getContainerIntermediateReleaseNotes } from '../../services/container';
import type { ContainerReleaseNotes } from '../../types/container';
import AppIconButton from '../AppIconButton.vue';
import type { IconButtonSize } from '../appIconButtonSizes';

const { t } = useI18n();
const POPOVER_GAP_PX = 6;
const POPOVER_MARGIN_PX = 8;
const POPOVER_WIDTH_PX = 380;
const POPOVER_ESTIMATED_HEIGHT_PX = 360;

const props = withDefaults(
  defineProps<{
    releaseNotes?: ContainerReleaseNotes | null;
    currentReleaseNotes?: ContainerReleaseNotes | null;
    releaseLink?: string;
    iconOnly?: boolean;
    iconSize?: IconButtonSize;
    containerId?: string;
    fromTag?: string | null;
    toTag?: string | null;
  }>(),
  { iconSize: 'sm' },
);

const currentExpanded = ref(false);
const updateExpanded = ref(false);
const iconPopoverOpen = ref(false);
const iconPopoverStyle = ref<Record<string, string>>({});

const intermediateNotes = ref<ContainerReleaseNotes[]>([]);
const intermediateHiddenCount = ref(0);
const intermediateLoading = ref(false);
const intermediateLoaded = ref(false);
const intermediateExpanded = ref<Set<number>>(new Set());

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

const hasStructuredNotes = computed(() => Boolean(props.releaseNotes || props.currentReleaseNotes));
const iconTestId = computed(() => {
  if (props.releaseNotes) return 'release-notes-link';
  if (props.currentReleaseNotes) return 'current-release-notes-link';
  return 'release-link';
});
const releaseNotesLabel = computed(() => t('containerComponents.releaseNotesLink.releaseNotes'));
const currentPopoverLabel = computed(() => {
  const title = props.currentReleaseNotes?.title;
  return title
    ? `${releaseNotesLabel.value} - ${title} ${t('containerComponents.releaseNotesLink.currentSuffix')}`
    : releaseNotesLabel.value;
});
const updatePopoverLabel = computed(() => {
  const title = props.releaseNotes?.title;
  if (!title) return releaseNotesLabel.value;
  const suffix =
    props.currentReleaseNotes && !sameNotes.value
      ? ` ${t('containerComponents.releaseNotesLink.availableSuffix')}`
      : '';
  return `${releaseNotesLabel.value} - ${title}${suffix}`;
});

const canFetchIntermediate = computed(
  () =>
    Boolean(props.containerId && props.fromTag && props.toTag && props.fromTag !== props.toTag),
);

const hasIntermediateNotes = computed(() => intermediateNotes.value.length > 0);

function truncateBody(body: string, maxLength: number = 200): string {
  if (body.length <= maxLength) return body;
  return `${body.slice(0, maxLength)}...`;
}

function buildIconPopoverStyle(rect: DOMRect): Record<string, string> {
  const viewportWidth = window.innerWidth || POPOVER_WIDTH_PX;
  const viewportHeight = window.innerHeight || POPOVER_ESTIMATED_HEIGHT_PX;
  const width = Math.min(POPOVER_WIDTH_PX, Math.max(240, viewportWidth - POPOVER_MARGIN_PX * 2));
  const left = Math.min(
    Math.max(POPOVER_MARGIN_PX, rect.right - width),
    viewportWidth - width - POPOVER_MARGIN_PX,
  );
  const spaceBelow = viewportHeight - rect.bottom;
  const spaceAbove = rect.top;
  const estimatedHeight = Math.min(
    POPOVER_ESTIMATED_HEIGHT_PX + Math.min(intermediateNotes.value.length * 44, 132),
    viewportHeight - POPOVER_MARGIN_PX * 2,
  );
  const top =
    spaceBelow < estimatedHeight && spaceAbove > spaceBelow
      ? Math.max(POPOVER_MARGIN_PX, rect.top - estimatedHeight - POPOVER_GAP_PX)
      : Math.min(rect.bottom + POPOVER_GAP_PX, viewportHeight - POPOVER_MARGIN_PX);

  return {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    maxHeight: `calc(100vh - ${POPOVER_MARGIN_PX * 2}px)`,
  };
}

function removeIconPopoverListeners() {
  globalThis.removeEventListener('click', closeIconPopover);
  globalThis.removeEventListener('keydown', handleIconPopoverKeydown);
  globalThis.removeEventListener('scroll', closeIconPopover, true);
}

function closeIconPopover() {
  // c8 ignore next -- defensive guard; listener is removed after first invocation so re-entry is unreachable
  if (!iconPopoverOpen.value) {
    return;
  }
  iconPopoverOpen.value = false;
  removeIconPopoverListeners();
}

function handleIconPopoverKeydown(event: Event) {
  if (event instanceof KeyboardEvent && event.key === 'Escape') {
    closeIconPopover();
  }
}

async function ensureIntermediateNotesLoaded() {
  if (!canFetchIntermediate.value || intermediateLoaded.value || intermediateLoading.value) return;
  intermediateLoading.value = true;
  try {
    const result = await getContainerIntermediateReleaseNotes(
      props.containerId!,
      props.fromTag!,
      props.toTag!,
    );
    if (result) {
      intermediateNotes.value = result.releaseNotes;
      intermediateHiddenCount.value = result.hiddenCount;
    }
    intermediateLoaded.value = true;
  } catch {
    // best-effort: leave the section empty and let the two-panel view stand
  } finally {
    intermediateLoading.value = false;
  }
}

function openIconPopover(event: MouseEvent) {
  const trigger = event.currentTarget as HTMLElement | null;
  // c8 ignore next -- defensive guard; currentTarget is always the button element when triggered via DOM
  if (!trigger) {
    return;
  }
  iconPopoverStyle.value = buildIconPopoverStyle(trigger.getBoundingClientRect());
  iconPopoverOpen.value = true;
  globalThis.addEventListener('click', closeIconPopover);
  globalThis.addEventListener('keydown', handleIconPopoverKeydown);
  globalThis.addEventListener('scroll', closeIconPopover, true);
  void ensureIntermediateNotesLoaded();
}

function toggleIconPopover(event: MouseEvent) {
  if (iconPopoverOpen.value) {
    closeIconPopover();
    return;
  }
  openIconPopover(event);
}

function toggleIntermediate(idx: number) {
  const next = new Set(intermediateExpanded.value);
  if (next.has(idx)) {
    next.delete(idx);
  } else {
    next.add(idx);
  }
  intermediateExpanded.value = next;
}

onMounted(() => {
  if (!props.iconOnly) ensureIntermediateNotesLoaded();
});

onBeforeUnmount(removeIconPopoverListeners);
</script>

<template>
  <!-- Icon-only structured notes: preserve dense table rows while keeping the notes preview in a popover. -->
  <span v-if="iconOnly && hasStructuredNotes" class="inline-flex">
    <AppIconButton
      icon="file-text"
      :size="iconSize"
      variant="muted"
      :tooltip="releaseNotesLabel"
      :aria-label="releaseNotesLabel"
      aria-haspopup="dialog"
      :aria-expanded="String(iconPopoverOpen)"
      :data-test="iconTestId"
      @click.stop="toggleIconPopover"
    />
    <Teleport to="body">
      <Transition name="menu-fade">
        <div
          v-if="iconPopoverOpen"
          class="dd-rounded shadow-lg overflow-y-auto text-left"
          :style="{
            ...iconPopoverStyle,
            zIndex: 'var(--z-popover)',
            backgroundColor: 'var(--dd-bg-card)',
            border: '1px solid var(--dd-border-strong)',
            boxShadow: 'var(--dd-shadow-tooltip)',
          }"
          role="dialog"
          :aria-label="releaseNotesLabel"
          data-test="release-notes-popover"
          @click.stop
        >
          <div
            class="flex items-center justify-between gap-2 px-3 py-2"
            :style="{ backgroundColor: 'var(--dd-bg-sidebar)' }"
          >
            <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-secondary">
              {{ releaseNotesLabel }}
            </span>
            <AppIconButton
              icon="xmark"
              size="xs"
              variant="muted"
              :tooltip="t('common.close')"
              :aria-label="t('common.close')"
              @click.stop="closeIconPopover"
            />
          </div>
          <div class="p-2.5 space-y-2">
            <div v-if="showCurrentPanel" class="space-y-1" data-test="current-release-notes-panel">
              <AppButton
                size="compact"
                variant="plain"
                weight="medium"
                class="w-full min-w-0 flex items-center justify-between gap-2 px-2 py-1.5 dd-rounded dd-text-info hover:dd-bg-elevated transition-colors"
                @click.stop="currentExpanded = !currentExpanded"
              >
                <span class="min-w-0 inline-flex items-center gap-1.5">
                  <AppIcon name="file-text" :size="12" class="shrink-0" />
                  <span class="truncate">{{ currentPopoverLabel }}</span>
                </span>
                <AppIcon
                  :name="currentExpanded ? 'chevron-up' : 'chevron-down'"
                  :size="10"
                  class="shrink-0"
                />
              </AppButton>
              <div
                v-if="currentExpanded && props.currentReleaseNotes"
                class="px-2.5 py-2 dd-rounded text-2xs-plus space-y-1.5"
                :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
              >
                <div class="font-semibold dd-text">{{ props.currentReleaseNotes.title }}</div>
                <div class="dd-text-secondary whitespace-pre-line break-words">
                  {{ truncateBody(props.currentReleaseNotes.body) }}
                </div>
                <a
                  :href="props.currentReleaseNotes.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1 text-2xs underline hover:no-underline dd-text-info"
                >
                  {{ t('containerComponents.releaseNotesLink.viewFullNotes') }}
                  <AppIcon name="external-link" :size="10" />
                </a>
              </div>
            </div>
            <div v-if="props.releaseNotes" class="space-y-1" data-test="update-release-notes-panel">
              <AppButton
                size="compact"
                variant="plain"
                weight="medium"
                class="w-full min-w-0 flex items-center justify-between gap-2 px-2 py-1.5 dd-rounded dd-text-info hover:dd-bg-elevated transition-colors"
                @click.stop="updateExpanded = !updateExpanded"
              >
                <span class="min-w-0 inline-flex items-center gap-1.5">
                  <AppIcon name="file-text" :size="12" class="shrink-0" />
                  <span class="truncate">{{ updatePopoverLabel }}</span>
                </span>
                <AppIcon
                  :name="updateExpanded ? 'chevron-up' : 'chevron-down'"
                  :size="10"
                  class="shrink-0"
                />
              </AppButton>
              <div
                v-if="updateExpanded"
                class="px-2.5 py-2 dd-rounded text-2xs-plus space-y-1.5"
                :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
              >
                <div class="font-semibold dd-text">{{ props.releaseNotes.title }}</div>
                <div class="dd-text-secondary whitespace-pre-line break-words">
                  {{ truncateBody(props.releaseNotes.body) }}
                </div>
                <a
                  :href="props.releaseNotes.url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex items-center gap-1 text-2xs underline hover:no-underline dd-text-info"
                >
                  {{ t('containerComponents.releaseNotesLink.viewFullNotes') }}
                  <AppIcon name="external-link" :size="10" />
                </a>
              </div>
            </div>
            <div v-if="intermediateLoading" data-test="intermediate-loading">
              {{ t('containerComponents.releaseNotesLink.loadingIntermediateNotes') }}
            </div>
            <div
              v-if="hasIntermediateNotes"
              class="space-y-1"
              data-test="intermediate-release-notes-section"
            >
              <div class="px-2 py-1.5 text-2xs-plus font-semibold dd-text-secondary">
                {{
                  t('containerComponents.releaseNotesLink.intermediateNotes', {
                    count: intermediateNotes.length,
                  })
                }}
              </div>
              <div
                v-for="(note, idx) in intermediateNotes"
                :key="idx"
                data-test="intermediate-release-note-row"
              >
                <AppButton
                  size="compact"
                  variant="plain"
                  weight="medium"
                  class="w-full min-w-0 flex items-center justify-between gap-2 px-2 py-1.5 dd-rounded dd-text-info hover:dd-bg-elevated transition-colors"
                  @click.stop="toggleIntermediate(idx)"
                >
                  <span class="min-w-0 inline-flex items-center gap-1.5">
                    <AppIcon name="file-text" :size="12" class="shrink-0" />
                    <span class="truncate">{{ note.title }}</span>
                  </span>
                  <AppIcon
                    :name="intermediateExpanded.has(idx) ? 'chevron-up' : 'chevron-down'"
                    :size="10"
                    class="shrink-0"
                  />
                </AppButton>
                <div
                  v-if="intermediateExpanded.has(idx)"
                  class="px-2.5 py-2 dd-rounded text-2xs-plus space-y-1.5"
                  :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
                >
                  <p class="dd-text-secondary whitespace-pre-line break-words">
                    {{ truncateBody(note.body) }}
                  </p>
                  <a
                    v-if="note.url"
                    :href="note.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex items-center gap-1 text-2xs underline hover:no-underline dd-text-info"
                  >
                    {{ t('containerComponents.releaseNotesLink.viewFullNotes') }}
                    <AppIcon name="external-link" :size="10" />
                  </a>
                </div>
              </div>
              <div
                v-if="intermediateHiddenCount > 0"
                class="px-2 py-1.5 text-2xs-plus dd-text-muted"
                data-test="intermediate-older-hidden"
              >
                {{
                  t(
                    'containerComponents.releaseNotesLink.olderReleasesNotShown',
                    intermediateHiddenCount,
                    { count: intermediateHiddenCount },
                  )
                }}
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </span>
  <!-- Icon-only fallback: no structured notes, but still open a popover with a single external link row. -->
  <span v-else-if="iconOnly && props.releaseLink" class="inline-flex">
    <AppIconButton
      icon="file-text"
      :size="iconSize"
      variant="muted"
      :tooltip="releaseNotesLabel"
      :aria-label="releaseNotesLabel"
      aria-haspopup="dialog"
      :aria-expanded="String(iconPopoverOpen)"
      :data-test="iconTestId"
      @click.stop="toggleIconPopover"
    />
    <Teleport to="body">
      <Transition name="menu-fade">
        <div
          v-if="iconPopoverOpen"
          class="dd-rounded shadow-lg overflow-y-auto text-left"
          :style="{
            ...iconPopoverStyle,
            zIndex: 'var(--z-popover)',
            backgroundColor: 'var(--dd-bg-card)',
            border: '1px solid var(--dd-border-strong)',
            boxShadow: 'var(--dd-shadow-tooltip)',
          }"
          role="dialog"
          :aria-label="releaseNotesLabel"
          data-test="release-notes-popover"
          @click.stop
        >
          <div
            class="flex items-center justify-between gap-2 px-3 py-2"
            :style="{ backgroundColor: 'var(--dd-bg-sidebar)' }"
          >
            <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-secondary">
              {{ releaseNotesLabel }}
            </span>
            <AppIconButton
              icon="xmark"
              size="xs"
              variant="muted"
              :tooltip="t('common.close')"
              :aria-label="t('common.close')"
              @click.stop="closeIconPopover"
            />
          </div>
          <div class="p-2.5">
            <a
              :href="props.releaseLink"
              target="_blank"
              rel="noopener noreferrer"
              class="w-full min-w-0 flex items-center justify-between gap-2 px-2 py-1.5 dd-rounded dd-text-info hover:dd-bg-elevated transition-colors"
              data-test="release-link-row"
              @click="closeIconPopover"
            >
              <span class="min-w-0 inline-flex items-center gap-1.5">
                <AppIcon name="file-text" :size="12" class="shrink-0" />
                <span class="truncate">{{ releaseNotesLabel }}</span>
              </span>
              <AppIcon name="external-link" :size="10" class="shrink-0" />
            </a>
          </div>
        </div>
      </Transition>
    </Teleport>
  </span>
  <!-- Inline release notes: render up to two panels (current running tag + new update tag) -->
  <div
    v-else-if="props.releaseNotes || props.currentReleaseNotes"
    class="inline-flex flex-col gap-1.5"
    data-test="release-notes-link"
  >
    <!-- Current running tag -->
    <div v-if="showCurrentPanel" class="inline-flex flex-col" data-test="current-release-notes-panel">
      <AppButton
        size="compact"
        variant="text-info"
        weight="none"
        class="inline-flex items-center gap-1 underline hover:no-underline transition-colors"
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
          class="inline-flex items-center gap-1 text-2xs underline hover:no-underline dd-text-info"
        >
          {{ t('containerComponents.releaseNotesLink.viewFullNotes') }}
          <AppIcon name="external-link" :size="10" />
        </a>
      </div>
    </div>
    <!-- New update target tag -->
    <div v-if="props.releaseNotes" class="inline-flex flex-col" data-test="update-release-notes-panel">
      <AppButton
        size="compact"
        variant="text-info"
        weight="none"
        class="inline-flex items-center gap-1 underline hover:no-underline transition-colors"
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
          class="inline-flex items-center gap-1 text-2xs underline hover:no-underline dd-text-info"
        >
          {{ t('containerComponents.releaseNotesLink.viewFullNotes') }}
          <AppIcon name="external-link" :size="10" />
        </a>
      </div>
    </div>
    <!-- Intermediate release notes (inline mode) -->
    <div v-if="intermediateLoading" data-test="intermediate-loading">
      {{ t('containerComponents.releaseNotesLink.loadingIntermediateNotes') }}
    </div>
    <div
      v-if="hasIntermediateNotes"
      class="inline-flex flex-col gap-1"
      data-test="intermediate-release-notes-section"
    >
      <div class="text-2xs-plus font-semibold dd-text-secondary">
        {{
          t('containerComponents.releaseNotesLink.intermediateNotes', {
            count: intermediateNotes.length,
          })
        }}
      </div>
      <div
        v-for="(note, idx) in intermediateNotes"
        :key="idx"
        class="inline-flex flex-col"
        data-test="intermediate-release-note-row"
      >
        <AppButton
          size="compact"
          variant="text-info"
          weight="none"
          class="inline-flex items-center gap-1 underline hover:no-underline transition-colors"
          @click.stop="toggleIntermediate(idx)"
        >
          <AppIcon name="file-text" :size="12" />
          {{ note.title }}
          <AppIcon :name="intermediateExpanded.has(idx) ? 'chevron-up' : 'chevron-down'" :size="10" />
        </AppButton>
        <div
          v-if="intermediateExpanded.has(idx)"
          class="mt-2 px-2.5 py-2 dd-rounded text-2xs-plus space-y-1.5"
          :style="{ backgroundColor: 'var(--dd-bg-inset)' }"
          @click.stop
        >
          <p class="dd-text-secondary whitespace-pre-line break-words">
            {{ truncateBody(note.body) }}
          </p>
          <a
            v-if="note.url"
            :href="note.url"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-2xs underline hover:no-underline dd-text-info"
          >
            {{ t('containerComponents.releaseNotesLink.viewFullNotes') }}
            <AppIcon name="external-link" :size="10" />
          </a>
        </div>
      </div>
      <div
        v-if="intermediateHiddenCount > 0"
        class="text-2xs-plus dd-text-muted"
        data-test="intermediate-older-hidden"
      >
        {{
          t(
            'containerComponents.releaseNotesLink.olderReleasesNotShown',
            intermediateHiddenCount,
            { count: intermediateHiddenCount },
          )
        }}
      </div>
    </div>
  </div>
  <!-- Fallback: simple external release link -->
  <a
    v-else-if="props.releaseLink"
    :href="props.releaseLink"
    target="_blank"
    rel="noopener noreferrer"
    class="inline-flex items-center gap-1 text-2xs-plus underline hover:no-underline dd-text-info"
    data-test="release-link"
  >
    <AppIcon name="file-text" :size="12" />
    {{ t('containerComponents.releaseNotesLink.releaseNotes') }}
  </a>
</template>
