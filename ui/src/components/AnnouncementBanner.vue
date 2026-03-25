<script setup lang="ts">
import { computed, ref, useAttrs } from 'vue';

type BannerTone = 'warning' | 'error';

const props = withDefaults(
  defineProps<{
    title: string;
    icon?: string;
    tone?: BannerTone;
    dismissLabel?: string;
    permanentDismissLabel?: string;
    linkHref?: string;
    linkLabel?: string;
  }>(),
  {
    tone: 'warning',
  },
);

const emit = defineEmits<{
  dismiss: [];
  'dismiss-permanent': [];
}>();

const attrs = useAttrs();
const testIdPrefix = attrs['data-testid'] as string | undefined;

const permanentDismissChecked = ref(false);

function handleDismiss() {
  if (permanentDismissChecked.value) {
    emit('dismiss-permanent');
  } else {
    emit('dismiss');
  }
}

const toneStyles = computed(() => {
  if (props.tone === 'error') {
    return {
      backgroundColor: 'color-mix(in srgb, var(--dd-danger) 25%, var(--dd-bg-card))',
      borderColor: 'var(--dd-danger)',
      textColor: 'var(--dd-danger)',
      buttonTextColor: 'var(--dd-danger)',
      buttonBackgroundColor: 'transparent',
      buttonBorderColor: 'var(--dd-danger)',
      iconName: props.icon ?? 'warning',
    };
  }

  return {
    backgroundColor: 'color-mix(in srgb, var(--dd-warning) 25%, var(--dd-bg-card))',
    borderColor: 'var(--dd-warning)',
    textColor: 'var(--dd-warning)',
    buttonTextColor: 'var(--dd-warning)',
    buttonBackgroundColor: 'transparent',
    buttonBorderColor: 'var(--dd-warning)',
    iconName: props.icon ?? 'warning',
  };
});
</script>

<template>
  <div
    class="fixed top-3 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-5xl dd-rounded px-3 py-2.5 flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between"
    :style="{
      backgroundColor: toneStyles.backgroundColor,
      border: `1px solid ${toneStyles.borderColor}`,
      boxShadow: 'var(--dd-shadow-lg)',
    }">
    <div class="flex items-start gap-2.5 min-w-0">
      <AppIcon
        :name="toneStyles.iconName"
        :size="14"
        class="shrink-0 mt-0.5"
        :style="{ color: toneStyles.textColor }" />
      <div class="min-w-0">
        <p class="text-xs font-semibold" :style="{ color: toneStyles.textColor }">
          {{ title }}
        </p>
        <p class="text-2xs-plus mt-0.5" :style="{ color: 'var(--dd-text)' }">
          <slot />
        </p>
      </div>
    </div>
    <div class="flex flex-col items-end gap-1.5 shrink-0">
      <a v-if="linkHref"
        :href="linkHref"
        target="_blank"
        rel="noopener noreferrer"
        :data-testid="testIdPrefix ? `${testIdPrefix}-link` : undefined"
        class="inline-flex items-center gap-1 text-2xs-plus px-2.5 py-1.5 dd-rounded transition-colors w-full justify-center"
        :style="{
          border: `1px solid ${toneStyles.buttonBorderColor}`,
          color: toneStyles.buttonTextColor,
          backgroundColor: toneStyles.buttonBackgroundColor,
        }">
        {{ linkLabel ?? 'Learn more' }}
        <AppIcon name="external-link" :size="10" />
      </a>
      <AppButton size="none" variant="plain" weight="none"
        :data-testid="testIdPrefix ? `${testIdPrefix}-dismiss-session` : undefined"
        class="text-2xs-plus px-2.5 py-1.5 dd-rounded transition-colors w-full text-center"
        :style="{
          border: `1px solid ${toneStyles.buttonBorderColor}`,
          color: toneStyles.buttonTextColor,
          backgroundColor: toneStyles.buttonBackgroundColor,
        }"
        @click="handleDismiss">
        {{ dismissLabel ?? 'Dismiss' }}
      </AppButton>
      <label v-if="permanentDismissLabel !== undefined"
        :data-testid="testIdPrefix ? `${testIdPrefix}-dismiss-forever` : undefined"
        class="flex items-center gap-1.5 cursor-pointer">
        <input
          type="checkbox"
          v-model="permanentDismissChecked"
          class="shrink-0 w-3 h-3 dd-rounded-sm cursor-pointer" />
        <span class="text-3xs dd-text-muted">{{ permanentDismissLabel }}</span>
      </label>
    </div>
  </div>
</template>
