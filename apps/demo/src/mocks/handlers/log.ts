import { HttpResponse, http } from 'msw';
import { logEntries } from '../data/logs';

export const logHandlers = [
  http.get('/api/v1/log', () =>
    HttpResponse.json({
      level: 'info',
      transports: ['console'],
    }),
  ),

  http.get('/api/v1/log/entries', ({ request }) => {
    const url = new URL(request.url);
    const level = url.searchParams.get('level');
    const component = url.searchParams.get('component');
    const tail = Number(url.searchParams.get('tail')) || 100;

    let filtered = [...logEntries];

    if (level && level !== 'all') {
      filtered = filtered.filter((e) => e.level === level);
    }
    if (component) {
      filtered = filtered.filter((e) => e.component === component);
    }

    return HttpResponse.json({ entries: filtered.slice(-tail) });
  }),
];
