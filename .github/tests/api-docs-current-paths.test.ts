import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const currentApiDocs = [
  '../../content/docs/current/api/index.mdx',
  '../../content/docs/current/api/container.mdx',
].map((path) => fileURLToPath(new URL(path, import.meta.url)));

test('current API docs do not advertise removed collection container stats endpoints', () => {
  const removedPaths = ['GET /api/v1/containers/stats', '`GET /api/v1/containers/stats`'];

  for (const docPath of currentApiDocs) {
    const doc = readFileSync(docPath, 'utf8');
    for (const removedPath of removedPaths) {
      expect(doc).not.toContain(removedPath);
    }
  }
});
