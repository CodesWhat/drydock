import { HttpResponse, http } from 'msw';
import { auditEntries } from '../data/audit';

const newestFirst = [...auditEntries].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

export const auditHandlers = [
  http.get('/api/v1/audit', ({ request }) => {
    const url = new URL(request.url);
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
    const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
    const action = url.searchParams.get('action');
    const actions = (url.searchParams.get('actions') ?? '').split(',').filter(Boolean);
    const container = url.searchParams.get('container');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    let filtered = newestFirst;

    if (action) {
      filtered = filtered.filter((e) => e.action === action);
    }
    if (actions.length > 0) {
      filtered = filtered.filter((e) => actions.includes(e.action));
    }
    if (container) {
      filtered = filtered.filter((e) => e.containerName === container);
    }
    if (from) {
      filtered = filtered.filter((e) => e.timestamp >= from);
    }
    if (to) {
      filtered = filtered.filter((e) => e.timestamp <= to);
    }

    const total = filtered.length;
    const data = filtered.slice(offset, offset + limit);

    return HttpResponse.json({ data, total, limit, offset, hasMore: offset + data.length < total });
  }),
];
