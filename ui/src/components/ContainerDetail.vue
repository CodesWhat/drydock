<template>
  <v-list density="compact">
    <v-list-item>
      <template v-slot:prepend>
        <v-icon>fas fa-fingerprint</v-icon>
      </template>
      <v-list-item-title>Id</v-list-item-title>
      <v-list-item-subtitle>
        {{ container.id }}
        <v-tooltip location="bottom">
          <template v-slot:activator="{ props }">
            <v-btn
              variant="text"
              size="small"
              icon
              v-bind="props"
              @click="copyToClipboard('container id', container.id)"
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
        <v-icon>fas fa-pen</v-icon>
      </template>
      <v-list-item-title>Name</v-list-item-title>
      <v-list-item-subtitle>{{ container.name }}</v-list-item-subtitle>
    </v-list-item>
    <v-list-item>
      <template v-slot:prepend>
        <v-icon>fas fa-rotate-right</v-icon>
      </template>
      <v-list-item-title>Status</v-list-item-title>
      <v-list-item-subtitle>{{ container.status }}</v-list-item-subtitle>
    </v-list-item>
    <v-list-item>
      <template v-slot:prepend>
        <v-icon>fas fa-eye</v-icon>
      </template>
      <v-list-item-title>Watcher</v-list-item-title>
      <v-list-item-subtitle>
        <router-link to="/configuration/watchers">{{
          container.watcher
        }}</router-link>
      </v-list-item-subtitle>
    </v-list-item>
    <v-list-item v-if="container.includeTags">
      <template v-slot:prepend>
        <v-icon>fas fa-tag</v-icon>
      </template>
      <v-list-item-title>
        Include tags
        <v-tooltip location="bottom">
          <template v-slot:activator="{ props }">
            <v-btn
              size="x-small"
              icon
              v-bind="props"
              href="https://regex101.com"
              target="_blank"
            >
              <v-icon>fas fa-code</v-icon>
            </v-btn>
          </template>
          <span>Test on regex101.com</span>
        </v-tooltip>
      </v-list-item-title>
      <v-list-item-subtitle>{{ container.includeTags }}</v-list-item-subtitle>
    </v-list-item>
    <v-list-item v-if="container.excludeTags">
      <template v-slot:prepend>
        <v-icon>fas fa-tags</v-icon>
      </template>
      <v-list-item-title>
        Exclude tags
        <v-tooltip location="bottom">
          <template v-slot:activator="{ props }">
            <v-btn
              size="x-small"
              icon
              v-bind="props"
              href="https://regex101.com"
              target="_blank"
            >
              <v-icon>fas fa-code</v-icon>
            </v-btn>
          </template>
          <span>Test on regex101.com</span>
        </v-tooltip>
      </v-list-item-title>
      <v-list-item-subtitle>{{ container.excludeTags }}</v-list-item-subtitle>
    </v-list-item>
    <v-list-item v-if="container.transformTags">
      <template v-slot:prepend>
        <v-icon>fas fa-right-left</v-icon>
      </template>
      <v-list-item-title>Transform tags</v-list-item-title>
      <v-list-item-subtitle>{{
        container.transformTags
      }}</v-list-item-subtitle>
    </v-list-item>
    <v-list-item v-if="container.linkTemplate">
      <template v-slot:prepend>
        <v-icon>fas fa-file-pen</v-icon>
      </template>
      <v-list-item-title>Link template</v-list-item-title>
      <v-list-item-subtitle>{{
        container.linkTemplate
      }}</v-list-item-subtitle>
    </v-list-item>
    <v-list-item v-if="container.link">
      <template v-slot:prepend>
        <v-icon>fas fa-link</v-icon>
      </template>
      <v-list-item-title>Link</v-list-item-title>
      <v-list-item-subtitle
        ><a :href="container.link" target="_blank">{{ container.link }}</a>
      </v-list-item-subtitle>
    </v-list-item>
  </v-list>
</template>
<script lang="ts" src="./ContainerDetail.ts"></script>
