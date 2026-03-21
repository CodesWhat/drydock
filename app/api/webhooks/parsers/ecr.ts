import { asNonEmptyString, asRecord, toEventList } from './shared.js';
import type { RegistryWebhookReference } from './types.js';

export function parseEcrEventBridgePayload(payload: unknown): RegistryWebhookReference[] {
  const events = toEventList(payload);

  return events
    .map((event) => {
      const source = asNonEmptyString(event.source);
      const detailType = asNonEmptyString(event['detail-type']);
      if (source !== 'aws.ecr' || detailType !== 'ECR Image Action') {
        return undefined;
      }

      const detail = asRecord(event.detail);
      const actionType = asNonEmptyString(detail?.['action-type']);
      const result = asNonEmptyString(detail?.result);
      if (actionType !== 'PUSH' || result !== 'SUCCESS') {
        return undefined;
      }

      const image = asNonEmptyString(detail?.['repository-name']);
      const tag = asNonEmptyString(detail?.['image-tag']);
      if (!image || !tag) {
        return undefined;
      }

      return { image, tag };
    })
    .filter((reference): reference is RegistryWebhookReference => Boolean(reference));
}
