import { HttpResponse, http } from 'msw';
import { triggers } from '../data/triggers';
import { createTypeNameHandlers } from './typeNameHandlers';

const actionTypes = new Set(['docker', 'dockercompose', 'portainer', 'command']);

const actions = triggers.filter((t) => actionTypes.has(t.type));
const notificationTriggers = triggers.filter((t) => !actionTypes.has(t.type));

function createRunHandlers(basePath: string, items: readonly { type: string; name: string }[]) {
  const run = ({ params }: { params: Record<string, string | readonly string[] | undefined> }) => {
    const found = items.some((t) => t.type === params.type && t.name === params.name);
    if (!found) return new HttpResponse(null, { status: 404 });
    return HttpResponse.json({ success: true });
  };
  return [
    http.post(`${basePath}/:type/:name`, run),
    http.post(`${basePath}/:type/:name/:agent`, run),
  ];
}

export const triggerHandlers = [
  ...createTypeNameHandlers('/api/v1/actions', actions),
  ...createRunHandlers('/api/v1/actions', actions),
  ...createTypeNameHandlers('/api/v1/notification-triggers', notificationTriggers),
  ...createRunHandlers('/api/v1/notification-triggers', notificationTriggers),

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
