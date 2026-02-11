<template>
  <div>
    <v-list density="compact" v-if="updateAvailable">
      <v-list-item v-if="result.tag">
        <template v-slot:prepend>
          <v-icon>fas fa-tag</v-icon>
        </template>
        <v-list-item-title>
          Tag
          <v-chip v-if="semver" size="x-small" variant="outlined" color="success" label
            >semver</v-chip
          >
        </v-list-item-title>
        <v-list-item-subtitle>
          {{ result.tag }}
          <v-tooltip location="bottom">
            <template v-slot:activator="{ props }">
              <v-btn
                variant="text"
                size="small"
                icon
                v-bind="props"
                @click="copyToClipboard('update tag', result.tag)"
              >
                <v-icon size="small">far fa-clipboard</v-icon>
              </v-btn>
            </template>
            <span class="text-caption">Copy to clipboard</span>
          </v-tooltip>
        </v-list-item-subtitle>
      </v-list-item>
      <v-list-item v-if="result.link">
        <template v-slot:prepend>
          <v-icon>fas fa-link</v-icon>
        </template>
        <v-list-item-title>Link</v-list-item-title>
        <v-list-item-subtitle
          ><a :href="result.link" target="_blank">{{ result.link }}</a>
        </v-list-item-subtitle>
      </v-list-item>
      <v-list-item v-if="result.digest">
        <template v-slot:prepend>
          <v-icon>fas fa-hashtag</v-icon>
        </template>
        <v-list-item-title> Digest </v-list-item-title>
        <v-list-item-subtitle>
          {{ result.digest }}
          <v-tooltip location="bottom">
            <template v-slot:activator="{ props }">
              <v-btn
                variant="text"
                size="small"
                icon
                v-bind="props"
                @click="copyToClipboard('update digest', result.digest)"
              >
                <v-icon size="small">far fa-clipboard</v-icon>
              </v-btn>
            </template>
            <span class="text-caption">Copy to clipboard</span>
          </v-tooltip>
        </v-list-item-subtitle>
      </v-list-item>
      <v-list-item>
        <template v-slot:prepend>
          <v-icon v-if="updateKind.semverDiff === 'patch'" color="success"
            >fas fa-circle-info</v-icon
          >
          <v-icon v-else-if="updateKind.semverDiff === 'major'" color="error"
            >fas fa-circle-exclamation</v-icon
          >
          <v-icon v-else color="warning">fas fa-triangle-exclamation</v-icon>
        </template>
        <v-list-item-title>Update kind</v-list-item-title>
        <v-list-item-subtitle>
          {{ updateKindFormatted }}
        </v-list-item-subtitle>
      </v-list-item>
    </v-list>
    <v-card-text v-else>No update available</v-card-text>
  </div>
</template>

<script lang="ts" src="./ContainerUpdate.ts"></script>
