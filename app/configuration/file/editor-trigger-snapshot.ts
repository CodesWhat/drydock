import { getState } from '../../registry/index.js';
import { getTriggerCategoryForType } from '../../triggers/trigger-category.js';
import { matchingKeys, type readEditorDocument } from './editor-snapshot.js';
import { triggerFieldDescriptor } from './editor-trigger-field.js';

const NOTIFICATION_POLICY_FIELDS = [
  'threshold',
  'once',
  'mode',
  'securitymode',
  'digestcron',
  'resolvenotifications',
  'securitydigesttitle',
  'securitydigestbody',
] as const;

function triggerPolicySnapshot(
  document: Awaited<ReturnType<typeof readEditorDocument>>,
  category: 'action' | 'notification',
) {
  const policyFields =
    category === 'action' ? ['auto', 'order', 'concurrency'] : NOTIFICATION_POLICY_FIELDS;
  const sections = matchingKeys(document?.doc.contents, category);
  const section = sections.length === 1 ? sections[0] : undefined;
  const triggers = Object.entries(getState().trigger)
    .filter(([, trigger]) => getTriggerCategoryForType(trigger.type) === category)
    .map(([id, trigger]) => {
      const providers = matchingKeys(
        section ? document?.doc.get(section, true) : undefined,
        trigger.type,
      );
      const provider = providers.length === 1 ? providers[0] : undefined;
      const names = matchingKeys(
        section && provider ? document?.doc.getIn([section, provider], true) : undefined,
        trigger.name,
      );
      const name = names.length === 1 ? names[0] : undefined;
      const prefix = section && provider && name ? [section, provider, name] : undefined;
      const node = prefix ? document?.doc.getIn(prefix, true) : undefined;
      const fields = Object.fromEntries(
        policyFields.map((field) => {
          const descriptor = triggerFieldDescriptor({
            document,
            category,
            trigger,
            field,
            node,
            prefix,
          });
          return [field, descriptor] as const;
        }),
      );
      return {
        id,
        type: trigger.type,
        name: trigger.name,
        category,
        ...(trigger.agent ? { agent: trigger.agent } : {}),
        fields,
      };
    });
  return {
    available: document !== undefined,
    ...(document
      ? { revision: document.revision }
      : { readOnlyReason: 'configuration-file-unavailable' }),
    triggers,
  };
}

export function notificationTriggerSnapshot(
  document: Awaited<ReturnType<typeof readEditorDocument>>,
) {
  return triggerPolicySnapshot(document, 'notification');
}

export function actionTriggerSnapshot(document: Awaited<ReturnType<typeof readEditorDocument>>) {
  const { triggers, ...snapshot } = triggerPolicySnapshot(document, 'action');
  return { ...snapshot, actions: triggers };
}
