import { asNonEmptyString, asRecord, extractImageFromRepositoryUrl } from './shared.js';
import type { RegistryWebhookReference } from './types.js';

export function parseHarborWebhookPayload(payload: unknown): RegistryWebhookReference[] {
  const root = asRecord(payload);
  if (!root) {
    return [];
  }

  const eventData = asRecord(root.event_data);
  if (!eventData) {
    return [];
  }

  const repository = asRecord(eventData.repository);
  const fallbackImage = asNonEmptyString(repository?.repo_full_name);
  const resources = Array.isArray(eventData.resources)
    ? eventData.resources.filter((resource) => resource && typeof resource === 'object')
    : [];

  return resources
    .map((resource) => {
      const resourceRecord = asRecord(resource);
      const tag = asNonEmptyString(resourceRecord?.tag);
      if (!tag) {
        return undefined;
      }

      const image =
        fallbackImage ||
        extractImageFromRepositoryUrl(resourceRecord?.resource_url) ||
        asNonEmptyString(resourceRecord?.repository);
      if (!image) {
        return undefined;
      }

      return { image, tag };
    })
    .filter((reference): reference is RegistryWebhookReference => Boolean(reference));
}
