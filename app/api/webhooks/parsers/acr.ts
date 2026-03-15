import { asNonEmptyString, asRecord, splitSubjectImageAndTag } from './shared.js';
import type { RegistryWebhookReference } from './types.js';

function toEventList(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => entry as Record<string, unknown>);
  }

  const record = asRecord(payload);
  return record ? [record] : [];
}

export function parseAcrWebhookPayload(payload: unknown): RegistryWebhookReference[] {
  const events = toEventList(payload);

  return events
    .map((event) => {
      const eventType = asNonEmptyString(event.eventType);
      if (eventType !== 'Microsoft.ContainerRegistry.ImagePushed') {
        return undefined;
      }

      const data = asRecord(event.data);
      const target = asRecord(data?.target);

      const subjectReference = splitSubjectImageAndTag(event.subject);
      const image = asNonEmptyString(target?.repository) || subjectReference?.image;
      const tag = asNonEmptyString(target?.tag) || subjectReference?.tag;
      if (!image || !tag) {
        return undefined;
      }

      return { image, tag };
    })
    .filter((reference): reference is RegistryWebhookReference => Boolean(reference));
}
