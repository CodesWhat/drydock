import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import App from './App.vue';
import router from './router';
import { addCollection } from 'iconify-icon';
import phIcons from '@iconify-json/ph/icons.json';
import './theme/tokens.css';
import './style.css';

// Pre-load Phosphor icons so they render offline (default icon set)
addCollection(phIcons);

const app = createApp(App);
app.use(PrimeVue, {
  theme: { preset: Aura, options: { darkModeSelector: '.dark' } },
});
app.use(router);
app.mount('#app');
