<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import AnnouncementBanner from './AnnouncementBanner.vue';
import { useConnectivity } from '@/composables/useConnectivity';

// Overrides AnnouncementBanner's own `fixed` positioning so it stacks inside
// AppLayout's shared banner rail with the other banners.
const stackedBannerInlineStyle = {
  position: 'static',
  top: 'auto',
  left: 'auto',
  translate: 'none',
  width: '100%',
  maxWidth: 'none',
};

const { t, locale } = useI18n();
const { status, lastKnownAt } = useConnectivity();

// Dismissal lasts until the connectivity state changes, so a fresh outage
// always re-surfaces the banner.
const dismissed = ref(false);
watch(status, () => {
  dismissed.value = false;
});

const visible = computed(() => status.value !== 'online' && !dismissed.value);
const offline = computed(() => status.value === 'offline');
const lastUpdated = computed(() =>
  lastKnownAt.value === null
    ? ''
    : t('appShell.offline.lastUpdated', {
        time: new Date(lastKnownAt.value).toLocaleString(locale.value, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }),
      }),
);
</script>

<template>
  <AnnouncementBanner
    v-if="visible"
    data-testid="offline-banner"
    tone="warning"
    icon="warning"
    :title="offline ? t('appShell.offline.offlineTitle') : t('appShell.offline.unreachableTitle')"
    :style="stackedBannerInlineStyle"
    @dismiss="dismissed = true">
    {{ offline ? t('appShell.offline.offlineBody') : t('appShell.offline.unreachableBody') }}
    <span v-if="lastUpdated" data-testid="offline-banner-last-updated">{{ lastUpdated }}</span>
  </AnnouncementBanner>
</template>
