import { HttpResponse, http } from 'msw';
import { triggers } from '../data/triggers';

export const triggerHandlers = [
  http.get('/api/v1/triggers', () => HttpResponse.json({ data: triggers })),

  http.get('/api/v1/triggers/:type/:name', ({ params }) => {
    const trigger = triggers.find((t) => t.type === params.type && t.name === params.name);
    if (!trigger) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(trigger);
  }),

  http.get('/api/v1/triggers/:type/:name/:agent', ({ params }) => {
    const trigger = triggers.find((t) => t.type === params.type && t.name === params.name);
    if (!trigger) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(trigger);
  }),

  http.post('/api/v1/triggers/:type/:name', () => HttpResponse.json({ success: true })),

  http.post('/api/v1/triggers/:type/:name/:agent', () => HttpResponse.json({ success: true })),
];
