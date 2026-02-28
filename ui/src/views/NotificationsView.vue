<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useBreakpoints } from '../composables/useBreakpoints';
import type { NotificationRule, NotificationRuleUpdate } from '../services/notification';
import { getAllNotificationRules, updateNotificationRule } from '../services/notification';
import { getAllTriggers } from '../services/trigger';
import type { ApiComponent } from '../types/api';
import { errorMessage } from '../utils/error';

interface TriggerSummary {
  id: string;
  name: string;
  type: string;
}

const NON_NOTIFICATION_TRIGGER_TYPES = new Set(['docker', 'dockercompose']);

function isNotificationTriggerType(type: string) {
  return !NON_NOTIFICATION_TRIGGER_TYPES.has(type.toLowerCase());
}

const notificationsViewMode = ref<'table' | 'cards' | 'list'>('table');
const loading = ref(true);
const error = ref('');
const saveError = ref('');
const savingRuleId = ref<string | null>(null);
const route = useRoute();

const { isMobile } = useBreakpoints();

const notificationsData = ref<NotificationRule[]>([]);
const triggersData = ref<TriggerSummary[]>([]);

const selectedRuleId = ref<string | null>(null);
const detailOpen = ref(false);
const detailEnabled = ref(true);
const detailTriggers = ref<string[]>([]);

function triggerTypeBadge(type: string) {
  if (type === 'slack')
    return { bg: 'var(--dd-info-muted)', text: 'var(--dd-info)', label: 'Slack' };
  if (type === 'discord')
    return { bg: 'var(--dd-alt-muted)', text: 'var(--dd-alt)', label: 'Discord' };
  if (type === 'smtp')
    return { bg: 'var(--dd-success-muted)', text: 'var(--dd-success)', label: 'SMTP' };
  if (type === 'http')
    return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)', label: 'HTTP' };
  if (type === 'telegram')
    return { bg: 'var(--dd-primary-muted)', text: 'var(--dd-primary)', label: 'Telegram' };
  if (type === 'mqtt')
    return { bg: 'var(--dd-caution-muted)', text: 'var(--dd-caution)', label: 'MQTT' };
  if (type === 'docker' || type === 'dockercompose')
    return {
      bg: 'var(--dd-info-muted)',
      text: 'var(--dd-info)',
      label: type === 'dockercompose' ? 'Compose' : 'Docker',
    };
  return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)', label: type };
}

const selectedRule = computed(
  () => notificationsData.value.find((rule) => rule.id === selectedRuleId.value) ?? null,
);

const triggersById = computed(() => {
  const map: Record<string, TriggerSummary> = {};
  triggersData.value.forEach((trigger) => {
    map[trigger.id] = trigger;
  });
  return map;
});

const triggersSorted = computed(() =>
  [...triggersData.value].sort((triggerA, triggerB) => triggerA.name.localeCompare(triggerB.name)),
);

function triggerNameById(id: string) {
  return triggersById.value[id]?.name ?? id;
}

function normalizeTriggerIds(triggerIds: string[]) {
  return Array.from(new Set(triggerIds)).sort();
}

function hasTriggerChanges() {
  if (!selectedRule.value) {
    return false;
  }
  const currentTriggers = normalizeTriggerIds(selectedRule.value.triggers);
  const draftTriggers = normalizeTriggerIds(detailTriggers.value);
  if (currentTriggers.length !== draftTriggers.length) {
    return true;
  }
  return currentTriggers.some((triggerId, index) => triggerId !== draftTriggers[index]);
}

const detailHasChanges = computed(() => {
  if (!selectedRule.value) {
    return false;
  }
  return detailEnabled.value !== selectedRule.value.enabled || hasTriggerChanges();
});

const detailSaving = computed(
  () => !!selectedRuleId.value && savingRuleId.value === selectedRuleId.value,
);

const searchQuery = ref('');
const showFilters = ref(false);
const activeFilterCount = computed(() => (searchQuery.value ? 1 : 0));

