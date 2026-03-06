<script setup lang="ts">
import { computed, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    icon: string;
    size?: number;
  }>(),
  { size: 20 },
);

const failed = ref(false);

/**
 * Resolve the icon string into a renderable format.
 *
 * Icon formats:
 *   sh-{slug}   → selfhst provider, proxy via /api/icons/selfhst/{slug}
 *   hl-{slug}   → homarr provider, proxy via /api/icons/homarr/{slug}
 *   si-{slug}   → simple-icons provider, proxy via /api/icons/simple/{slug}
 *   http(s)://  → direct URL (user-set custom icon)
 *   fa*         → Font Awesome class (legacy fallback)
 *   other       → treat as selfhst slug
 */
const resolved = computed(() => {
  const icon = props.icon;
  if (!icon) return { type: 'fallback' as const };

  if (icon.startsWith('sh-')) {
    return { type: 'proxy' as const, src: `/api/icons/selfhst/${icon.slice(3)}` };
  }
  if (icon.startsWith('hl-')) {
    return { type: 'proxy' as const, src: `/api/icons/homarr/${icon.slice(3)}` };
  }
  if (icon.startsWith('si-')) {
    return { type: 'proxy' as const, src: `/api/icons/simple/${icon.slice(3)}` };
  }
  if (icon.startsWith('http://') || icon.startsWith('https://')) {
    return { type: 'url' as const, src: icon };
  }
  // Treat anything else as a selfhst slug
  return { type: 'proxy' as const, src: `/api/icons/selfhst/${icon}` };
});
</script>

<template>
  <div class="inline-flex items-center justify-center shrink-0"
       :style="{ width: size + 'px', height: size + 'px' }">
    <img v-if="!failed"
         :src="resolved.src"
         class="max-w-full max-h-full object-contain"
         loading="lazy"
         @error="failed = true" />
    <AppIcon v-else name="containers" :size="size" class="dd-text-muted" />
  </div>
</template>
