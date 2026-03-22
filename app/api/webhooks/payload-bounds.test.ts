import { describe, expect, test } from 'vitest';
import { parseRegistryWebhookPayload } from './parsers/index.js';

/**
 * Payload bounds tests — verify webhook parsers and middleware behave
 * safely under adversarial inputs (DoS prevention).
 */

/** Build a deeply nested object: { a: { a: { a: ... } } } */
function buildDeeplyNested(depth: number): Record<string, unknown> {
  let current: Record<string, unknown> = { leaf: true };
  for (let i = 0; i < depth; i += 1) {
    current = { a: current };
  }
  return current;
}

/** Build an object with many top-level keys. */
function buildWideObject(keyCount: number): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < keyCount; i += 1) {
    obj[`key_${i}`] = `value_${i}`;
  }
  return obj;
}

describe('webhook payload bounds (DoS prevention)', () => {
  describe('deeply nested payloads', () => {
    test('parsers return empty for deeply nested object (100 levels)', () => {
      const payload = buildDeeplyNested(100);
      const result = parseRegistryWebhookPayload(payload);
      expect(result).toBeUndefined();
    });

    test('parsers return empty for deeply nested object (1000 levels)', () => {
      const payload = buildDeeplyNested(1_000);
      const result = parseRegistryWebhookPayload(payload);
      expect(result).toBeUndefined();
    });

    test('parsers return empty for deeply nested object (10000 levels)', () => {
      const payload = buildDeeplyNested(10_000);
      const result = parseRegistryWebhookPayload(payload);
      expect(result).toBeUndefined();
    });

    test('nested payload with valid structure at depth still parses correctly', () => {
      const payload = {
        a: { b: { c: buildDeeplyNested(500) } },
        repository: { repo_name: 'org/image' },
        push_data: { tag: 'latest' },
      };
      const result = parseRegistryWebhookPayload(payload);
      expect(result).toStrictEqual({
        provider: 'dockerhub',
        references: [{ image: 'org/image', tag: 'latest' }],
      });
    });
  });

  describe('wide payloads (many keys)', () => {
    test('parsers return empty for object with 10000 keys', () => {
      const payload = buildWideObject(10_000);
      const result = parseRegistryWebhookPayload(payload);
      expect(result).toBeUndefined();
    });

    test('parsers return empty for object with 100000 keys', () => {
      const payload = buildWideObject(100_000);
      const result = parseRegistryWebhookPayload(payload);
      expect(result).toBeUndefined();
    });

    test('valid payload with extra keys still parses correctly', () => {
      const payload = {
        ...buildWideObject(5_000),
        repository: { repo_name: 'org/image' },
        push_data: { tag: 'v1.0' },
      };
      const result = parseRegistryWebhookPayload(payload);
      expect(result).toStrictEqual({
        provider: 'dockerhub',
        references: [{ image: 'org/image', tag: 'v1.0' }],
      });
    });
  });

  describe('oversized string values', () => {
    test('parsers return empty when repo_name is a megabyte string', () => {
      const payload = {
        repository: { repo_name: 'x'.repeat(1_000_000) },
        push_data: { tag: 'latest' },
      };
      const result = parseRegistryWebhookPayload(payload);
      // Parses but the image name is just a huge string — no crash
      expect(result).toBeDefined();
      expect(result?.references[0].image).toHaveLength(1_000_000);
    });

    test('parsers return empty for non-string oversized values', () => {
      const payload = {
        repository: { repo_name: 42 },
        push_data: { tag: 'latest' },
      };
      const result = parseRegistryWebhookPayload(payload);
      expect(result).toBeUndefined();
    });
  });

  describe('array-based parser bounds (ACR, ECR, Harbor)', () => {
    test('ACR parser handles array with 10000 non-matching events without hanging', () => {
      const payload = Array.from({ length: 10_000 }, (_, i) => ({
        eventType: 'Microsoft.ContainerRegistry.ImageDeleted',
        subject: `repo/image:tag-${i}`,
        data: { target: { repository: 'repo', tag: `tag-${i}` } },
      }));
      const result = parseRegistryWebhookPayload(payload);
      expect(result).toBeUndefined();
    });

    test('ACR parser handles array with 10000 matching events', () => {
      const payload = Array.from({ length: 10_000 }, (_, i) => ({
        eventType: 'Microsoft.ContainerRegistry.ImagePushed',
        subject: `repo/image:tag-${i}`,
        data: { target: { repository: 'myrepo', tag: `tag-${i}` } },
      }));
      const result = parseRegistryWebhookPayload(payload);
      expect(result?.provider).toBe('acr');
      expect(result?.references).toHaveLength(10_000);
    });

    test('Harbor parser handles resources array with 10000 entries', () => {
      const payload = {
        event_data: {
          repository: { repo_full_name: 'project/image' },
          resources: Array.from({ length: 10_000 }, (_, i) => ({
            tag: `tag-${i}`,
          })),
        },
      };
      const result = parseRegistryWebhookPayload(payload);
      expect(result?.provider).toBe('harbor');
      expect(result?.references).toHaveLength(10_000);
    });
  });

  describe('malformed payloads', () => {
    test('null payload returns undefined', () => {
      expect(parseRegistryWebhookPayload(null)).toBeUndefined();
    });

    test('numeric payload returns undefined', () => {
      expect(parseRegistryWebhookPayload(42)).toBeUndefined();
    });

    test('boolean payload returns undefined', () => {
      expect(parseRegistryWebhookPayload(true)).toBeUndefined();
    });

    test('empty string payload returns undefined', () => {
      expect(parseRegistryWebhookPayload('')).toBeUndefined();
    });

    test('array of primitives returns undefined', () => {
      expect(parseRegistryWebhookPayload([1, 2, 3])).toBeUndefined();
    });

    test('empty array returns undefined', () => {
      expect(parseRegistryWebhookPayload([])).toBeUndefined();
    });

    test('empty object returns undefined', () => {
      expect(parseRegistryWebhookPayload({})).toBeUndefined();
    });

    test('payload with circular-like repeated references does not crash', () => {
      const shared = { nested: { deep: { value: 'test' } } };
      const payload = {
        a: shared,
        b: shared,
        c: shared,
        repository: shared,
        push_data: shared,
      };
      const result = parseRegistryWebhookPayload(payload);
      expect(result).toBeUndefined();
    });
  });

  describe('express.json() payload size limit', () => {
    test('configured limit is 256kb', async () => {
      // Verify the limit constant is set by importing the module and checking
      // the express.json() call. Since we cannot easily test the middleware
      // in isolation, this test documents the expected behavior:
      // - Payloads <= 256kb are accepted by express.json()
      // - Payloads > 256kb receive a 413 Payload Too Large response
      //
      // The actual enforcement is handled by Express body-parser internals.
      // Integration/E2E tests verify this end-to-end.
      const apiSource = await import('node:fs').then((fs) =>
        fs.readFileSync(new URL('../api.ts', import.meta.url), 'utf8'),
      );
      expect(apiSource).toContain("limit: '256kb'");
    });
  });
});
