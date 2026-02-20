import { config } from '@vue/test-utils';

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
};

// Mock fetch globally
global.fetch = vi.fn();
(global.fetch as any).mockResolvedValue = vi.fn();
(global.fetch as any).mockResolvedValueOnce = vi.fn();
(global.fetch as any).mockRejectedValue = vi.fn();
(global.fetch as any).mockRejectedValueOnce = vi.fn();
(global.fetch as any).mockClear = vi.fn();

// Mock Vue Router provide symbols
config.global.provide = {
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
