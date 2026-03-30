import { HttpResponse, http } from 'msw';
import { containers } from '../data/containers';

type MockContainer = (typeof containers)[number] & Record<string, unknown>;
type ContainerStatsSnapshot = {
  containerId: string;
  cpuPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  networkRxBytes: number;
  networkTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
  timestamp: string;
};

function groupContainers() {
  const groups = new Map<string | null, MockContainer[]>();
  for (const c of containers as MockContainer[]) {
    const groupName = c.labels?.['dd.group'] ?? null;
    const list = groups.get(groupName) ?? [];
    list.push(c);
    groups.set(groupName, list);
  }
  return [...groups.entries()].map(([name, members]) => ({
    name,
    containers: members.map((m) => ({
      id: m.id,
      name: m.name,
      displayName: m.displayName ?? m.name,
      updateAvailable: !!m.updateAvailable,
    })),
    containerCount: members.length,
    updatesAvailable: members.filter((m) => !!m.updateAvailable).length,
  }));
}

function getContainerById(id: string | readonly string[] | undefined): MockContainer | undefined {
  return containers.find((container) => container.id === id) as MockContainer | undefined;
}

function getContainerName(container: MockContainer): string {
  if (typeof container.displayName === 'string' && container.displayName.length > 0) {
    return container.displayName;
  }
  return String(container.name ?? 'container');
}

function getContainerTag(container: MockContainer): string {
  const tag = container.image?.tag?.value;
  return typeof tag === 'string' && tag.length > 0 ? tag : 'latest';
}

function hasContainerUpdate(container: MockContainer): boolean {
  return Boolean(container.updateAvailable && container.result?.tag);
}

function buildStatsSeed(containerId: string): number {
  let seed = 0;
  for (const char of containerId) {
    seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  }
  return seed;
}

