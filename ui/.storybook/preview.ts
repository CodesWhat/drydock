import type { Preview } from '@storybook/vue3';
import { setup } from '@storybook/vue3';
import Aura from '@primeuix/themes/aura';
import PrimeVue from 'primevue/config';
import Tooltip from 'primevue/tooltip';
import { registerIcons } from '../src/boot/icons';
import AppIcon from '../src/components/AppIcon.vue';
import ContainerIcon from '../src/components/ContainerIcon.vue';
import EmptyState from '../src/components/EmptyState.vue';
import '../src/theme/tokens.css';
import '../src/style.css';

registerIcons();

setup((app) => {
  app.use(PrimeVue, {
    theme: { preset: Aura, options: { darkModeSelector: '.dark' } },
  });
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
