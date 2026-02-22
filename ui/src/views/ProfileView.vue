<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { getUser } from '../services/auth';

const profileData = ref({
  username: '',
  email: '',
  role: '',
  lastLogin: '',
  sessions: 0,
});
const loading = ref(true);
const error = ref('');

onMounted(async () => {
  try {
    const user = await getUser();
    if (user) {
      profileData.value = {
        username: user.username ?? 'unknown',
        email: user.email ?? '',
        role: user.role ?? '',
        lastLogin: user.lastLogin ?? '',
        sessions: user.sessions ?? 0,
      };
    }
  } catch {
    error.value = 'Failed to load profile';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6">
      <div class="dd-rounded overflow-hidden"
           :style="{
             backgroundColor: 'var(--dd-bg-card)',
             border: '1px solid var(--dd-border-strong)',
           }">
        <!-- Profile header -->
        <div class="px-6 py-6 flex items-center gap-5"
             :style="{ borderBottom: '1px solid var(--dd-border-strong)' }">
          <!-- Large avatar -->
          <div class="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold text-white shrink-0"
               style="background: linear-gradient(135deg, var(--dd-primary), var(--dd-success));">
            SB
          </div>
          <div>
            <h1 class="text-lg font-bold dd-text">
              {{ profileData.username }}
            </h1>
            <p class="text-[12px] mt-0.5 dd-text-secondary">
              {{ profileData.email }}
            </p>
            <span class="badge text-[10px] font-semibold mt-1.5 inline-flex"
                  :style="{ backgroundColor: 'var(--dd-primary-muted)', color: 'var(--dd-primary)' }">
              {{ profileData.role }}
            </span>
          </div>
        </div>

        <!-- Profile details -->
        <div class="p-6 space-y-4">
          <div class="flex items-center justify-between py-2"
               :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Username</span>
            <span class="text-[12px] font-medium font-mono dd-text">{{ profileData.username }}</span>
          </div>
          <div class="flex items-center justify-between py-2"
               :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Email</span>
            <span class="text-[12px] font-medium font-mono dd-text">{{ profileData.email }}</span>
          </div>
          <div class="flex items-center justify-between py-2"
               :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Role</span>
            <span class="text-[12px] font-medium font-mono dd-text">{{ profileData.role }}</span>
          </div>
          <div class="flex items-center justify-between py-2"
               :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Last Login</span>
            <span class="text-[12px] font-medium font-mono dd-text">{{ profileData.lastLogin }}</span>
          </div>
          <div class="flex items-center justify-between py-2"
               :style="{ borderBottom: '1px solid var(--dd-border)' }">
            <span class="text-[11px] font-semibold uppercase tracking-wider dd-text-muted">Active Sessions</span>
            <span class="text-[12px] font-medium font-mono dd-text">{{ profileData.sessions }}</span>
          </div>
        </div>

        <!-- Sign Out -->
        <div class="px-6 pb-6">
          <button class="inline-flex items-center gap-2 px-4 py-2 dd-rounded text-[12px] font-bold transition-colors"
                  :style="{
                    backgroundColor: 'var(--dd-danger-muted)',
                    color: 'var(--dd-danger)',
                    border: '1px solid var(--dd-danger)',
                  }">
            <AppIcon name="sign-out" :size="12" />
            Sign Out
          </button>
        </div>
      </div>
  </div>
</template>
