import { parseAcrWebhookPayload } from './acr.js';
import { parseDockerHubWebhookPayload } from './docker-hub.js';
import { parseEcrEventBridgePayload } from './ecr.js';
import { parseGhcrWebhookPayload } from './ghcr.js';
import { parseHarborWebhookPayload } from './harbor.js';
import { parseQuayWebhookPayload } from './quay.js';
import type { RegistryWebhookParseResult, RegistryWebhookReference } from './types.js';

interface RegistryWebhookParser {
  provider: RegistryWebhookParseResult['provider'];
  parse: (payload: unknown) => RegistryWebhookReference[];
}

const parsers: RegistryWebhookParser[] = [
  {
    provider: 'dockerhub',
    parse: parseDockerHubWebhookPayload,
  },
  {
    provider: 'ghcr',
    parse: parseGhcrWebhookPayload,
  },
  {
    provider: 'harbor',
    parse: parseHarborWebhookPayload,
  },
  {
    provider: 'quay',
    parse: parseQuayWebhookPayload,
  },
  {
    provider: 'acr',
    parse: parseAcrWebhookPayload,
  },
  {
    provider: 'ecr',
    parse: parseEcrEventBridgePayload,
  },
];

export function parseRegistryWebhookPayload(
  payload: unknown,
): RegistryWebhookParseResult | undefined {
  for (const parser of parsers) {
    const references = parser.parse(payload);
    if (references.length > 0) {
      return {
        provider: parser.provider,
        references,
      };
    }
  }

  return undefined;
}
