import {
  asNonEmptyString,
  asRecord,
  asStringArray,
  extractImageFromRepositoryUrl,
  uniqStrings,
} from './shared.js';
import type { RegistryWebhookReference } from './types.js';

export function parseQuayWebhookPayload(payload: unknown): RegistryWebhookReference[] {
  const root = asRecord(payload);
  if (!root) {
    return [];
  }

  const tags = uniqStrings(asStringArray(root.updated_tags));
  if (tags.length === 0) {
    return [];
  }

  const image =
    asNonEmptyString(root.repository) ||
    extractImageFromRepositoryUrl(root.docker_url) ||
    extractImageFromRepositoryUrl(root.homepage);
  if (!image) {
    return [];
  }

  return tags.map((tag) => ({ image, tag }));
}
