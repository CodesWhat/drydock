import { HttpResponse, http } from 'msw';
import { securityRuntime, serverInfo } from '../data/server';

export const serverHandlers = [
  http.get('/api/v1/server', () => HttpResponse.json(serverInfo)),

  http.get('/api/v1/server/security/runtime', () => HttpResponse.json(securityRuntime)),
];
