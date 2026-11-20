import http from 'node:http';
import express from 'express';
import * as configRouter from './config.js';
import { requireSameOriginForMutations } from './csrf.js';
import { requireJsonContentTypeForMutations } from './json-content-type.js';

const { reload, watch } = vi.hoisted(() => ({
  reload: vi.fn(),
  watch: vi.fn(),
}));
vi.mock('../registry/index.js', () => ({ getState: () => ({ trigger: {}, watcher: {} }) }));
vi.mock('../configuration/file/reload.js', () => ({ reloadConfiguration: reload }));
vi.mock('./audit-events.js', () => ({ recordAuditEvent: vi.fn() }));

function post(port: number, path: string, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path, method: 'POST', headers },
      (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode ?? 0));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

describe('anonymous-auth installs and cross-site body-less POSTs', () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    // Production order: body gate, (anonymous auth admits every request), CSRF guard, routes.
    const app = express();
    app.use(requireJsonContentTypeForMutations);
    app.use((req, _res, next) => {
      (req as any).user = { username: 'anonymous' };
      next();
    });
    app.use(requireSameOriginForMutations);
    app.use('/api/v1/config', configRouter.init());
    app.post('/api/v1/containers/watch', (_req, res) => {
      watch();
      res.status(200).json({});
    });
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    reload.mockReset();
    watch.mockReset();
    reload.mockResolvedValue({ applied: false, errors: [] });
  });

  const paths = ['/api/v1/config/reload', '/api/v1/containers/watch'];

  test.each(paths)('rejects a cross-site POST to %s without invoking the handler', async (path) => {
    const status = await post(port, path, {
      Origin: 'http://evil.example.com',
      'Sec-Fetch-Site': 'cross-site',
    });
    expect(status).toBe(403);
    expect(reload).not.toHaveBeenCalled();
    expect(watch).not.toHaveBeenCalled();
  });

  test.each(paths)('rejects a mismatched Origin POST to %s', async (path) => {
    const status = await post(port, path, { Origin: 'http://evil.example.com' });
    expect(status).toBe(403);
    expect(reload).not.toHaveBeenCalled();
    expect(watch).not.toHaveBeenCalled();
  });

  test.each(paths)('lets a matching-origin POST to %s through', async (path) => {
    const status = await post(port, path, {
      Origin: `http://127.0.0.1:${port}`,
      'Sec-Fetch-Site': 'same-origin',
    });
    expect(status).toBe(200);
    expect(reload.mock.calls.length + watch.mock.calls.length).toBe(1);
  });

  test.each(paths)('lets a header-free CLI POST to %s through', async (path) => {
    const status = await post(port, path, {});
    expect(status).toBe(200);
    expect(reload.mock.calls.length + watch.mock.calls.length).toBe(1);
  });
});
