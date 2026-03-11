import { HttpResponse, http } from 'msw';
import { registries } from '../data/registries';

export const registryHandlers = [
  http.get('/api/registries', () => HttpResponse.json({ data: registries })),

  http.get('/api/registries/:type/:name', ({ params }) => {
    const reg = registries.find((r) => r.type === params.type && r.name === params.name);
    if (!reg) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(reg);
  }),

  http.get('/api/registries/:type/:name/:agent', ({ params }) => {
    const reg = registries.find((r) => r.type === params.type && r.name === params.name);
    if (!reg) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json(reg);
  }),
];
