<script setup lang="ts">
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
        border: '1px solid var(--dd-border-strong)',
      }"
    >
      <div class="px-5 py-5 flex items-center gap-4" :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
        <div
          class="w-12 h-12 rounded-full flex items-center justify-center text-base font-bold text-white shrink-0"
          style="background: linear-gradient(135deg, var(--dd-primary), var(--dd-success));"
        >
          {{ props.profileInitials }}
        </div>
        <div class="min-w-0">
          <div class="text-sm font-bold dd-text truncate">{{ props.profileDisplayName }}</div>
          <div class="text-[0.6875rem] dd-text-muted truncate">
            {{ props.profileData.email || props.profileData.username || '—' }}
          </div>
          <span
            v-if="props.profileData.role"
            class="badge text-[0.5625rem] font-semibold mt-1 inline-flex"
            :style="{ backgroundColor: 'var(--dd-primary-muted)', color: 'var(--dd-primary)' }"
          >
            {{ props.profileData.role }}
          </span>
        </div>
      </div>
      <div class="p-5 space-y-4">
        <div v-if="props.profileLoading" class="flex items-center justify-center gap-2 text-xs dd-text-muted py-4">
          <AppIcon name="refresh" :size="12" class="animate-spin" />
          Loading profile
        </div>
        <div
          v-else-if="props.profileError"
          class="text-[0.6875rem] px-3 py-2 dd-rounded"
          :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }"
        >
          {{ props.profileError }}
        </div>
        <template v-else>
          <div class="flex items-center justify-between py-2" :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Username</span>
            <span class="text-xs font-medium font-mono dd-text">{{ props.profileData.username || '—' }}</span>
          </div>
          <div class="flex items-center justify-between py-2" :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Email</span>
            <span class="text-xs font-medium font-mono dd-text">{{ props.profileData.email || '—' }}</span>
          </div>
          <div class="flex items-center justify-between py-2" :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Role</span>
            <span class="text-xs font-medium font-mono dd-text">{{ props.profileData.role || '—' }}</span>
          </div>
          <div class="flex items-center justify-between py-2" :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Provider</span>
            <span class="text-xs font-medium font-mono dd-text">{{ props.profileData.provider || '—' }}</span>
          </div>
          <div class="flex items-center justify-between py-2" :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Last Login</span>
            <span class="text-xs font-medium font-mono dd-text">{{ props.profileData.lastLogin || '—' }}</span>
          </div>
          <div class="flex items-center justify-between py-2">
            <span class="text-[0.6875rem] font-semibold uppercase tracking-wider dd-text-muted">Active Sessions</span>
            <span class="text-xs font-medium font-mono dd-text">{{ props.profileData.sessions }}</span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
