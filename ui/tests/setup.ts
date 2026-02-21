import { config } from '@vue/test-utils';
import { createVuetify } from 'vuetify';

// Some CI/runtime environments expose an incompatible localStorage object.
// Override with a minimal Storage-compatible mock used by this test suite.
const localStorageMock: Record<string, any> = {
  getItem(key: string) {
    return key in localStorageMock ? String(localStorageMock[key]) : null;
  },
  setItem(key: string, value: string) {
    localStorageMock[key] = String(value);
  },
  removeItem(key: string) {
    delete localStorageMock[key];
  },
  clear() {
    for (const key of Object.keys(localStorageMock)) {
      if (key === 'getItem' || key === 'setItem' || key === 'removeItem' || key === 'clear') {
        continue;
      }
      delete localStorageMock[key];
    }
  },
};

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  configurable: true,
  writable: true,
});

// Create a Vuetify instance for testing
const vuetify = createVuetify({
  theme: {
    defaultTheme: 'light',
  },
});

// Mock global properties
const mockEventBus = {
  emit: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
};

const mockFilters = {
  date: vi.fn((date) => new Date(date).toLocaleDateString()),
  dateTime: vi.fn((date) => new Date(date).toLocaleString()),
  short: vi.fn((str, length) => `${str?.substring(0, length)}...`),
};

// Mock router
const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  go: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
};

// Global test configuration
config.global.mocks = {
  $eventBus: mockEventBus,
  $filters: mockFilters,
  $serverConfig: {
    feature: {
      delete: true,
    },
  },
  $router: mockRouter,
  $route: {
    name: 'test',
    path: '/test',
    query: {},
    params: {},
  },
  $vuetify: {
    theme: {
      current: {
        dark: false,
      },
    },
    display: {
      xs: false,
      sm: false,
      md: true,
      lg: false,
      xl: false,
      xxl: false,
      smAndUp: true,
      mdAndUp: true,
      lgAndUp: false,
      xlAndUp: false,
      smAndDown: false,
      mdAndDown: true,
      lgAndDown: true,
      xlAndDown: true,
    },
  },
};

// Mock fetch globally
global.fetch = vi.fn();
(global.fetch as any).mockResolvedValue = vi.fn();
(global.fetch as any).mockResolvedValueOnce = vi.fn();
(global.fetch as any).mockRejectedValue = vi.fn();
(global.fetch as any).mockRejectedValueOnce = vi.fn();
(global.fetch as any).mockClear = vi.fn();

