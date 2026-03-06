import { createApp } from 'vue';
import App from './App.vue';
import { disableIconifyApi, registerIcons } from './boot/icons';
import AppIcon from './components/AppIcon.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import ContainerIcon from './components/ContainerIcon.vue';
import DataCardGrid from './components/DataCardGrid.vue';
import DataFilterBar from './components/DataFilterBar.vue';
import DataListAccordion from './components/DataListAccordion.vue';
import DataTable from './components/DataTable.vue';
import DataViewLayout from './components/DataViewLayout.vue';
import DetailPanel from './components/DetailPanel.vue';
import EmptyState from './components/EmptyState.vue';
import ThemeToggle from './components/ThemeToggle.vue';
import ToggleSwitch from './components/ToggleSwitch.vue';
import { tooltip as Tooltip } from './directives/tooltip';
import AppLayout from './layouts/AppLayout.vue';
import router from './router';
import { getSettings } from './services/settings';
import './theme/tokens.css';
import './style.css';

// Pre-register only the icons we use so they render offline (no CDN fetch)
registerIcons();

// Disable Iconify CDN fetching when internetless mode is active.
// Runs async — bundled icons are already registered above, so the UI renders
// immediately while this check completes in the background.
getSettings()
  .then((s) => {
    if (s.internetlessMode) disableIconifyApi();
  })
  .catch(() => {
    // Settings unavailable (e.g. backend not ready yet) — leave CDN enabled;
    // the CSP will block fetches anyway if the network is unreachable.
  });

const app = createApp(App);
app.component('AppIcon', AppIcon);
app.component('AppLayout', AppLayout);
app.component('ContainerIcon', ContainerIcon);
app.component('ThemeToggle', ThemeToggle);
app.component('ToggleSwitch', ToggleSwitch);
app.component('DataFilterBar', DataFilterBar);
app.component('DataTable', DataTable);
app.component('DataCardGrid', DataCardGrid);
app.component('DataListAccordion', DataListAccordion);
app.component('DataViewLayout', DataViewLayout);
app.component('DetailPanel', DetailPanel);
app.component('EmptyState', EmptyState);
app.component('ConfirmDialog', ConfirmDialog);
app.directive('tooltip', Tooltip);
app.use(router);
app.mount('#app');
