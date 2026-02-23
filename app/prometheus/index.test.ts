// @ts-nocheck
import * as prometheus from './index.js';

vi.mock('../configuration', () => ({
  getPrometheusConfiguration: vi.fn(() => ({ enabled: true })),
}));

// Mock prom-client
vi.mock('prom-client', () => ({
  collectDefaultMetrics: vi.fn(),
  Counter: vi.fn(() => ({ inc: vi.fn(), name: 'mock_counter' })),
  register: {
    metrics: vi.fn(() => 'mocked_metrics_output'),
    removeSingleMetric: vi.fn(),
  },
}));

// Mock child modules
vi.mock('./container', () => ({
  init: vi.fn(),
}));

vi.mock('./compatibility', () => ({
  init: vi.fn(),
}));

vi.mock('./trigger', () => ({
  init: vi.fn(),
}));

vi.mock('./watcher', () => ({
  init: vi.fn(),
}));

vi.mock('./registry', () => ({
  init: vi.fn(),
}));

vi.mock('./audit', () => ({
  init: vi.fn(),
}));

vi.mock('./container-actions', () => ({
  init: vi.fn(),
}));

vi.mock('./webhook', () => ({
  init: vi.fn(),
}));

vi.mock('../log', () => ({ default: { child: vi.fn(() => ({ info: vi.fn() })) } }));

describe('Prometheus Module', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const configuration = await import('../configuration/index.js');
    configuration.getPrometheusConfiguration.mockReturnValue({ enabled: true });
  });

  test('should initialize all prometheus components when enabled', async () => {
    const { collectDefaultMetrics } = await import('prom-client');
    const container = await import('./container.js');
    const compatibility = await import('./compatibility.js');
    const trigger = await import('./trigger.js');
    const watcher = await import('./watcher.js');
    const registry = await import('./registry.js');
    const audit = await import('./audit.js');
    const containerActions = await import('./container-actions.js');
    const webhook = await import('./webhook.js');

    prometheus.init();

    expect(collectDefaultMetrics).toHaveBeenCalled();
    expect(compatibility.init).toHaveBeenCalled();
    expect(container.init).toHaveBeenCalled();
    expect(registry.init).toHaveBeenCalled();
    expect(trigger.init).toHaveBeenCalled();
    expect(watcher.init).toHaveBeenCalled();
    expect(audit.init).toHaveBeenCalled();
    expect(containerActions.init).toHaveBeenCalled();
    expect(webhook.init).toHaveBeenCalled();
  });

  test('should NOT initialize metrics when disabled', async () => {
    const configuration = await import('../configuration/index.js');
    configuration.getPrometheusConfiguration.mockReturnValue({ enabled: false });

    const { collectDefaultMetrics } = await import('prom-client');
    const container = await import('./container.js');
    const compatibility = await import('./compatibility.js');
    const trigger = await import('./trigger.js');
    const watcher = await import('./watcher.js');
    const registry = await import('./registry.js');
    const audit = await import('./audit.js');
    const containerActions = await import('./container-actions.js');
    const webhook = await import('./webhook.js');

    prometheus.init();

    expect(collectDefaultMetrics).not.toHaveBeenCalled();
    expect(compatibility.init).not.toHaveBeenCalled();
    expect(container.init).not.toHaveBeenCalled();
    expect(registry.init).not.toHaveBeenCalled();
    expect(trigger.init).not.toHaveBeenCalled();
    expect(watcher.init).not.toHaveBeenCalled();
    expect(audit.init).not.toHaveBeenCalled();
    expect(containerActions.init).not.toHaveBeenCalled();
    expect(webhook.init).not.toHaveBeenCalled();
  });

  test('should return metrics output', async () => {
    const { register } = await import('prom-client');

    const output = await prometheus.output();

    expect(register.metrics).toHaveBeenCalled();
    expect(output).toBe('mocked_metrics_output');
  });
});
