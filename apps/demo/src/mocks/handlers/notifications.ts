import { HttpResponse, http } from 'msw';
import { notificationRules } from '../data/notifications';

export const notificationHandlers = [
  http.get('/api/notifications', () => HttpResponse.json({ data: notificationRules })),

  http.patch('/api/notifications/:id', async ({ params, request }) => {
    const rule = notificationRules.find((r) => r.id === params.id);
    if (!rule) return new HttpResponse(null, { status: 404 });
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ ...rule, ...body });
  }),
];
