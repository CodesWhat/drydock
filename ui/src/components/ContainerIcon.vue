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
  if (icon.startsWith('fa')) {
    return { type: 'fa' as const, className: icon };
  }
  return { type: 'fallback' as const };
});
</script>

<template>
  <img v-if="(resolved.type === 'proxy' || resolved.type === 'url') && !failed"
       :src="resolved.src"
       :width="size"
       :height="size"
       class="object-contain"
       loading="lazy"
       @error="failed = true" />
  <i v-else-if="resolved.type === 'fa' && !failed"
     :class="[resolved.className, 'dd-text-muted']"
     :style="{ fontSize: size + 'px' }" />
  <i v-else
     class="fab fa-docker dd-text-muted"
     :style="{ fontSize: size + 'px' }" />
</template>