function applySearchFromQuery(queryValue: unknown) {
  const raw = Array.isArray(queryValue) ? queryValue[0] : queryValue;
  searchQuery.value = typeof raw === 'string' ? raw : '';
}

applySearchFromQuery(route.query.q);
watch(
  () => route.query.q,
  (value) => applySearchFromQuery(value),
);

const filteredNotifications = computed(() => {
  if (!searchQuery.value) return notificationsData.value;
  const q = searchQuery.value.toLowerCase();
  return notificationsData.value.filter(
    (item) =>
      item.name.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.triggers.some((triggerId) => triggerNameById(triggerId).toLowerCase().includes(q)),
  );
});

const tableColumns = [
  { key: 'enabled', label: 'On', align: 'text-center', sortable: false, width: '48px' },
  { key: 'name', label: 'Rule', sortable: false, width: '99%' },
  { key: 'triggers', label: 'Triggers', align: 'text-right', sortable: false },
];

function clearFilters() {
  searchQuery.value = '';
}

function syncDetailDraftFromRule() {
  if (!selectedRule.value) {
    detailEnabled.value = true;
    detailTriggers.value = [];
    return;
  }
  detailEnabled.value = selectedRule.value.enabled;
  detailTriggers.value = [...selectedRule.value.triggers];
}

function openDetail(rule: NotificationRule) {
  selectedRuleId.value = rule.id;
  detailOpen.value = true;
  syncDetailDraftFromRule();
}

function setDetailOpen(nextOpen: boolean) {
  detailOpen.value = nextOpen;
  if (!nextOpen) {
    selectedRuleId.value = null;
    syncDetailDraftFromRule();
  }
}

function updateRuleInList(updatedRule: NotificationRule) {
  const ruleIndex = notificationsData.value.findIndex((rule) => rule.id === updatedRule.id);
  if (ruleIndex < 0) {
    return;
  }
  notificationsData.value[ruleIndex] = {
    ...notificationsData.value[ruleIndex],
    ...updatedRule,
    triggers: [...updatedRule.triggers],
  };
}

async function persistRule(ruleId: string, update: NotificationRuleUpdate) {
  saveError.value = '';
  savingRuleId.value = ruleId;

  try {
    const updatedRule = await updateNotificationRule(ruleId, update);
    updateRuleInList(updatedRule);
    if (selectedRuleId.value === ruleId) {
      syncDetailDraftFromRule();
    }
    return updatedRule;
  } catch (e: unknown) {
    saveError.value = errorMessage(e, 'Failed to update notification rule');
    throw e;
  } finally {
    savingRuleId.value = null;
  }
}

async function toggleNotification(ruleId: string) {
  if (savingRuleId.value) {
    return;
  }
  const rule = notificationsData.value.find((item) => item.id === ruleId);
  if (!rule) {
    return;
  }

  const enabledCurrent = rule.enabled;
  rule.enabled = !enabledCurrent;

  try {
    await persistRule(ruleId, { enabled: rule.enabled });
  } catch {
    rule.enabled = enabledCurrent;
    if (selectedRuleId.value === ruleId) {
      detailEnabled.value = enabledCurrent;
    }
  }
}

function isTriggerSelected(triggerId: string) {
  return detailTriggers.value.includes(triggerId);
}

function toggleDetailTrigger(triggerId: string) {
  if (isTriggerSelected(triggerId)) {
    detailTriggers.value = detailTriggers.value.filter((id) => id !== triggerId);
    return;
  }
  detailTriggers.value = [...detailTriggers.value, triggerId].sort();
}

async function saveSelectedRule() {
  if (!selectedRule.value || !detailHasChanges.value || detailSaving.value) {
    return;
  }

  const update: NotificationRuleUpdate = {};
  if (detailEnabled.value !== selectedRule.value.enabled) {
    update.enabled = detailEnabled.value;
  }
  if (hasTriggerChanges()) {
    update.triggers = normalizeTriggerIds(detailTriggers.value);
  }

  await persistRule(selectedRule.value.id, update);
}

