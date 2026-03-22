import { HttpResponse, http } from 'msw';
import { notificationRules } from '../data/notifications';

export const notificationHandlers = [
  http.get('/api/v1/notifications', () => HttpResponse.json({ data: notificationRules })),

  http.patch('/api/v1/notifications/:id', async ({ params, request }) => {
    const rule = notificationRules.find((r) => r.id === params.id);
    if (!rule) return new HttpResponse(null, { status: 404 });
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ ...rule, ...body });
  }),
];