// Mock Vuetify components with templates
config.global.stubs = {
  'router-link': { template: '<a><slot /></a>' },
  'router-view': { template: '<div><slot /></div>' },
  'v-img': { template: '<div class="v-img"><slot /></div>' },
  'v-avatar': { template: '<div class="v-avatar"><slot /></div>' },
  'v-app': { template: '<div class="v-app"><slot /></div>' },
  'v-main': { template: '<div class="v-main"><slot /></div>' },
  'v-container': { template: '<div class="v-container"><slot /></div>' },
  'v-row': { template: '<div class="v-row"><slot /></div>' },
  'v-col': { template: '<div class="v-col"><slot /></div>' },
  'v-card': { template: '<div class="v-card"><slot /></div>' },
  'v-card-title': { template: '<div class="v-card-title"><slot /></div>' },
  'v-card-subtitle': { template: '<div class="v-card-subtitle"><slot /></div>' },
  'v-card-text': { template: '<div class="v-card-text"><slot /></div>' },
  'v-card-actions': { template: '<div class="v-card-actions"><slot /></div>' },
  'v-btn': {
    template:
      '<button class="v-btn" :to="to" :disabled="disabled" :type="type" @click="$emit(\'click\')"><slot /></button>',
    props: ['disabled', 'type', 'to', 'color', 'variant'],
    emits: ['click'],
    name: 'v-btn',
  },
  'v-icon': { template: '<i class="v-icon"><slot /></i>' },
  'v-chip': { template: '<span class="v-chip"><slot /></span>' },
  'v-select': {
    template:
      '<select class="v-select" :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><option v-for="item in items" :key="item.value" :value="item.value">{{ item.title }}</option></select>',
    props: ['modelValue', 'items'],
    emits: ['update:modelValue'],
  },
  'v-autocomplete': {
    template:
      '<input class="v-autocomplete" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    props: ['modelValue'],
    emits: ['update:modelValue'],
  },
  'v-switch': {
    template:
      '<input type="checkbox" class="v-switch" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
    props: ['modelValue'],
    emits: ['update:modelValue'],
  },
  'v-text-field': {
    template:
      '<input class="v-text-field" :type="type" :autocomplete="autocomplete" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />',
    props: ['type', 'autocomplete', 'modelValue'],
    emits: ['update:modelValue'],
  },
  'v-snackbar': {
    template:
      '<div class="v-snackbar" v-if="modelValue"><slot />{{ text }}<slot name="actions" /><button v-if="$slots.action || closable" data-testid="close-button" @click="$emit(\'update:modelValue\', false)">Close</button></div>',
    props: ['modelValue', 'timeout', 'color', 'text', 'closable', 'variant'],
    emits: ['update:modelValue'],
    name: 'v-snackbar',
  },
  'v-tabs': { template: '<div class="v-tabs"><slot /></div>' },
  'v-tab': { template: '<button class="v-tab"><slot /></button>' },
  'v-window': { template: '<div class="v-window"><slot /></div>' },
  'v-window-item': { template: '<div class="v-window-item"><slot /></div>' },
  'v-dialog': { template: '<div class="v-dialog"><slot /></div>' },
  'v-overlay': { template: '<div class="v-overlay"><slot /></div>' },
  'v-progress-circular': { template: '<div class="v-progress-circular"><slot /></div>' },
  'v-progress-linear': { template: '<div class="v-progress-linear" />' },
  'v-alert': { template: '<div class="v-alert"><slot /></div>', props: ['type'] },
  'v-divider': { template: '<div class="v-divider"></div>' },
  'v-spacer': { template: '<div class="v-spacer"></div>' },
  'v-tooltip': {
    template: '<div class="v-tooltip"><slot name="activator" :props="{}" /><slot /></div>',
  },
  'v-form': { template: '<form class="v-form" @keyup.enter="() => {}"><slot /></form>' },
  'v-list': { template: '<div class="v-list"><slot /></div>' },
  'v-list-item': {
    template:
      '<div class="v-list-item"><slot name="prepend" /><slot /><slot name="append" /></div>',
  },
  'v-list-item-title': { template: '<div class="v-list-item-title"><slot /></div>' },
  'v-list-item-subtitle': { template: '<div class="v-list-item-subtitle"><slot /></div>' },
  'v-toolbar-title': { template: '<div class="v-toolbar-title"><slot /></div>' },
  'v-app-bar': { template: '<div class="v-app-bar"><slot /></div>' },
  'v-app-bar-nav-icon': {
    template:
      '<button class="v-app-bar-nav-icon" @click="$emit(\'click\', $event)"><slot /></button>',
    emits: ['click'],
  },
  'v-navigation-drawer': { template: '<div class="v-navigation-drawer"><slot /></div>' },
  'v-toolbar': { template: '<div class="v-toolbar"><slot /></div>' },
  'v-footer': { template: '<footer class="v-footer"><slot /></footer>' },
  'v-menu': { template: '<div class="v-menu"><slot name="activator" :props="{}" /><slot /></div>' },
  'container-filter': {
    template: '<div class="container-filter">Watcher Registry Update kind Group by label</div>',
    name: 'container-filter',
  },
  'container-item': { template: '<div class="container-item"><slot /></div>' },
  'container-group': { template: '<div class="container-group"><slot /></div>' },
  'container-image': { template: '<div class="container-image"><slot /></div>' },
  'container-detail': { template: '<div class="container-detail"><slot /></div>' },
  'container-update': { template: '<div class="container-update"><slot /></div>' },
  'container-logs': { template: '<div class="container-logs"><slot /></div>' },
  'application-logs': { template: '<div class="application-logs"><slot /></div>' },
  'container-triggers': { template: '<div class="container-triggers"><slot /></div>' },
  'container-preview': { template: '<div class="container-preview"><slot /></div>' },
  'container-rollback': { template: '<div class="container-rollback"><slot /></div>' },
  'self-update-overlay': { template: '<div class="self-update-overlay" />' },
  'v-pagination': { template: '<div class="v-pagination"></div>', props: ['modelValue', 'length'] },
  IconRenderer: { template: '<div class="icon-renderer"><slot /></div>' },
};

// Global plugins
config.global.plugins = [vuetify];

// Mock display composable and Vue Router
config.global.provide = {
  'Symbol(vuetify:display)': {
    xs: false,
    sm: false,
    md: true,
    lg: false,
    xl: false,
    xxl: false,
    smAndUp: true,
    mdAndUp: true,
    lgAndUp: false,
    xlAndUp: false,
    smAndDown: false,
    mdAndDown: true,
    lgAndDown: true,
    xlAndDown: true,
  },
  'Symbol(route location)': {
    name: 'test',
    path: '/test',
    query: {},
    params: {},
  },
  'Symbol(router)': {
    push: vi.fn(),
    replace: vi.fn(),
    go: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  },
};
