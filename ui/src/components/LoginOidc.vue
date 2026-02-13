<template>
  <v-form @keyup.enter="redirect">
    <v-card-text class="pa-6">
      <v-btn
        block
        :color="dark ? 'secondary' : 'primary'"
        size="large"
        rounded="lg"
        @click="redirect"
      >
        <v-icon start>fas fa-right-to-bracket</v-icon>
        Sign in with {{ name }}
      </v-btn>
    </v-card-text>
  </v-form>
</template>

<script lang="ts" src="./LoginOidc.ts"></script>
