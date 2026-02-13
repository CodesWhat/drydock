<template>
  <v-form autocomplete="on" @keyup.enter="login">
    <v-card-text class="pa-6">
      <v-text-field
        label="Username"
        v-model="username"
        name="username"
        prepend-inner-icon="fas fa-user"
        :rules="[rules.required]"
        autocomplete="username"
        variant="outlined"
        density="comfortable"
        autofocus
      />
      <v-text-field
        label="Password"
        type="password"
        v-model="password"
        name="password"
        prepend-inner-icon="fas fa-lock"
        :rules="[rules.required]"
        autocomplete="current-password"
        variant="outlined"
        density="comfortable"
        class="mt-1"
      />
      <v-btn
        block
        :color="dark ? 'secondary' : 'primary'"
        size="large"
        rounded="lg"
        :disabled="!valid"
        @click="login"
        class="mt-2"
      >
        <v-icon start>fas fa-right-to-bracket</v-icon>
        Sign in
      </v-btn>
    </v-card-text>
  </v-form>
</template>

<script lang="ts" src="./LoginBasic.ts"></script>
