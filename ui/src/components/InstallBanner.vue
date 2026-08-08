<script setup lang="ts">
import { watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AnnouncementBanner from './AnnouncementBanner.vue';
import { useDeprecationBanner } from '@/composables/useDeprecationBanner';
import { useInstallPrompt } from '@/composables/useInstallPrompt';

// Versioned so a future redesign of this banner can re-surface for anyone
// who dismissed the old copy.
const DISMISS_STORAGE_KEY = 'dd-banner-pwa-install-v1';

// Overrides AnnouncementBanner's own `fixed` positioning so multiple banners
// stack as normal flex items inside AppLayout's shared banner rail, matching
// the other AnnouncementBanner usages there.
const stackedBannerInlineStyle = {
  position: 'static',
  top: 'auto',
  left: 'auto',
  translate: 'none',
  width: '100%',
  maxWidth: 'none',
};

const { t } = useI18n();

const installPrompt = useInstallPrompt();
const dismissal = useDeprecationBanner(DISMISS_STORAGE_KEY);

watch(
  installPrompt.available,
  (value) => {
    dismissal.detected.value = value;
  },
  { immediate: true },
);

async function handleInstall() {
  await installPrompt.promptInstall();
}
</script>

<template>
  <AnnouncementBanner
    v-if="dismissal.visible.value"
    data-testid="pwa-install-banner"
    tone="info"
    icon="updates"
    :title="t('appShell.banners.installTitle')"
    :action-label="t('appShell.banners.installAction')"
    :style="stackedBannerInlineStyle"
    @action="handleInstall"
    @dismiss="dismissal.dismissPermanently">
    {{ t('appShell.banners.installBody') }}
  </AnnouncementBanner>
</template>
