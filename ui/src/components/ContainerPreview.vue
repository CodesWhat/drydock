<template>
  <v-dialog v-model="isOpen" max-width="600" persistent>
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" color="info">fas fa-eye</v-icon>
        Update Preview
        <v-spacer />
        <v-btn icon variant="text" size="small" @click="close">
          <v-icon>fas fa-xmark</v-icon>
        </v-btn>
      </v-card-title>

      <!-- Loading state -->
      <v-card-text v-if="loading" class="text-center py-8">
        <v-progress-circular indeterminate color="primary" size="48" />
        <div class="mt-4 text-medium-emphasis">Loading preview...</div>
      </v-card-text>

      <!-- Error state -->
      <v-card-text v-else-if="error" class="text-center py-8">
        <v-icon size="48" color="error">fas fa-triangle-exclamation</v-icon>
        <div class="mt-4 text-error">{{ error }}</div>
        <v-btn variant="outlined" class="mt-4" @click="fetchPreview">
          Retry
        </v-btn>
      </v-card-text>

      <!-- Preview content -->
      <v-card-text v-else-if="preview">
        <div class="mb-4">
          <div class="text-subtitle-2 text-medium-emphasis mb-1">Current Image</div>
          <v-chip label variant="outlined" color="info">
            {{ preview.currentImage || 'Unknown' }}
          </v-chip>
        </div>

        <div class="mb-4">
          <div class="text-subtitle-2 text-medium-emphasis mb-1">New Image</div>
          <v-chip label variant="outlined" color="success">
            {{ preview.newImage || 'Unknown' }}
          </v-chip>
        </div>

        <div v-if="preview.updateKind" class="mb-4">
          <div class="text-subtitle-2 text-medium-emphasis mb-1">Update Kind</div>
          <v-chip label :color="updateKindColor" size="small">
            {{ preview.updateKind.kind }}
          </v-chip>
          <div
            v-if="preview.updateKind.localValue && preview.updateKind.remoteValue"
            class="mt-1 text-body-2 text-medium-emphasis"
          >
            {{ preview.updateKind.localValue }} &rarr; {{ preview.updateKind.remoteValue }}
          </div>
        </div>

        <div v-if="preview.networks && preview.networks.length > 0" class="mb-4">
          <div class="text-subtitle-2 text-medium-emphasis mb-1">Networks</div>
          <v-chip
            v-for="network in preview.networks"
            :key="network"
            label
            variant="outlined"
            size="small"
            class="mr-1 mb-1"
          >
            {{ network }}
          </v-chip>
        </div>

        <div v-if="preview.changes && preview.changes.length > 0" class="mb-4">
          <div class="text-subtitle-2 text-medium-emphasis mb-1">Changes</div>
          <div v-for="(change, index) in preview.changes" :key="index" class="text-body-2">
            {{ change }}
          </div>
        </div>
      </v-card-text>

      <v-card-actions v-if="!loading">
        <v-spacer />
        <v-btn variant="outlined" @click="close">Cancel</v-btn>
        <v-btn
          v-if="preview && !error"
          color="primary"
          variant="elevated"
          @click="confirmUpdate"
        >
          <v-icon start>fas fa-rocket</v-icon>
          Proceed with Update
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script lang="ts" src="./ContainerPreview.ts"></script>
