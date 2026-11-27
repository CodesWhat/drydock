import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import express from 'express';

const { mockGetServerConfiguration, uiDirectoryRef } = vi.hoisted(() => ({
  mockGetServerConfiguration: vi.fn(() => ({ basepath: '/drydock' })),
  uiDirectoryRef: { value: '' },
}));

vi.mock('../configuration/index.js', () => ({
  getServerConfiguration: mockGetServerConfiguration,
}));

vi.mock('../runtime/paths.js', () => ({
  resolveUiDirectory: () => uiDirectoryRef.value,
}));

import { createBasePathMiddleware } from './base-path.js';
import * as uiRouter from './ui.js';
import {
  rewriteFontCss,
  rewriteIndexHtml,
  rewriteRegisterServiceWorker,
  rewriteWebManifest,
} from './ui.js';

const INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <link rel="icon" href="/favicon.ico?v=2" sizes="any" />
  <script type="module" crossorigin src="/assets/index-abc.js"></script>
  <link rel="stylesheet" crossorigin href="/assets/index-abc.css">
  <link rel="manifest" href="/site.webmanifest"><script src="/registerSW.js"></script>
  <a href="//cdn.example.com/x">cdn</a>
</head>
<body><div id="app"></div></body>
</html>`;
const REGISTER_SW = `if('serviceWorker' in navigator) {window.addEventListener('load', () => {navigator.serviceWorker.register('/sw.js', { scope: '/' })})}`;
const MANIFEST = JSON.stringify({
  name: 'Drydock',
  start_url: '/',
  scope: '/',
  icons: [{ src: '/web-app-manifest-192x192.png' }, { src: 'relative.png' }],
});
const FONT_CSS =
  "@font-face { src: url(/fonts/x/files/a.woff2) format('woff2'), url(//cdn/a.woff); }";

let uiDirectory: string;
let server: http.Server;
let baseUrl: string;

async function get(pathname: string) {
  const response = await fetch(`${baseUrl}${pathname}`);
  return { status: response.status, headers: response.headers, body: await response.text() };
}

async function startApp(basePath: string) {
  mockGetServerConfiguration.mockReturnValue({ basepath: basePath });
  const app = express();
  if (basePath) {
    app.use(createBasePathMiddleware(basePath));
  }
  app.use('/', uiRouter.init());
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(() => {
  uiDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-ui-base-path-'));
  uiDirectoryRef.value = uiDirectory;
  fs.mkdirSync(path.join(uiDirectory, 'assets'));
  fs.mkdirSync(path.join(uiDirectory, 'fonts', 'x'), { recursive: true });
  fs.writeFileSync(path.join(uiDirectory, 'index.html'), INDEX_HTML);
  fs.writeFileSync(path.join(uiDirectory, 'registerSW.js'), REGISTER_SW);
  fs.writeFileSync(path.join(uiDirectory, 'site.webmanifest'), MANIFEST);
  fs.writeFileSync(path.join(uiDirectory, 'fonts', 'x', '400.css'), FONT_CSS);
  fs.writeFileSync(path.join(uiDirectory, 'assets', 'index-abc.js'), 'console.log(1)');
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(uiDirectory, { recursive: true, force: true });
});

describe('UI under DD_SERVER_BASEPATH', () => {
  test('serves a rewritten index.html at the sub-path root', async () => {
    await startApp('/drydock');
    const response = await get('/drydock/');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.body).toContain('<meta name="dd-base-path" content="/drydock">');
    expect(response.body).toContain('src="/drydock/assets/index-abc.js"');
    expect(response.body).toContain('href="/drydock/assets/index-abc.css"');
    expect(response.body).toContain('href="/drydock/favicon.ico?v=2"');
    expect(response.body).toContain('href="/drydock/site.webmanifest"');
    expect(response.body).toContain('href="//cdn.example.com/x"');
  });

  test('serves the rewritten shell for the bare sub-path and for deep SPA links', async () => {
    await startApp('/drydock');
    for (const url of ['/drydock', '/drydock/containers/abc/logs', '/drydock/login?next=1']) {
      const response = await get(url);
      expect(response.status).toBe(200);
      expect(response.body).toContain('src="/drydock/assets/index-abc.js"');
    }
  });

  test('also serves the app when the proxy already stripped the prefix', async () => {
    await startApp('/drydock');
    const response = await get('/containers');
    expect(response.status).toBe(200);
    expect(response.body).toContain('src="/drydock/assets/index-abc.js"');
  });

  test('rewrites the service worker registration, manifest and font stylesheets', async () => {
    await startApp('/drydock');
    const register = await get('/drydock/registerSW.js');
    expect(register.headers.get('cache-control')).toBe('no-cache');
    expect(register.headers.get('content-type')).toContain('javascript');
    expect(register.body).toContain("register('/drydock/sw.js', { scope: '/drydock/' })");

    const manifest = JSON.parse((await get('/drydock/site.webmanifest')).body);
    expect(manifest.start_url).toBe('/drydock/');
    expect(manifest.scope).toBe('/drydock/');
    expect(manifest.icons[0].src).toBe('/drydock/web-app-manifest-192x192.png');
    expect(manifest.icons[1].src).toBe('relative.png');

    const font = await get('/drydock/fonts/x/400.css');
    expect(font.body).toContain('url(/drydock/fonts/x/files/a.woff2)');
    expect(font.body).toContain('url(//cdn/a.woff)');
  });

  test('serves hashed assets untouched and 404s missing ones', async () => {
    await startApp('/drydock');
    const asset = await get('/drydock/assets/index-abc.js');
    expect(asset.body).toBe('console.log(1)');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await get('/drydock/assets/gone.js')).status).toBe(404);
  });

  test('falls through to the static handler when a rewritten file is missing or non-GET', async () => {
    await startApp('/drydock');
    fs.rmSync(path.join(uiDirectory, 'fonts', 'x', '400.css'));
    expect((await get('/drydock/fonts/x/400.css')).body).toContain('dd-base-path');
    const head = await fetch(`${baseUrl}/drydock/registerSW.js`, { method: 'HEAD' });
    expect(head.status).toBe(200);
  });

  test('never reads a stylesheet outside the ui directory', async () => {
    await startApp('/drydock');
    fs.writeFileSync(path.join(path.dirname(uiDirectory), 'dd-outside.css'), 'secret');
    const target = `/fonts/../../${path.basename(uiDirectory)}/../dd-outside.css`;
    const body = await new Promise<string>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port: new URL(baseUrl).port, path: target }, (response) => {
          let data = '';
          response.on('data', (chunk) => {
            data += chunk;
          });
          response.on('end', () => resolve(data));
        })
        .on('error', reject);
    });
    fs.rmSync(path.join(path.dirname(uiDirectory), 'dd-outside.css'));
    expect(body).not.toContain('secret');
  });

  test('does not rewrite anything without a base path', async () => {
    await startApp('');
    const response = await get('/');
    expect(response.body).not.toContain('dd-base-path');
    expect(response.body).toContain('src="/assets/index-abc.js"');
    expect((await get('/registerSW.js')).body).toBe(REGISTER_SW);
  });
});

describe('rewrite helpers', () => {
  test('rewriteIndexHtml escapes the base path in the meta tag', () => {
    expect(rewriteIndexHtml('<head></head>', '/a')).toContain('content="/a"');
  });

  test('rewriteRegisterServiceWorker leaves unrelated scripts alone', () => {
    expect(rewriteRegisterServiceWorker('noop()', '/a')).toBe('noop()');
  });

  test('rewriteWebManifest tolerates a manifest without start_url, scope or icons', () => {
    expect(rewriteWebManifest('{"name":"x"}', '/a')).toBe('{"name":"x"}');
  });

  test('rewriteFontCss prefixes only root-absolute urls', () => {
    expect(rewriteFontCss('url(/f/a.woff2) url(//c/b) url(rel.woff)', '/a')).toBe(
      'url(/a/f/a.woff2) url(//c/b) url(rel.woff)',
    );
  });
});
