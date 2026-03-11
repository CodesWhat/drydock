import { HttpResponse, http } from 'msw';

export const authenticationHandlers = [
  http.get('/api/authentications', () => HttpResponse.json({ data: [] })),
];
