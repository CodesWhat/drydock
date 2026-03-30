import { asNonEmptyString, asRecord, splitSubjectImageAndTag, toEventList } from './shared.js';
import type { RegistryWebhookReference } from './types.js';

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
