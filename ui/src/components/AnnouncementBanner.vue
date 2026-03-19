<script setup lang="ts">
import { computed, useAttrs } from 'vue';

type BannerTone = 'warning' | 'error';

const props = withDefaults(
  defineProps<{
    title: string;
    icon?: string;
    tone?: BannerTone;
    dismissLabel?: string;
    permanentDismissLabel?: string;
  }>(),
  {
    tone: 'warning',
  },
);

defineEmits<{
  dismiss: [];
  'dismiss-permanent': [];
}>();

const attrs = useAttrs();
const testIdPrefix = attrs['data-testid'] as string | undefined;

const toneStyles = computed(() => {
  if (props.tone === 'error') {
    return {
      backgroundColor: 'color-mix(in srgb, var(--dd-danger) 25%, var(--dd-bg-card))',
      borderColor: 'var(--dd-danger)',
      textColor: 'var(--dd-danger)',
      buttonTextColor: 'var(--dd-danger)',
      buttonBackgroundColor: 'transparent',
      buttonBorderColor: 'var(--dd-danger)',
      permanentButtonTextColor: 'var(--dd-bg)',
      permanentButtonBackgroundColor: 'var(--dd-danger)',
      permanentButtonBorderColor: 'var(--dd-danger)',
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
    permanentButtonTextColor: 'var(--dd-bg)',
    permanentButtonBackgroundColor: 'var(--dd-warning)',
    permanentButtonBorderColor: 'var(--dd-warning)',
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
    <div class="flex items-center gap-2 shrink-0">
      <AppButton size="none" variant="plain" weight="none"
        :data-testid="testIdPrefix ? `${testIdPrefix}-dismiss-session` : undefined"
        class="text-2xs-plus px-2.5 py-1.5 dd-rounded transition-colors"
        :style="{
          border: `1px solid ${toneStyles.buttonBorderColor}`,
          color: toneStyles.buttonTextColor,
          backgroundColor: toneStyles.buttonBackgroundColor,
        }"
        @click="$emit('dismiss')">
        {{ dismissLabel ?? 'Dismiss' }}
      </AppButton>
      <AppButton size="none" variant="plain" weight="none"
        v-if="permanentDismissLabel !== undefined"
        :data-testid="testIdPrefix ? `${testIdPrefix}-dismiss-forever` : undefined"
        class="text-2xs-plus px-2.5 py-1.5 dd-rounded transition-colors"
        :style="{
          border: `1px solid ${toneStyles.permanentButtonBorderColor}`,
          color: toneStyles.permanentButtonTextColor,
          backgroundColor: toneStyles.permanentButtonBackgroundColor,
        }"
        @click="$emit('dismiss-permanent')">
        {{ permanentDismissLabel }}
      </AppButton>
    </div>
  </div>
</template>
