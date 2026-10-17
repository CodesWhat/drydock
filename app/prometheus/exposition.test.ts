import { register } from '@prometheus-io/client';
import * as auth from './auth.js';
import * as container from './container.js';
import * as prometheus from './index.js';
import * as registry from './registry.js';
import * as trigger from './trigger.js';
import * as watcher from './watcher.js';

vi.mock('../configuration/index.js', () => ({
  getPrometheusConfiguration: () => ({ enabled: true }),
}));
vi.mock('../log/index.js', () => ({
  default: { child: () => ({ info: vi.fn() }) },
}));
vi.mock('../store/container.js', () => ({
  getContainers: () => [{ id: 'container-1', name: 'web', watcher: 'local', agent: 'edge' }],
}));

beforeAll(() => {
  register.clear();
  prometheus.init();
});

afterAll(() => {
  container._resetPrometheusContainerStateForTests();
  auth._resetAuthPrometheusStateForTests();
  register.clear();
});

test('scrapes retain default process and Node.js metrics alongside container labels', async () => {
  const output = await prometheus.output();

  expect(output).toContain('# TYPE process_cpu_user_seconds_total counter\n');
  expect(output).toContain('# TYPE process_resident_memory_bytes gauge\n');
  expect(output).toContain('# TYPE nodejs_eventloop_lag_seconds gauge\n');
  expect(output).toContain('# TYPE nodejs_heap_size_used_bytes gauge\n');
  expect(output).toContain('# TYPE nodejs_version_info gauge\n');
  expect(output).toContain('# HELP dd_containers The watched containers\n');
  expect(output).toContain('# TYPE dd_containers gauge\n');
  const sample = output.split('\n').find((line) => line.startsWith('dd_containers{'));
  expect(sample).toContain('id="container-1"');
  expect(sample).toContain('name="web"');
  expect(sample).toContain('watcher="local"');
  expect(sample).toContain('agent="edge"');
  expect(sample).toMatch(/} 1$/);
});

test('scrapes preserve counter and gauge names, labels and values', async () => {
  trigger.getTriggerCounter()?.inc({ type: 'slack', name: 'updates', status: 'success' }, 2);
  watcher.getWatchContainerGauge().set({ type: 'docker', name: 'local' }, 3);
  auth.recordAuthLogin('success', 'basic');

  const output = await prometheus.output();

  expect(output).toContain('# TYPE dd_trigger_count counter\n');
  expect(output).toContain('dd_trigger_count{type="slack",name="updates",status="success"} 2\n');
  expect(output).toContain('# TYPE dd_watcher_total gauge\n');
  expect(output).toContain('dd_watcher_total{type="docker",name="local"} 3\n');
  expect(output).toContain('drydock_auth_login_total{outcome="success",provider="basic"} 1\n');
});

test('authentication histograms retain cumulative buckets, sums and counts per label set', async () => {
  auth.observeAuthLoginDuration('success', 'basic', 0.025);
  auth.observeAuthLoginDuration('success', 'basic', 0.125);
  auth.observeAuthLoginDuration('invalid', 'oidc', 6);

  const output = await prometheus.output();
  const name = 'drydock_auth_login_duration_seconds';
  const buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, '+Inf'];
  const counts = [0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 2];

  expect(output).toContain(`# TYPE ${name} histogram\n`);
  expect(output.split('\n').filter((line) => line.startsWith(`${name}_bucket{`))).toHaveLength(22);
  buckets.forEach((bound, index) => {
    expect(output).toContain(
      `${name}_bucket{le="${bound}",outcome="success",provider="basic"} ${counts[index]}\n`,
    );
    expect(output).toContain(
      `${name}_bucket{le="${bound}",outcome="invalid",provider="oidc"} ${bound === '+Inf' ? 1 : 0}\n`,
    );
  });
  expect(output).toContain(`${name}_sum{outcome="success",provider="basic"} 0.15\n`);
  expect(output).toContain(`${name}_count{outcome="success",provider="basic"} 2\n`);
  expect(output).toContain(`${name}_sum{outcome="invalid",provider="oidc"} 6\n`);
  expect(output).toContain(`${name}_count{outcome="invalid",provider="oidc"} 1\n`);
});

test('registry summaries retain quantiles, sum and count in seconds', async () => {
  registry.getSummaryTags().observe({ type: 'hub', name: 'public' }, 0.25);

  const output = await prometheus.output();

  expect(output).toContain('# TYPE dd_registry_response summary\n');
  for (const quantile of [0.01, 0.05, 0.5, 0.9, 0.95, 0.99, 0.999]) {
    expect(output).toContain(
      `dd_registry_response{quantile="${quantile}",type="hub",name="public"} 0.25\n`,
    );
  }
  expect(output).toContain('dd_registry_response_sum{type="hub",name="public"} 0.25\n');
  expect(output).toContain('dd_registry_response_count{type="hub",name="public"} 1\n');
});
