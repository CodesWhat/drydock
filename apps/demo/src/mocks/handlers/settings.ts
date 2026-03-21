import { HttpResponse, http } from 'msw';

const settings = { internetlessMode: false };

export const settingsHandlers = [
  http.get('/api/v1/settings', () => HttpResponse.json(settings)),

  http.patch('/api/v1/settings', () => HttpResponse.json(settings)),

  http.delete('/api/v1/icons/cache', () => HttpResponse.json({ cleared: 12 })),
];
