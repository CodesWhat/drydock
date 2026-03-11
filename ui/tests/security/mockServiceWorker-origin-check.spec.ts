import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const workerPath = resolve(process.cwd(), '../apps/demo/public/mockServiceWorker.js');

describe('demo mockServiceWorker message handler', () => {
  it('rejects postMessage events from a different origin', () => {
    const workerSource = readFileSync(workerPath, 'utf8');
    const messageHandler = workerSource.match(
      /addEventListener\('message',\s*async\s*\(event\)\s*=>\s*\{[\s\S]*?\n\}\);/,
    )?.[0];

    expect(messageHandler).toBeDefined();
    expect(messageHandler).toContain('event.origin');
    expect(messageHandler).toMatch(
      /if\s*\(\s*event\.origin\s*!==\s*self\.location\.origin\s*\)\s*\{\s*return;\s*\}/,
    );
  });
});
