<script setup lang="ts">
/**
 * DataViewLayout — Shared page-level layout for all data-driven views.
 *
 * Provides the standard flex structure:
 *   outer flex-col (full height) → inner flex row (gap-4) → scrollable left column + optional DetailPanel
 *
 * Usage:
 *   <DataViewLayout>
 *     <DataFilterBar ... />
 *     <DataTable ... />
 *   </DataViewLayout>
 *
 * With a detail panel:
 *   <DataViewLayout>
 *     <DataFilterBar ... />
 *     <DataTable ... />
 *     <template #panel> <DetailPanel ... /> </template>
 *   </DataViewLayout>
 */
</script>

<template>
  <div class="flex flex-col flex-1 min-h-0">
    <div class="flex gap-4 min-w-0 flex-1 min-h-0">
      <div class="flex-1 min-w-0 overflow-auto">
        <slot />
      </div>
      <slot name="panel" />
    </div>
  </div>
</template>
