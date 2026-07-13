<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PickerColumn } from '../composables/useViewColumnVisibility';
import AppIconButton from './AppIconButton.vue';

const props = defineProps<{
  columns: PickerColumn[];
  hiddenKeys: Set<string> | string[];
}>();

const emit = defineEmits<{
  toggle: [key: string];
  reset: [];
}>();

const { t } = useI18n();

const hiddenKeySet = computed(() =>
  props.hiddenKeys instanceof Set ? props.hiddenKeys : new Set(props.hiddenKeys),
);

const hiddenCount = computed(
  () => props.columns.filter((column) => hiddenKeySet.value.has(column.key)).length,
);

function isVisible(key: string): boolean {
  return !hiddenKeySet.value.has(key);
}

function handleToggle(column: PickerColumn): void {
  // Required columns are honest, not just guarded downstream — the picker never emits
  // for them, so nothing upstream needs to re-derive "this click doesn't count".
  if (column.required) return;
  emit('toggle', column.key);
}

function handleReset(): void {
  emit('reset');
}

// ─── Popover open state + flip-aware positioning ─────────────────────────────
// Mirrors buildPopoverStyle in ContainersView.vue (~1266-1282) so this picker's
// popover behaves identically to the Containers column picker it's modeled on.
// Kept component-internal until a later commit dedupes the two copies.

const showPicker = ref(false);
const pickerStyle = ref<Record<string, string>>({});

const COLUMN_PICKER_ESTIMATED_HEIGHT_PX = 360;
const POPOVER_GAP_PX = 4;

type PopoverHorizontalAnchor = { right: number } | { left: number };

function buildPopoverStyle(
  rect: DOMRect,
  horizontalAnchor: PopoverHorizontalAnchor,
  estimatedHeightPx: number,
): Record<string, string> {
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  const flipUp = spaceBelow < estimatedHeightPx && spaceAbove > spaceBelow;
  const verticalAnchor = flipUp
    ? { bottom: `${window.innerHeight - rect.top + POPOVER_GAP_PX}px` }
    : { top: `${rect.bottom + POPOVER_GAP_PX}px` };
  const horizontal =
    'right' in horizontalAnchor
      ? { right: `${horizontalAnchor.right}px` }
      : { left: `${horizontalAnchor.left}px` };
  return { position: 'fixed', ...verticalAnchor, ...horizontal };
}

function togglePicker(event: MouseEvent): void {
  showPicker.value = !showPicker.value;
  if (showPicker.value) {
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();
    pickerStyle.value = buildPopoverStyle(
      rect,
      { left: rect.left },
      COLUMN_PICKER_ESTIMATED_HEIGHT_PX,
    );
  }
}

function closePicker(): void {
  showPicker.value = false;
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !showPicker.value) return;
  closePicker();
}

onMounted(() => {
  document.addEventListener('click', closePicker);
  document.addEventListener('keydown', handleKeydown);
});
onUnmounted(() => {
  document.removeEventListener('click', closePicker);
  document.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div class="hidden sm:flex relative items-center" data-test="data-table-column-picker">
    <AppIconButton
      icon="config"
      size="sm"
      variant="secondary"
      :class="showPicker ? 'dd-text dd-bg-elevated' : ''"
      :tooltip="t('sharedComponents.columnPicker.toggleTooltip')"
      @click.stop="togglePicker($event)" />
    <span
      v-if="hiddenCount > 0"
      class="absolute -top-1 -end-1 pointer-events-none text-3xs font-bold px-1 dd-rounded dd-text-muted dd-bg-elevated leading-tight"
      v-tooltip="t('sharedComponents.columnPicker.hiddenBadgeTooltip', { count: hiddenCount })">
      +{{ hiddenCount }}
    </span>

    <Teleport to="body">
      <div
        v-if="showPicker"
        data-test="data-table-column-picker-panel"
        class="min-w-[160px] py-1.5 dd-rounded shadow-lg"
        :style="{
          ...pickerStyle,
          zIndex: 'var(--z-popover)',
          backgroundColor: 'var(--dd-bg-card)',
          border: '1px solid var(--dd-border-strong)',
          boxShadow: 'var(--dd-shadow-tooltip)',
        }"
        @click.stop>
        <div class="px-3 py-1 text-3xs font-bold uppercase tracking-wider dd-text-muted">
          {{ t('sharedComponents.columnPicker.heading') }}
        </div>
        <AppButton
          v-for="column in columns"
          :key="column.key"
          size="md"
          variant="plain"
          weight="medium"
          class="w-full text-left flex items-center gap-2 hover:dd-bg-elevated"
          :class="column.required ? 'dd-text-muted cursor-not-allowed' : 'dd-text'"
          @click="handleToggle(column)">
          <AppIcon
            :name="isVisible(column.key) ? 'check' : 'square'"
            :size="13"
            :style="isVisible(column.key) ? { color: 'var(--dd-primary)' } : {}" />
          {{ column.label }}
        </AppButton>
        <div class="my-1" :style="{ borderTop: '1px solid var(--dd-border)' }" />
        <AppButton
          size="md"
          variant="plain"
          weight="medium"
          class="w-full text-left dd-text-secondary hover:dd-bg-elevated"
          data-test="data-table-column-picker-reset"
          @click="handleReset">
          {{ t('sharedComponents.columnPicker.reset') }}
        </AppButton>
      </div>
    </Teleport>
  </div>
</template>
