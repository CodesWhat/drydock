import { HttpResponse, http } from 'msw';
import { readJsonRecord } from './json';

const settings = { internetlessMode: false, updateMode: 'manual' as 'notify' | 'manual' | 'auto' };

export const settingsHandlers = [
  http.get('/api/v1/settings', () => HttpResponse.json(settings)),

  http.patch('/api/v1/settings', async ({ request }) => {
    const body = await readJsonRecord(request);
    if (!body) {
      return HttpResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }
    if (typeof body.internetlessMode === 'boolean') {
      settings.internetlessMode = body.internetlessMode;
    }
    if (
      body.updateMode === 'notify' ||
      body.updateMode === 'manual' ||
      body.updateMode === 'auto'
    ) {
      settings.updateMode = body.updateMode;
    }
    return HttpResponse.json(settings);
  }),

  http.delete('/api/v1/icons/cache', () => HttpResponse.json({ cleared: 12 })),
];
