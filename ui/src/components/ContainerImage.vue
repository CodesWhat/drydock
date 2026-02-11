<template>
  <v-list density="compact">
    <v-list-item>
      <template v-slot:prepend>
        <v-icon>fas fa-fingerprint</v-icon>
      </template>
      <v-list-item-title>
        Id
        <v-tooltip location="bottom">
          <template v-slot:activator="{ props }">
            <v-btn
              variant="text"
              size="small"
              icon
              v-bind="props"
              @click="copyToClipboard('image id', image.id)"
            >
              <v-icon size="small">far fa-clipboard</v-icon>
            </v-btn>
          </template>
          <span class="text-caption">Copy to clipboard</span>
        </v-tooltip>
      </v-list-item-title>
      <v-list-item-subtitle>{{ image.id }}</v-list-item-subtitle>
    </v-list-item>
    <v-list-item>
      <template v-slot:prepend>
        <v-icon>fas fa-pen</v-icon>
      </template>
      <v-list-item-title>Name</v-list-item-title>
      <v-list-item-subtitle>{{ image.name }}</v-list-item-subtitle>
    </v-list-item>
    <v-list-item>
      <template v-slot:prepend>
        <v-icon>{{ registryIcon }}</v-icon>
      </template>
      <v-list-item-title>Registry</v-list-item-title>
      <v-list-item-subtitle>{{ image.registry.name }}</v-list-item-subtitle>
      <v-list-item-subtitle v-if="image.registry.lookupImage"
        >{{ image.registry.lookupImage }} (lookup)</v-list-item-subtitle
      >
    </v-list-item>
    <v-list-item>
      <template v-slot:prepend>
        <v-icon>fas fa-tag</v-icon>
      </template>
      <v-list-item-title>
        Tag &nbsp;<v-chip v-if="image.tag.semver" size="x-small" variant="outlined" color="success" label
          >semver</v-chip
        >
      </v-list-item-title>
      <v-list-item-subtitle>
        {{ image.tag.value }}
      </v-list-item-subtitle>
    </v-list-item>
    <v-list-item v-if="image.digest.value">
      <template v-slot:prepend>
        <v-icon>fas fa-hashtag</v-icon>
      </template>
      <v-list-item-title>
        Digest
        <v-tooltip location="bottom">
          <template v-slot:activator="{ props }">
            <v-btn
              variant="text"
              size="small"
              icon
              v-bind="props"
              @click="copyToClipboard('image digest', image.digest.value)"
            >
              <v-icon size="small">far fa-clipboard</v-icon>
            </v-btn>
          </template>
          <span class="text-caption">Copy to clipboard</span>
        </v-tooltip>
      </v-list-item-title>
      <v-list-item-subtitle>
        {{ image.digest.value }}
      </v-list-item-subtitle>
    </v-list-item>
    <v-list-item>
      <template v-slot:prepend>
        <v-icon>{{ osIcon }}</v-icon>
      </template>
      <v-list-item-title>OS / Architecture</v-list-item-title>
      <v-list-item-subtitle
        >{{ image.os }} / {{ image.architecture }}</v-list-item-subtitle
      >
    </v-list-item>
    <v-list-item v-if="image.created">
      <template v-slot:prepend>
        <v-icon>far fa-calendar</v-icon>
      </template>
      <v-list-item-title>Created</v-list-item-title>
      <v-list-item-subtitle>{{
        $filters.date(image.created)
      }}</v-list-item-subtitle>
    </v-list-item>
  </v-list>
</template>

<script lang="ts" src="./ContainerImage.ts"></script>
