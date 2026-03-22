import { HttpResponse, http } from 'msw';

export const appHandlers = [
  http.get('/api/v1/app', () =>
    HttpResponse.json({
      name: 'Drydock',
      version: '1.5.0',
      description: 'Docker container update manager',
      repository: 'https://github.com/CodesWhat/drydock',
      documentation: 'https://getdrydock.com/docs',
    }),
  ),

  http.get('/api/v1/debug/dump', () => {
    const dateOnly = new Date().toISOString().slice(0, 10);
    return HttpResponse.json(
      {
        generatedAt: new Date().toISOString(),
        server: { version: '1.5.0', mode: 'demo' },
        summary: {
          containers: 25,
          watchers: 2,
          registries: 4,
          triggers: 6,
        },
      },
      {
        headers: {
          'Content-Disposition': `attachment; filename="drydock-debug-${dateOnly}.json"`,
        },
      },
    );
  }),
];
