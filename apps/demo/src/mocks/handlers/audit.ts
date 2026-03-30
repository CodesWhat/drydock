import { HttpResponse, http } from 'msw';
import { auditEntries } from '../data/audit';

export const auditHandlers = [
  http.get('/api/v1/audit', ({ request }) => {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit')) || 50;
    const offset = Number(url.searchParams.get('offset')) || 0;
    const action = url.searchParams.get('action');
    const container = url.searchParams.get('container');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    let filtered = [...auditEntries];

    if (action) {
      filtered = filtered.filter((e) => e.action === action);
    }
    if (container) {
      filtered = filtered.filter((e) => e.container === container);
    }
    if (from) {
      filtered = filtered.filter((e) => e.timestamp >= from);
    }
    if (to) {
      filtered = filtered.filter((e) => e.timestamp <= to);
    }

    const total = filtered.length;
    const entries = filtered.slice(offset, offset + limit);

    return HttpResponse.json({ entries, total, offset, limit });
  }),
];
