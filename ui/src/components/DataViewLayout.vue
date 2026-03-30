<script setup lang="ts">
/**
 * DataViewLayout — Shared page-level layout for all data-driven views.
 *
 * Provides the standard flex structure:
 *   outer flex-col (full height) → inner flex row (gap-4) → left column + optional DetailPanel
 *
 * Scrolling is handled by the parent <main> element in AppLayout.
 * This component only manages the flex layout between content and panel.
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
    <div class="flex gap-2 min-w-0 flex-1 min-h-0">
      <div class="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden pr-2 sm:pr-[15px] dd-touch-scroll">
        <slot />
      </div>
      <slot name="panel" />
    </div>
  </div>
</template>
