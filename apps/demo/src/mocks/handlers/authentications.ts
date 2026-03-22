import { HttpResponse, http } from 'msw';

export const authenticationHandlers = [
  http.get('/api/v1/authentications', () => HttpResponse.json({ data: [] })),
];
