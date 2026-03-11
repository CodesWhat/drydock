import { HttpResponse, http } from 'msw';

const settings = { internetlessMode: false };

export const settingsHandlers = [
  http.get('/api/settings', () => HttpResponse.json(settings)),

  http.patch('/api/settings', () => HttpResponse.json(settings)),

  http.delete('/api/icons/cache', () => HttpResponse.json({ cleared: 12 })),
];
