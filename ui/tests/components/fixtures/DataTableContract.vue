<script setup lang="ts">
import { ref } from 'vue';
import DataTable, { type DataTableColumn } from '@/components/DataTable.vue';

interface ScoreRow {
  id: string;
  name: string;
  score: number;
}

interface GroupRow {
  group: string;
}

type MixedRow = ScoreRow | GroupRow;

const rows: ScoreRow[] = [{ id: 'alpha', name: 'Alpha', score: 2.5 }];
const mixedRows: MixedRow[] = [{ group: 'Scores' }, { id: 'beta', name: 'Beta', score: 3 }];
const columns: DataTableColumn[] = [{ key: 'score', label: 'Score', overflow: 'truncate' }];
const selected = ref('');

function isGroup(row: MixedRow): row is GroupRow {
  return 'group' in row;
}

function rowKey(row: MixedRow): string {
  return isGroup(row) ? row.group : row.id;
}

function select(row: ScoreRow) {
  selected.value = `${row.name}: ${row.score.toFixed(1)}`;
}
</script>

<template>
  <output>{{ selected }}</output>
  <DataTable :columns="columns" :rows="rows" row-key="id" @row-click="select">
    <template #header-score="{ column }">{{ column.label.toUpperCase() }}</template>
    <template #cell-score="{ row, value, cardMode }">
      <span :data-card="cardMode">{{ row.name }}: {{ typeof value === 'number' ? value.toFixed(1) : '' }}</span>
    </template>
  </DataTable>
  <!-- @vue-generic {MixedRow} -->
  <DataTable :columns="columns" :rows="mixedRows" :row-key="rowKey" :full-width-row="isGroup" show-actions>
    <template #full-row="{ row, index, cardMode }">
      <span v-if="isGroup(row)" :data-card="cardMode">{{ index }}: {{ row.group }}</span>
    </template>
    <template #cell-score="{ row }">
      <span v-if="!isGroup(row)">{{ row.score.toFixed(1) }}</span>
    </template>
    <template #actions="{ row }">
      <button v-if="!isGroup(row)" @click="select(row)">Select {{ row.name }}</button>
    </template>
  </DataTable>
</template>
