import { HttpResponse, http } from 'msw';

export const appHandlers = [
  http.get('/api/app', () =>
    HttpResponse.json({
      name: 'Drydock',
      version: '1.4.0',
      description: 'Docker container update manager',
      repository: 'https://github.com/CodesWhat/drydock',
      documentation: 'https://getdrydock.com/docs',
    }),
  ),
];
