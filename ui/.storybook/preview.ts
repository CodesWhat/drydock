import type { Preview } from '@storybook/vue3';
import { setup } from '@storybook/vue3';
import Aura from '@primeuix/themes/aura';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import Tooltip from 'primevue/tooltip';
import { createMemoryHistory, createRouter } from 'vue-router';
import { registerIcons } from '../src/boot/icons';
import AppIcon from '../src/components/AppIcon.vue';
import ContainerIcon from '../src/components/ContainerIcon.vue';
import EmptyState from '../src/components/EmptyState.vue';
import '../src/theme/tokens.css';
import '../src/style.css';

registerIcons();

const router = createRouter({
  history: createMemoryHistory(),
  routes: [
    { path: '/', component: { template: '<div />' } },
    { path: '/containers', component: { template: '<div />' } },
    { path: '/security', component: { template: '<div />' } },
    { path: '/servers', component: { template: '<div />' } },
    { path: '/registries', component: { template: '<div />' } },
    { path: '/watchers', component: { template: '<div />' } },
    { path: '/config', component: { template: '<div />' } },
    { path: '/notifications', component: { template: '<div />' } },
    { path: '/triggers', component: { template: '<div />' } },
    { path: '/auth', component: { template: '<div />' } },
    { path: '/agents', component: { template: '<div />' } },
    { path: '/playground', component: { template: '<div />' } },
    { path: '/profile', component: { template: '<div />' } },
    { path: '/login', component: { template: '<div />' } },
  ],
});

setup((app) => {
  app.use(router);
  app.use(PrimeVue, {
    theme: { preset: Aura, options: { darkModeSelector: '.dark' } },
  });
  app.use(ConfirmationService);
  app.directive('tooltip', Tooltip);
  app.component('AppIcon', AppIcon);
  app.component('ContainerIcon', ContainerIcon);
  app.component('EmptyState', EmptyState);
});

const preview: Preview = {
  parameters: {
    chromatic: { viewports: [375, 1280] },
  },
};

export default preview;
