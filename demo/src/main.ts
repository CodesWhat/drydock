import { createApp } from 'vue';
import PrimeVue from 'primevue/config';
import Aura from '@primeuix/themes/aura';
import App from './App.vue';
import IconCompare from './IconCompare.vue';
import StyleGuide from './StyleGuide.vue';
import './theme/tokens.css';
import './style.css';

const page = new URLSearchParams(window.location.search).get('page');
const root = page === 'icons' ? IconCompare : page === 'styleguide' ? StyleGuide : App;
const app = createApp(root);

app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: '.dark',
    },
  },
});

app.mount('#app');
