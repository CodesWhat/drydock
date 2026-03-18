import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workerPath = resolve(process.cwd(), '../apps/demo/public/mockServiceWorker.js');

describe('demo mockServiceWorker message handler', () => {
  it('rejects postMessage events without a valid client ID', () => {
    const workerSource = readFileSync(workerPath, 'utf8');
    const messageHandler = workerSource.match(
      /addEventListener\('message',\s*async\s*(?:function\s*)?\(event\)\s*(?:=>\s*)?\{[\s\S]*?\n\}\);/,
    )?.[0];

    expect(messageHandler).toBeDefined();
    expect(messageHandler).toContain('clientId');
    expect(messageHandler).toMatch(
      /if\s*\(\s*!clientId\s*\|\|\s*!self\.clients\s*\)\s*\{\s*return;?\s*\}/,
    );
  });
});
