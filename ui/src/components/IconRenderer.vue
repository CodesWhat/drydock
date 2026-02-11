<template>
  <!-- Fallback: show font icon when image failed to load -->
  <v-icon v-if="imgFailed" :style="iconStyle">
    {{ fallbackIcon }}
  </v-icon>
  <img
    v-else-if="isHomarrIcon"
    :src="homarrIconUrl"
    :style="imageStyle"
    :alt="icon"
    @error="onImgError"
  />
  <img
    v-else-if="isSelfhstIcon"
    :src="selfhstIconUrl"
    :style="imageStyle"
    :alt="icon"
    @error="onImgError"
  />
  <img
    v-else-if="isSimpleIcon"
    :src="simpleIconUrl"
    :style="imageStyle"
    :alt="icon"
    class="simple-icon"
    @error="onImgError"
  />
  <img
    v-else-if="isCustomIconUrl"
    :src="customIconUrl"
    :style="imageStyle"
    :alt="icon"
    class="custom-icon"
    @error="onImgError"
  />
  <v-icon v-else :style="iconStyle">
    {{ normalizedIcon }}
  </v-icon>
</template>

<script lang="ts" src="./IconRenderer.ts"></script>

<style scoped>
.simple-icon {
  filter: brightness(0) saturate(100%) opacity(0.87);
}

.v-theme--dark .simple-icon {
  filter: brightness(0) saturate(100%) invert(1) opacity(0.87);
}

.custom-icon {
  object-fit: contain;
}
</style>
