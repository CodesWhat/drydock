import { HttpResponse, http } from 'msw';

export const storeHandlers = [
  http.get('/api/v1/store', () =>
    HttpResponse.json({
      collections: ['app', 'audit', 'backup', 'container', 'settings'],
      size: 524288,
    }),
  ),
];
