<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

interface ProfileData {
  username: string;
  displayName: string;
  email: string;
  role: string;
  provider: string;
  lastLogin: string;
  sessions: number;
}

const props = defineProps<{
  profileInitials: string;
  profileDisplayName: string;
  profileData: ProfileData;
  profileLoading: boolean;
  profileError: string;
}>();
</script>

<template>
  <div class="space-y-6">
    <div
      class="dd-rounded overflow-hidden"
      :style="{
        backgroundColor: 'var(--dd-bg-card)',
      }"
    >
      <div class="px-5 py-5 flex items-center gap-4">
        <div
          class="w-12 h-12 rounded-full flex items-center justify-center text-base font-bold text-white shrink-0"
          style="background: linear-gradient(135deg, var(--dd-primary), var(--dd-success));"
        >
          {{ props.profileInitials }}
        </div>
        <div class="min-w-0">
          <div class="text-sm font-bold dd-text truncate">{{ props.profileDisplayName }}</div>
          <div class="text-2xs-plus dd-text-muted truncate">
            {{ props.profileData.email || props.profileData.username || '—' }}
          </div>
          <span
            v-if="props.profileData.role"
            class="badge text-3xs font-semibold mt-1 inline-flex"
            :style="{ backgroundColor: 'var(--dd-primary-muted)', color: 'var(--dd-primary)' }"
          >
            {{ props.profileData.role }}
          </span>
        </div>
      </div>
      <div class="p-5 space-y-4">
        <div v-if="props.profileLoading" class="flex items-center justify-center gap-2 text-xs dd-text-muted py-4">
          <AppIcon name="refresh" :size="12" class="animate-spin" />
          {{ t('configView.profile.loading') }}
        </div>
        <div
          v-else-if="props.profileError"
          class="text-2xs-plus px-3 py-2 dd-rounded"
          :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }"
        >
          {{ props.profileError }}
        </div>
        <template v-else>
          <div class="flex items-center justify-between py-2" :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">{{ t('configView.profile.fields.username') }}</span>
            <span class="text-xs font-medium font-mono dd-text">{{ props.profileData.username || '—' }}</span>
          </div>
          <div class="flex items-center justify-between py-2" :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">{{ t('configView.profile.fields.email') }}</span>
            <span class="text-xs font-medium font-mono dd-text">{{ props.profileData.email || '—' }}</span>
          </div>
          <div class="flex items-center justify-between py-2" :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">{{ t('configView.profile.fields.role') }}</span>
            <span class="text-xs font-medium font-mono dd-text">{{ props.profileData.role || '—' }}</span>
          </div>
          <div class="flex items-center justify-between py-2" :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">{{ t('configView.profile.fields.provider') }}</span>
            <span class="text-xs font-medium font-mono dd-text">{{ props.profileData.provider || '—' }}</span>
          </div>
          <div class="flex items-center justify-between py-2" :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">{{ t('configView.profile.fields.lastLogin') }}</span>
            <span class="text-xs font-medium font-mono dd-text">{{ props.profileData.lastLogin || '—' }}</span>
          </div>
          <div class="flex items-center justify-between py-2">
            <span class="text-2xs-plus font-semibold uppercase tracking-wider dd-text-muted">{{ t('configView.profile.fields.activeSessions') }}</span>
            <span class="text-xs font-medium font-mono dd-text">{{ props.profileData.sessions }}</span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
