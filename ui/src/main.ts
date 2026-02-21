import Aura from '@primeuix/themes/aura';
import PrimeVue from 'primevue/config';
import ConfirmationService from 'primevue/confirmationservice';
import Tooltip from 'primevue/tooltip';
import { createApp } from 'vue';
import App from './App.vue';
import { registerIcons } from './boot/icons';
import AppIcon from './components/AppIcon.vue';
import ContainerIcon from './components/ContainerIcon.vue';
import ThemeToggle from './components/ThemeToggle.vue';
import DataCardGrid from './components/DataCardGrid.vue';
import DataFilterBar from './components/DataFilterBar.vue';
import DataListAccordion from './components/DataListAccordion.vue';
import DataTable from './components/DataTable.vue';
import DetailPanel from './components/DetailPanel.vue';
import EmptyState from './components/EmptyState.vue';
import AppLayout from './layouts/AppLayout.vue';
import router from './router';
import './theme/tokens.css';
import './style.css';

// Pre-register only the icons we use so they render offline (no CDN fetch)
registerIcons();

const app = createApp(App);
app.component('AppIcon', AppIcon);
app.component('AppLayout', AppLayout);
app.component('ContainerIcon', ContainerIcon);
app.component('ThemeToggle', ThemeToggle);
app.component('DataFilterBar', DataFilterBar);
app.component('DataTable', DataTable);
app.component('DataCardGrid', DataCardGrid);
app.component('DataListAccordion', DataListAccordion);
app.component('DetailPanel', DetailPanel);
app.component('EmptyState', EmptyState);
app.component('Button', Button);
app.component('Dialog', Dialog);
app.component('ConfirmDialog', ConfirmDialog);
app.directive('tooltip', Tooltip);
app.use(PrimeVue, {
  theme: { preset: Aura, options: { darkModeSelector: '.dark' } },
});
app.use(ConfirmationService);
app.use(router);
app.mount('#app');
