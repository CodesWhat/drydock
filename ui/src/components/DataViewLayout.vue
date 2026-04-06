<script setup lang="ts">
/**
 * DataViewLayout — Shared page-level layout for all data-driven views.
 *
 * Provides the standard flex structure:
 *   outer flex-col (full height) → inner flex row (gap-4) → left column + optional DetailPanel
 *
 * Scrolling is handled by the main content column in this component.
 * The outer wrapper escapes AppLayout padding so the scroll surface reaches
 * the viewport edge without dead zones on touch devices.
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
  <div class="flex flex-col flex-1 min-h-0 -ml-4 -mr-2 -my-4 sm:-ml-6 sm:-mr-[9px] sm:-my-6">
    <div class="flex gap-2 min-w-0 flex-1 min-h-0">
      <div class="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden overscroll-contain pl-4 pr-4 py-4 sm:pl-6 sm:pr-[24px] sm:py-6 dd-touch-scroll dd-scroll-stable">
        <slot />
      </div>
      <slot name="panel" />
    </div>
  </div>
</template>
