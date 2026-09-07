/**
 * Integration test for the global request-body gates `POST
 * /api/v1/config/validate` inherits from `api.ts`: the mutation JSON body
 * parser (`express.json({ limit: '256kb' })`) and
 * `requireJsonContentTypeForMutations`. Both live one layer above the
 * config router and are exercised nowhere else against this specific route,
 * so a real Express pipeline is built here rather than the mocked-router
 * unit style `config.test.ts`/`config-validate.test.ts` use — this is
 * testing the middleware chain itself, not the handler.
 */
import http from 'node:http';
import express, { type Application } from 'express';

vi.mock('./audit-events.js', () => ({ recordAuditEvent: vi.fn() }));

import * as configRouter from './config.js';
import { requireJsonContentTypeForMutations, shouldParseJsonBody } from './json-content-type.js';

interface RunningServer {
  server: http.Server;
  port: number;
}

function createTestApp(): Application {
  const app = express();
  const mutationJsonBodyParser = express.json({ limit: '256kb' });
  app.use(requireJsonContentTypeForMutations);
  app.use((req, res, next) => {
    if (shouldParseJsonBody(req.method)) {
      return mutationJsonBodyParser(req, res, next);
    }
    return next();
  });
  app.use('/api/v1/config', configRouter.init());
  return app;
}

function startServer(app: Application): Promise<RunningServer> {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({ server, port });
    });
  });
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('POST /api/v1/config/validate — global body gates', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const running = await startServer(createTestApp());
    server = running.server;
    port = running.port;
  });

  afterAll(async () => {
    await closeServer(server);
  });

  test('rejects a non-JSON content type before reaching the handler', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/config/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/yaml' },
      body: 'server:\n  port: 3000\n',
    });

    expect(response.status).toBe(415);
  });

  test('rejects a body over the 256kb limit before reaching the handler', async () => {
    const oversizedYaml = `server:\n  port: "${'x'.repeat(300 * 1024)}"\n`;

    const response = await fetch(`http://127.0.0.1:${port}/api/v1/config/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml: oversizedYaml }),
    });

    expect(response.status).toBe(413);
  });

  test('accepts a small, well-formed JSON body', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/config/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        yaml: 'notification:\n  discord:\n    myhook:\n      url: https://discord.example/hook\n',
      }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { valid: boolean };
    expect(payload.valid).toBe(true);
  });
});
