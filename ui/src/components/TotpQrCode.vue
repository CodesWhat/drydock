<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { encode } from 'uqr';

const props = defineProps<{
  /** The otpauth: URI. It is encoded in this browser and goes nowhere else. */
  value: string;
  label: string;
}>();

const { t } = useI18n();

/** Spec quiet zone: four modules on every side. */
const QUIET_ZONE = 4;

interface Drawing {
  size: number;
  path: string;
}

/**
 * One `M x y h w v1 h-w z` run per stretch of dark modules in a row. A single
 * path keeps the DOM small and the code crisp at any scale, and nothing here
 * is an image, a URL or a request.
 */
const drawing = computed<Drawing | 'failed' | undefined>(() => {
  if (!props.value) {
    return undefined;
  }
  try {
    const { data, size } = encode(props.value, { ecc: 'M', border: 0 });
    const runs: string[] = [];
    data.forEach((row, y) => {
      let x = 0;
      while (x < size) {
        if (!row[x]) {
          x += 1;
          continue;
        }
        const start = x;
        while (x < size && row[x]) {
          x += 1;
        }
        runs.push(`M${start} ${y}h${x - start}v1h-${x - start}z`);
      }
    });
    return { size, path: runs.join('') };
  } catch {
    return 'failed';
  }
});
</script>

<template>
  <svg
    v-if="drawing && drawing !== 'failed'"
    role="img"
    :aria-label="label"
    :viewBox="`${-QUIET_ZONE} ${-QUIET_ZONE} ${drawing.size + QUIET_ZONE * 2} ${drawing.size + QUIET_ZONE * 2}`"
    shape-rendering="crispEdges"
    class="block w-full h-full"
    xmlns="http://www.w3.org/2000/svg"
  >
    <rect
      :x="-QUIET_ZONE"
      :y="-QUIET_ZONE"
      :width="drawing.size + QUIET_ZONE * 2"
      :height="drawing.size + QUIET_ZONE * 2"
      fill="#fff"
    />
    <path :d="drawing.path" fill="#000" />
  </svg>
  <p v-else-if="drawing === 'failed'" class="dd-text-body dd-text-muted" data-testid="totp-qr-failed">
    {{ t('totpFactor.scan.qrFailed') }}
  </p>
</template>
