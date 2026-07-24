<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { Container } from '../../types/container';

const props = defineProps<{
  container: Container | null;
  initialGroup: string;
  hasManualOverride: boolean;
  suggestions: string[];
}>();

const emit = defineEmits<{
  close: [];
  save: [groupName: string];
  clear: [];
}>();

const { t } = useI18n();
const groupName = ref('');
const groupInput = ref<HTMLInputElement | null>(null);

watch(
  () => props.container,
  async (container) => {
    if (!container) {
      groupName.value = '';
      return;
    }
    groupName.value = props.initialGroup;
    await nextTick();
    groupInput.value?.focus();
    groupInput.value?.select();
  },
);

function save() {
  const normalized = groupName.value.trim();
  if (!normalized) {
    return;
  }
  emit('save', normalized);
}
</script>

<template>
  <Teleport to="body">
    <Transition name="container-group-dialog-fade">
      <div
        v-if="container"
        class="fixed inset-0 z-overlay bg-black/50 backdrop-blur-sm flex items-start justify-center pt-[20vh]"
        @pointerdown.self="emit('close')"
        @keydown.escape.stop.prevent="emit('close')">
        <form
          class="relative w-full max-w-[var(--dd-layout-dialog-max-width)] min-w-[var(--dd-layout-dialog-min-width)] mx-4 dd-rounded-lg overflow-hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="container-group-dialog-title"
          aria-describedby="container-group-dialog-description"
          :style="{
            backgroundColor: 'var(--dd-bg-card)',
            border: '1px solid var(--dd-border-strong)',
            boxShadow: 'var(--dd-shadow-modal)',
          }"
          @submit.prevent="save">
          <div class="px-5 pt-4 pb-3" :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <h2 id="container-group-dialog-title" class="text-xs-plus font-semibold dd-text">
              {{ t('containerComponents.groupDialog.title') }}
            </h2>
          </div>
          <div class="px-5 py-4.5 space-y-3">
            <p id="container-group-dialog-description" class="text-xs leading-relaxed dd-text-secondary">
              {{ t('containerComponents.groupDialog.description', { name: container.name }) }}
            </p>
            <div class="space-y-1.5">
              <label
                for="container-group-name"
                class="block text-2xs font-semibold uppercase tracking-wide dd-text-secondary">
                {{ t('containerComponents.groupDialog.groupLabel') }}
              </label>
              <input
                id="container-group-name"
                ref="groupInput"
                v-model="groupName"
                type="text"
                list="container-group-suggestions"
                maxlength="80"
                autocomplete="off"
                class="w-full px-3 py-2 text-xs dd-rounded dd-bg dd-text outline-none focus:ring-2 focus:ring-[var(--dd-secondary)]"
                :placeholder="t('containerComponents.groupDialog.groupPlaceholder')" />
              <datalist id="container-group-suggestions">
                <option v-for="suggestion in suggestions" :key="suggestion" :value="suggestion" />
              </datalist>
              <p class="text-2xs dd-text-muted">
                {{ t('containerComponents.groupDialog.helpText') }}
              </p>
            </div>
          </div>
          <div class="px-5 pt-3 pb-4.5 flex items-center gap-2.5">
            <AppButton
              v-if="hasManualOverride"
              data-test="clear-container-group"
              type="button"
              size="md"
              variant="text-danger"
              weight="semibold"
              class="mr-auto"
              @click="emit('clear')">
              {{ t('containerComponents.groupDialog.clear') }}
            </AppButton>
            <span v-else class="mr-auto" />
            <AppButton
              type="button"
              size="md"
              variant="outlined"
              weight="semibold"
              @click="emit('close')">
              {{ t('common.cancel') }}
            </AppButton>
            <AppButton
              data-test="save-container-group"
              type="submit"
              size="md"
              variant="secondary"
              weight="semibold"
              :disabled="!groupName.trim()">
              {{ t('containerComponents.groupDialog.save') }}
            </AppButton>
          </div>
        </form>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.container-group-dialog-fade-enter-active,
.container-group-dialog-fade-leave-active {
  transition: opacity var(--dd-duration-fast) ease;
}

.container-group-dialog-fade-enter-from,
.container-group-dialog-fade-leave-to {
  opacity: 0;
}
</style>
