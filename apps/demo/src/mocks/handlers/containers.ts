import { HttpResponse, http } from 'msw';
import { containers } from '../data/containers';

// biome-ignore lint/suspicious/noExplicitAny: mock data is untyped
type MockContainer = (typeof containers)[number] & Record<string, any>;

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

export const containerHandlers = [
  http.get('/api/containers', ({ request }) => {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit')) || containers.length;
    const offset = Number(url.searchParams.get('offset')) || 0;
    const slice = containers.slice(offset, offset + limit);
    return HttpResponse.json({ data: slice });
  }),

  http.get('/api/containers/summary', () => {
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

  http.get('/api/containers/recent-status', () => {
    const statuses: Record<string, string> = {};
    for (const c of containers as MockContainer[]) {
      if (c.updateAvailable) statuses[c.id] = 'pending';
    }
    return HttpResponse.json({ statuses });
  }),

  http.get('/api/containers/groups', () => HttpResponse.json({ data: groupContainers() })),

  http.post('/api/containers/watch', () => HttpResponse.json({ success: true })),

  // Single container
  http.get('/api/containers/:id', ({ params }) => {
    const container = containers.find((c) => c.id === params.id);
    if (!container) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(container);
  }),

  http.delete('/api/containers/:id', () => HttpResponse.json({ success: true })),

  http.post('/api/containers/:id/watch', ({ params }) => {
    const container = containers.find((c) => c.id === params.id);
    if (!container) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(container);
  }),

  // Container triggers
  http.get('/api/containers/:id/triggers', () =>
    HttpResponse.json({
      data: [
        { type: 'slack', name: 'homelab', threshold: 'all' },
        { type: 'discord', name: 'updates', threshold: 'minor' },
      ],
    }),
  ),

  http.post('/api/containers/:id/triggers/:type/:name', () => HttpResponse.json({ success: true })),

  http.post('/api/containers/:id/triggers/:type/:name/:agent', () =>
    HttpResponse.json({ success: true }),
  ),

  // Container logs
  http.get('/api/containers/:id/logs', () =>
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
  http.get('/api/containers/:id/update-operations', () => HttpResponse.json({ data: [] })),

  // Update policy
  http.patch('/api/containers/:id/update-policy', () => HttpResponse.json({ success: true })),

  // Scan
  http.post('/api/containers/:id/scan', ({ params }) => {
    const container = containers.find((c) => c.id === params.id) as MockContainer | undefined;
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
  http.post('/api/containers/:id/env/reveal', ({ params }) => {
    const container = containers.find((c) => c.id === params.id) as MockContainer | undefined;
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
  http.get('/api/containers/:id/backups', () => HttpResponse.json({ data: [] })),

  http.post('/api/containers/:id/rollback', () => HttpResponse.json({ success: true })),
];
