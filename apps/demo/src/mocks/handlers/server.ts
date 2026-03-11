import { HttpResponse, http } from 'msw';
import { securityRuntime, serverInfo } from '../data/server';

export const serverHandlers = [
  http.get('/api/server', () => HttpResponse.json(serverInfo)),

  http.get('/api/server/security/runtime', () => HttpResponse.json(securityRuntime)),
];
