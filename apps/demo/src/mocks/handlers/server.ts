import { HttpResponse, http } from 'msw';
import { securityRuntime, serverInfo } from '../data/server';

export const serverHandlers = [
  http.get('/api/v1/server', () => HttpResponse.json(serverInfo)),

  http.get('/api/v1/server/security/runtime', () => HttpResponse.json(securityRuntime)),

  http.post('/api/v1/server/security/assets/:provider/:operation', ({ params }) =>
    HttpResponse.json({
      provider: params.provider,
      backend: 'docker',
      configuredImage: `demo/${params.provider}@sha256:${'a'.repeat(64)}`,
      state: 'ready',
    }),
  ),
];
