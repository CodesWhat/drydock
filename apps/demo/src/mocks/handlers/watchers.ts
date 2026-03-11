import { HttpResponse, http } from 'msw';
import { watchers } from '../data/watchers';

export const watcherHandlers = [
  http.get('/api/watchers', () => HttpResponse.json({ data: watchers })),

  http.get('/api/watchers/:type/:name', ({ params }) => {
    const watcher = watchers.find((w) => w.type === params.type && w.name === params.name);
    if (!watcher) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(watcher);
  }),

  http.get('/api/watchers/:type/:name/:agent', ({ params }) => {
    const watcher = watchers.find((w) => w.type === params.type && w.name === params.name);
    if (!watcher) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(watcher);
  }),
];