function buildStatsSnapshot(containerId: string, minutesAgo: number): ContainerStatsSnapshot {
  const seed = buildStatsSeed(containerId);
  const memoryLimitBytes = 2 * 1024 * 1024 * 1024;
  const usageScale = 0.25 + (seed % 60) / 100;
  const memoryUsageBytes = Math.round(memoryLimitBytes * usageScale);
  const memoryPercent = Math.round((memoryUsageBytes / memoryLimitBytes) * 1000) / 10;
  const cpuPercent = Math.round((3 + (seed % 35) + minutesAgo * 0.2) * 10) / 10;
  return {
    containerId,
    cpuPercent,
    memoryUsageBytes,
    memoryLimitBytes,
    memoryPercent,
    networkRxBytes: (60 + (seed % 700)) * 1024 * 1024,
    networkTxBytes: (40 + (seed % 500)) * 1024 * 1024,
    blockReadBytes: (5 + (seed % 80)) * 1024 * 1024,
    blockWriteBytes: (3 + (seed % 60)) * 1024 * 1024,
    timestamp: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

export const containerHandlers = [
  http.get('/api/v1/containers', ({ request }) => {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit')) || containers.length;
    const offset = Number(url.searchParams.get('offset')) || 0;
    const slice = containers.slice(offset, offset + limit);
    return HttpResponse.json({ data: slice });
  }),

  http.get('/api/v1/containers/summary', () => {
    const running = containers.filter((c) => c.status === 'running').length;
    const stopped = containers.filter((c) => c.status === 'stopped').length;
    const issues = (containers as MockContainer[]).reduce((sum, c) => {
      const summary = c.security?.scan?.summary;
      if (!summary) return sum;
      return sum + ((summary.high ?? 0) + (summary.critical ?? 0));
    }, 0);
    return HttpResponse.json({
      containers: { total: containers.length, running, stopped },
      security: { issues },
    });
  }),

  http.get('/api/v1/containers/recent-status', () => {
    const statuses: Record<string, string> = {};
    for (const c of containers as MockContainer[]) {
      if (c.updateAvailable) statuses[c.id] = 'pending';
    }
    return HttpResponse.json({ statuses });
  }),

  http.get('/api/v1/containers/groups', () => HttpResponse.json({ data: groupContainers() })),

  http.get('/api/v1/containers/stats', () => {
    const data = (containers as MockContainer[]).map((container) => ({
      id: container.id,
      name: getContainerName(container),
      status: String(container.status ?? 'unknown'),
      watcher: String(container.watcher ?? 'local'),
      stats: container.status === 'running' ? buildStatsSnapshot(container.id, 0) : null,
    }));
    return HttpResponse.json({ data });
  }),

  http.post('/api/v1/containers/watch', () => HttpResponse.json({ success: true })),

  // Single container
  http.get('/api/v1/containers/:id', ({ params }) => {
    const container = getContainerById(params.id);
    if (!container) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(container);
  }),

  http.delete('/api/v1/containers/:id', () => HttpResponse.json({ success: true })),

  http.post('/api/v1/containers/:id/watch', ({ params }) => {
    const container = getContainerById(params.id);
    if (!container) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(container);
  }),

  http.post('/api/v1/containers/:id/start', ({ params }) => {
    const container = getContainerById(params.id);
    if (!container) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json({ success: true, action: 'start', id: container.id });
  }),

  http.post('/api/v1/containers/:id/stop', ({ params }) => {
    const container = getContainerById(params.id);
    if (!container) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json({ success: true, action: 'stop', id: container.id });
  }),

  http.post('/api/v1/containers/:id/restart', ({ params }) => {
    const container = getContainerById(params.id);
    if (!container) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json({ success: true, action: 'restart', id: container.id });
  }),

  http.post('/api/v1/containers/:id/update', ({ params }) => {
    const container = getContainerById(params.id);
    if (!container) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json({
      success: true,
      action: 'update',
      id: container.id,
      operationId: `demo-update-${container.id}`,
    });
  }),

  http.post('/api/v1/containers/:id/preview', ({ params }) => {
    const container = getContainerById(params.id);
    if (!container) return new HttpResponse(null, { status: 404 });
    const currentTag = getContainerTag(container);
    const targetTag =
      typeof container.result?.tag === 'string' && container.result.tag.length > 0
        ? container.result.tag
        : currentTag;
    const composeFile = `/srv/stacks/${container.name}/docker-compose.yml`;
    return HttpResponse.json({
      dryRun: true,
      compose: {
        files: [composeFile],
        service: String(container.name),
        writableFile: composeFile,
        willWrite: true,
        patch: `services:\n  ${container.name}:\n    image: ${container.image?.name}:${targetTag}  # was ${currentTag}`,
      },
    });
  }),

  // Container triggers
  http.get('/api/v1/containers/:id/triggers', () =>
    HttpResponse.json({
      data: [
        { type: 'slack', name: 'homelab', threshold: 'all' },
        { type: 'discord', name: 'updates', threshold: 'minor' },
      ],
    }),
  ),

  http.post('/api/v1/containers/:id/triggers/:type/:name', () =>
    HttpResponse.json({ success: true }),
  ),

  http.post('/api/v1/containers/:id/triggers/:type/:name/:agent', () =>
    HttpResponse.json({ success: true }),
  ),

  // Container logs
  http.get('/api/v1/containers/:id/logs', () =>
    HttpResponse.json({
      lines: [
        'Starting container...',
        'Listening on port 3000',
        'Health check passed',
        'Connected to database',
        'Ready to serve requests',
      ],
    }),
  ),

  // Update operations
  http.get('/api/v1/containers/:id/update-operations', () => HttpResponse.json({ data: [] })),

  http.get('/api/v1/containers/:id/stats', ({ params }) => {
    const container = getContainerById(params.id);
    if (!container) return new HttpResponse(null, { status: 404 });
    if (container.status !== 'running') {
      return HttpResponse.json({ data: null, history: [] });
    }
    const history = Array.from({ length: 12 }, (_, index) =>
      buildStatsSnapshot(container.id, (11 - index) * 5),
    );
    return HttpResponse.json({ data: history.at(-1) ?? null, history });
  }),

  http.get('/api/v1/containers/:id/release-notes', ({ params }) => {
    const container = getContainerById(params.id);
    if (!container || !hasContainerUpdate(container)) {
      return new HttpResponse(null, { status: 404 });
    }
    const currentTag = getContainerTag(container);
    const targetTag = String(container.result?.tag);
    const name = getContainerName(container);
    return HttpResponse.json({
      title: `${name} ${targetTag}`,
      body: `Demo release notes for ${name}\n\n- Current: ${currentTag}\n- Available: ${targetTag}\n- Kind: ${container.updateKind?.semverDiff ?? 'update'}`,
      url: `https://github.com/CodesWhat/drydock/releases/tag/v${targetTag}`,
      publishedAt: new Date(Date.now() - 86_400_000).toISOString(),
      provider: 'github',
    });
  }),

  // Update policy
  http.patch('/api/v1/containers/:id/update-policy', () => HttpResponse.json({ success: true })),

  // Scan
  http.post('/api/v1/containers/:id/scan', ({ params }) => {
    const container = getContainerById(params.id);
    return HttpResponse.json({
      success: true,
      summary: container?.security?.scan?.summary ?? {
        unknown: 0,
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
      },
    });
  }),

  // Env reveal
  http.post('/api/v1/containers/:id/env/reveal', ({ params }) => {
    const container = getContainerById(params.id);
    if (!container) return new HttpResponse(null, { status: 404 });
    const env = container.details?.env ?? [];
    return HttpResponse.json({
      env: env.map((e: { key: string; value: string; sensitive?: boolean }) => ({
        ...e,
        value: e.sensitive ? 'revealed-secret-value' : e.value,
      })),
    });
  }),

  // Backups
  http.get('/api/v1/containers/:id/backups', () => HttpResponse.json({ data: [] })),

  http.post('/api/v1/containers/:id/rollback', () => HttpResponse.json({ success: true })),
];