onMounted(async () => {
  try {
    const [notificationRules, triggers] = await Promise.all([
      getAllNotificationRules(),
      getAllTriggers(),
    ]);

    const notificationTriggers: TriggerSummary[] = triggers
      .filter((trigger: ApiComponent) => isNotificationTriggerType(trigger.type))
      .map((trigger: ApiComponent) => ({
        id: trigger.id,
        name: trigger.name,
        type: trigger.type,
      }));
    const allowedTriggerIds = new Set(notificationTriggers.map((trigger) => trigger.id));

    notificationsData.value = notificationRules.map((rule: NotificationRule) => ({
      ...rule,
      triggers: normalizeTriggerIds(
        rule.triggers.filter((triggerId) => allowedTriggerIds.has(triggerId)),
      ),
    }));
    triggersData.value = notificationTriggers;
  } catch (e: unknown) {
    error.value = errorMessage(e, 'Failed to load notification rules');
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <DataViewLayout>
    <div v-if="error"
         class="mb-3 px-3 py-2 text-[11px] dd-rounded"
         :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
      {{ error }}
    </div>

    <div v-if="saveError"
         class="mb-3 px-3 py-2 text-[11px] dd-rounded"
         :style="{ backgroundColor: 'var(--dd-danger-muted)', color: 'var(--dd-danger)' }">
      {{ saveError }}
    </div>

    <DataFilterBar
      v-model="notificationsViewMode"
      v-model:showFilters="showFilters"
      :filtered-count="filteredNotifications.length"
      :total-count="notificationsData.length"
      :active-filter-count="activeFilterCount">
      <template #filters>
        <input v-model="searchQuery"
               type="text"
               placeholder="Filter by name, description, or trigger..."
               class="flex-1 min-w-[120px] max-w-[320px] px-2.5 py-1.5 dd-rounded text-[11px] font-medium border outline-none dd-bg dd-text dd-border-strong dd-placeholder" />
        <button v-if="searchQuery"
                class="text-[10px] dd-text-muted hover:dd-text transition-colors"
                @click="clearFilters">
          Clear
        </button>
      </template>
    </DataFilterBar>

    <div v-if="loading" class="text-[11px] dd-text-muted py-3 px-1">Loading notification rules...</div>

    <DataTable
      v-if="notificationsViewMode === 'table' && !loading"
      :columns="tableColumns"
      :rows="filteredNotifications"
      row-key="id"
      :active-row="selectedRule?.id"
      @row-click="openDetail($event)">
      <template #cell-enabled="{ row }">
        <button class="w-8 h-4 rounded-full relative shrink-0 transition-colors mx-auto disabled:opacity-40"
                :style="{ backgroundColor: row.enabled ? 'var(--dd-success)' : 'var(--dd-border-strong)' }"
                :disabled="savingRuleId === row.id"
                @click.stop="toggleNotification(row.id)">
          <div class="absolute top-0.5 w-3 h-3 rounded-full shadow-sm transition-transform"
               :style="{ backgroundColor: 'var(--dd-text)', left: row.enabled ? '17px' : '2px' }" />
        </button>
      </template>
      <template #cell-name="{ row }">
        <div class="font-medium dd-text">{{ row.name }}</div>
        <div class="text-[10px] mt-0.5 dd-text-muted">{{ row.description }}</div>
      </template>
      <template #cell-triggers="{ row }">
        <div class="flex flex-wrap gap-1 justify-end">
          <span v-for="triggerId in row.triggers" :key="triggerId"
                class="badge text-[9px] font-semibold"
                :style="{ backgroundColor: 'var(--dd-neutral-muted)', color: 'var(--dd-text-secondary)' }">
            {{ triggerNameById(triggerId) }}
          </span>
          <span v-if="row.triggers.length === 0" class="text-[10px] italic dd-text-muted">None</span>
        </div>
      </template>
      <template #empty>
        <EmptyState icon="notifications"
                    message="No notification rules match your filters"
                    :show-clear="activeFilterCount > 0"
                    @clear="clearFilters" />
      </template>
    </DataTable>

    <DataCardGrid
      v-if="notificationsViewMode === 'cards' && !loading && filteredNotifications.length > 0"
      :items="filteredNotifications"
      item-key="id"
      :selected-key="selectedRule?.id"
      @item-click="openDetail($event)">
      <template #card="{ item: notif }">
        <div class="px-4 pt-4 pb-2 flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="text-[15px] font-semibold truncate dd-text">{{ notif.name }}</div>
            <div class="text-[11px] mt-0.5 dd-text-muted">{{ notif.description }}</div>
          </div>
          <button class="w-8 h-4 rounded-full relative shrink-0 transition-colors disabled:opacity-40"
                  :style="{ backgroundColor: notif.enabled ? 'var(--dd-success)' : 'var(--dd-border-strong)' }"
                  :disabled="savingRuleId === notif.id"
                  @click.stop="toggleNotification(notif.id)">
            <div class="absolute top-0.5 w-3 h-3 rounded-full shadow-sm transition-transform"
                 :style="{ backgroundColor: 'var(--dd-text)', left: notif.enabled ? '17px' : '2px' }" />
          </button>
        </div>
        <div class="px-4 py-2.5 flex flex-wrap gap-1.5 mt-auto"
             :style="{ borderTop: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-elevated)' }">
          <span v-for="triggerId in notif.triggers" :key="triggerId"
                class="badge text-[9px] font-semibold"
                :style="{ backgroundColor: 'var(--dd-neutral-muted)', color: 'var(--dd-text-secondary)' }">
            {{ triggerNameById(triggerId) }}
          </span>
          <span v-if="notif.triggers.length === 0" class="text-[10px] italic dd-text-muted">
            No triggers
          </span>
        </div>
      </template>
    </DataCardGrid>

    <DataListAccordion
      v-if="notificationsViewMode === 'list' && !loading && filteredNotifications.length > 0"
      :items="filteredNotifications"
      item-key="id"
      :selected-key="selectedRule?.id"
      @item-click="openDetail($event)">
      <template #header="{ item: notif }">
        <button class="w-8 h-4 rounded-full relative shrink-0 transition-colors disabled:opacity-40"
                :style="{ backgroundColor: notif.enabled ? 'var(--dd-success)' : 'var(--dd-border-strong)' }"
                :disabled="savingRuleId === notif.id"
                @click.stop="toggleNotification(notif.id)">
          <div class="absolute top-0.5 w-3 h-3 rounded-full shadow-sm transition-transform"
               :style="{ backgroundColor: 'var(--dd-text)', left: notif.enabled ? '17px' : '2px' }" />
        </button>
        <span class="text-sm font-semibold flex-1 min-w-0 truncate dd-text">{{ notif.name }}</span>
        <div class="flex flex-wrap gap-1.5 shrink-0 max-w-[320px] justify-end">
          <span v-for="triggerId in notif.triggers" :key="triggerId"
                class="badge text-[9px] font-semibold"
                :style="{ backgroundColor: 'var(--dd-neutral-muted)', color: 'var(--dd-text-secondary)' }">
            {{ triggerNameById(triggerId) }}
          </span>
          <span v-if="notif.triggers.length === 0" class="text-[10px] italic dd-text-muted">No triggers</span>
        </div>
      </template>
      <template #details="{ item: notif }">
        <div class="text-[11px] dd-text-muted">{{ notif.description }}</div>
      </template>
    </DataListAccordion>

    <EmptyState
      v-if="(notificationsViewMode === 'cards' || notificationsViewMode === 'list') && !loading && filteredNotifications.length === 0"
      icon="notifications"
      message="No notification rules match your filters"
      :show-clear="activeFilterCount > 0"
      @clear="clearFilters" />

    <template #panel>
      <DetailPanel
        :open="detailOpen"
        :is-mobile="isMobile"
        :show-size-controls="false"
        :show-full-page="false"
        @update:open="setDetailOpen($event)">
        <template #header>
          <div class="flex items-center gap-2.5 min-w-0">
            <AppIcon name="notifications" :size="14" class="dd-text-secondary" />
            <span class="text-sm font-bold truncate dd-text">{{ selectedRule?.name }}</span>
          </div>
        </template>

        <template #subtitle>
          <span v-if="selectedRule"
                class="badge text-[9px] font-bold"
                :style="{
                  backgroundColor: selectedRule.enabled ? 'var(--dd-success-muted)' : 'var(--dd-neutral-muted)',
                  color: selectedRule.enabled ? 'var(--dd-success)' : 'var(--dd-neutral)',
                }">
            {{ selectedRule.enabled ? 'enabled' : 'disabled' }}
          </span>
          <span v-if="selectedRule" class="text-[10px] font-mono dd-text-muted">{{ selectedRule.id }}</span>
        </template>

        <template v-if="selectedRule" #default>
          <div class="p-4 space-y-5">
            <div class="text-[11px] dd-text-muted">{{ selectedRule.description }}</div>

            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">Rule status</div>
              <button class="w-10 h-5 rounded-full relative transition-colors"
                      :style="{ backgroundColor: detailEnabled ? 'var(--dd-success)' : 'var(--dd-border-strong)' }"
                      :disabled="detailSaving"
                      @click="detailEnabled = !detailEnabled">
                <div class="absolute top-0.5 w-4 h-4 rounded-full shadow-sm transition-transform"
                     :style="{ backgroundColor: 'var(--dd-text)', left: detailEnabled ? '20px' : '2px' }" />
              </button>
              <div class="text-[10px] mt-1 dd-text-muted">
                {{ detailEnabled ? 'Enabled: notifications can fire for this event.' : 'Disabled: notifications are suppressed for this event.' }}
              </div>
            </div>

            <div>
              <div class="text-[10px] font-semibold uppercase tracking-wider mb-2 dd-text-muted">
                Assigned Triggers
              </div>
              <div v-if="triggersSorted.length === 0" class="text-[11px] dd-text-muted">
                No triggers configured. Add triggers on the <RouterLink to="/triggers"
                class="underline hover:no-underline">Triggers page</RouterLink>.
              </div>
              <div v-else class="space-y-2">
                <label v-for="trigger in triggersSorted" :key="trigger.id"
                       class="flex items-center gap-2.5 px-2.5 py-2 dd-rounded cursor-pointer"
                       :style="{ border: '1px solid var(--dd-border-strong)', backgroundColor: 'var(--dd-bg-elevated)' }">
                  <input type="checkbox"
                         :checked="isTriggerSelected(trigger.id)"
                         :disabled="detailSaving"
                         @change="toggleDetailTrigger(trigger.id)" />
                  <div class="flex-1 min-w-0">
                    <div class="text-[12px] font-semibold truncate dd-text">{{ trigger.name }}</div>
                    <div class="text-[10px] font-mono dd-text-muted">{{ trigger.id }}</div>
                  </div>
                  <span class="badge text-[9px] uppercase font-bold shrink-0"
                        :style="{ backgroundColor: triggerTypeBadge(trigger.type).bg, color: triggerTypeBadge(trigger.type).text }">
                    {{ triggerTypeBadge(trigger.type).label }}
                  </span>
                </label>
              </div>
            </div>

            <div class="pt-2 flex items-center gap-2">
              <button class="inline-flex items-center gap-1.5 px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none"
                      :style="{ backgroundColor: 'var(--dd-primary)', color: 'white' }"
                      :disabled="detailSaving || !detailHasChanges"
                      @click="saveSelectedRule">
                <AppIcon :name="detailSaving ? 'pending' : 'check'" :size="12" />
                {{ detailSaving ? 'Saving...' : 'Save changes' }}
              </button>
              <button class="px-3 py-1.5 dd-rounded text-[11px] font-semibold transition-colors dd-text-muted hover:dd-text hover:dd-bg-elevated disabled:opacity-50 disabled:pointer-events-none"
                      :disabled="detailSaving || !detailHasChanges"
                      @click="syncDetailDraftFromRule">
                Reset
              </button>
            </div>
          </div>
        </template>
      </DetailPanel>
    </template>
  </DataViewLayout>
</template>
