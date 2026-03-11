import { HttpResponse, http } from 'msw';

export const storeHandlers = [
  http.get('/api/store', () =>
    HttpResponse.json({
      collections: ['app', 'audit', 'backup', 'container'],
      size: 524288,
    }),
  ),
];
