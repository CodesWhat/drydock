import { asNonEmptyString, asRecord } from './shared.js';
import type { RegistryWebhookReference } from './types.js';

export function parseDockerHubWebhookPayload(payload: unknown): RegistryWebhookReference[] {
  const root = asRecord(payload);
  if (!root) {
    return [];
  }

  const repository = asRecord(root.repository);
  const pushData = asRecord(root.push_data);

  const tag = asNonEmptyString(pushData?.tag);
  if (!tag) {
    return [];
  }

  const repositoryName =
    asNonEmptyString(repository?.repo_name) ||
    [asNonEmptyString(repository?.namespace), asNonEmptyString(repository?.name)]
      .filter((part): part is string => Boolean(part))
      .join('/');

  const image = asNonEmptyString(repositoryName);
  if (!image) {
    return [];
  }

  return [{ image, tag }];
}
