<script setup lang="ts">
import { computed, ref, useId } from 'vue';
import { useI18n } from 'vue-i18n';
import AppButton from './AppButton.vue';
import { ROUTING_THRESHOLDS } from '../composables/labelOverrideLists';

const props = withDefaults(
  defineProps<{
    modelValue: string[];
    /** Names offered in the datalist. */
    suggestions: string[];
    /** Whether a value outside the suggestions can be added. */
    freeEntry: boolean;
    /** Whether the add row has a threshold select. */
    thresholds: boolean;
    inputLabel: string;
    /** The first entries are fixed and have no remove button. */
    lockedCount?: number;
    /** Thresholds allowed for the typed reference; defaults to all twelve. */
    thresholdChoices?: (reference: string) => string[];
    canAdd?: boolean;
    disabled?: boolean;
  }>(),
  {
    lockedCount: 0,
    thresholdChoices: undefined,
    canAdd: true,
    disabled: false,
  },
);
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();

const { t } = useI18n();
const inputStyle = { backgroundColor: 'var(--dd-bg)', border: '1px solid var(--dd-border)' };
const listId = `label-overrides-datalist-${useId()}`;

const typed = ref('');
const threshold = ref('');

const reference = computed(() => typed.value.trim());
const choices = computed(() =>
  props.thresholdChoices ? props.thresholdChoices(reference.value) : [...ROUTING_THRESHOLDS],
);
const isSuggested = computed(() =>
  props.suggestions.some((name) => name.toLowerCase() === reference.value.toLowerCase()),
);
const canSubmit = computed(
  () =>
    !props.disabled &&
    reference.value !== '' &&
    (props.freeEntry || isSuggested.value) &&
    (!props.thresholds || choices.value.length > 0),
);

/** A restricted choice list has no blank option, so its first allowed value applies. */
const picked = computed(() => {
  if (!props.thresholds) return '';
  if (choices.value.includes(threshold.value)) return threshold.value;
  return props.thresholdChoices ? choices.value[0] : '';
});

function add() {
  if (!canSubmit.value) return;
  emit('update:modelValue', [
    ...props.modelValue,
    picked.value === '' ? reference.value : `${reference.value}:${picked.value}`,
  ]);
  typed.value = '';
  threshold.value = '';
}

function remove(index: number) {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, position) => position !== index),
  );
}
</script>

<template>
  <div class="space-y-2">
    <ul v-if="modelValue.length > 0" class="flex flex-wrap gap-1" :aria-label="inputLabel">
      <li
        v-for="(entry, index) in modelValue"
        :key="`${index}:${entry}`"
        class="flex items-center gap-1 px-2 py-1 dd-rounded font-mono dd-text-body"
        :style="{ backgroundColor: 'var(--dd-bg-card)' }"
        :data-locked="index < lockedCount ? 'true' : 'false'"
        data-testid="label-overrides-list-entry"
      >
        <span>{{ entry }}</span>
        <span v-if="index < lockedCount" class="dd-text-card-description font-sans">
          {{ t('labelOverrides.editor.locked') }}
        </span>
        <AppButton
          v-else
          variant="text-danger"
          size="xs"
          :disabled="disabled"
          :aria-label="t('labelOverrides.editor.removeEntry', { entry })"
          :data-testid="`label-overrides-list-remove-${entry}`"
          @click="remove(index)"
        >
          &times;
        </AppButton>
      </li>
    </ul>

    <div v-if="canAdd" class="flex flex-wrap items-end gap-2">
      <label class="block space-y-1 grow">
        <span class="dd-text-label dd-text-muted">{{ inputLabel }}</span>
        <input
          v-model="typed"
          type="text"
          :list="listId"
          autocomplete="off"
          spellcheck="false"
          :disabled="disabled"
          class="w-full px-3 py-2 dd-rounded dd-text-value font-mono disabled:opacity-60"
          :style="inputStyle"
          data-testid="label-overrides-list-input"
          @keydown.enter.prevent="add"
        />
        <datalist :id="listId">
          <option v-for="name in suggestions" :key="name" :value="name" />
        </datalist>
      </label>
      <label v-if="thresholds" class="block space-y-1">
        <span class="dd-text-label dd-text-muted">{{ t('labelOverrides.editor.threshold') }}</span>
        <select
          :value="picked"
          @change="threshold = ($event.target as HTMLSelectElement).value"
          :disabled="disabled"
          class="px-3 py-2 dd-rounded dd-text-value disabled:opacity-60"
          :style="inputStyle"
          data-testid="label-overrides-list-threshold"
        >
          <option v-if="!thresholdChoices" value="">{{ t('labelOverrides.editor.thresholdDefault') }}</option>
          <option v-for="choice in choices" :key="choice" :value="choice">{{ choice }}</option>
        </select>
      </label>
      <AppButton
        variant="outlined"
        size="sm"
        :disabled="!canSubmit"
        data-testid="label-overrides-list-add"
        @click="add"
      >
        {{ t('labelOverrides.editor.addEntry') }}
      </AppButton>
    </div>
  </div>
</template>
