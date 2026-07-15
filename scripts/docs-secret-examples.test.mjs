import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const documentationRoot = join(repositoryRoot, 'content', 'docs');
const activeDocumentationVersions = readdirSync(documentationRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^(?:current|v\d+\.\d+)$/u.test(entry.name))
  .map((entry) => entry.name)
  .sort();
const deliberatePlaceholder = /^replace-with-your-(?:client-secret|telegram-bot-token)$/u;

const examples = [
  {
    kind: 'Azure client secret',
    relativePath: 'configuration/registries/acr/index.mdx',
    assignment: /DD_REGISTRY_ACR_PRIVATE_CLIENTSECRET=["']?([^\s"'`]+)/gu,
  },
  {
    kind: 'Telegram bot token',
    relativePath: 'configuration/triggers/telegram/index.mdx',
    assignment: /DD_(?:NOTIFICATION|TRIGGER)_TELEGRAM_[A-Z0-9_]+_BOTTOKEN=["']?([^\s"'`]+)/gu,
  },
];

test('active documentation uses deliberately invalid credential placeholders', () => {
  for (const version of activeDocumentationVersions) {
    for (const example of examples) {
      const relativePath = join('content', 'docs', version, example.relativePath);
      const body = readFileSync(join(repositoryRoot, relativePath), 'utf8');
      const matches = [...body.matchAll(example.assignment)];

      assert.ok(matches.length > 0, `${relativePath} must include its ${example.kind} example`);

      for (const match of matches) {
        if (!deliberatePlaceholder.test(match[1])) {
          const line = body.slice(0, match.index).split('\n').length;
          assert.fail(
            `${relativePath}:${line} contains a realistic ${example.kind} literal; use a deliberate invalid placeholder`,
          );
        }
      }
    }
  }
});
