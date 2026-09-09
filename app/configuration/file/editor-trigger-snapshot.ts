import { isAlias, isMap, isScalar } from 'yaml';
import { getState } from '../../registry/index.js';
import { getTriggerCategoryForType } from '../../triggers/trigger-category.js';
import { configFileSources } from '../index.js';
import {
  type ConfigurationEditFieldDescriptor,
  matchingKeys,
  type readEditorDocument,
  scalar,
} from './editor-snapshot.js';
import { getConfigFileLayer } from './layer.js';

const NOTIFICATION_POLICY_FIELDS = [
  'threshold',
  'once',
  'mode',
  'securitymode',
  'digestcron',
  'resolvenotifications',
] as const;

export function notificationTriggerSnapshot(
  document: Awaited<ReturnType<typeof readEditorDocument>>,
) {
  const sections = matchingKeys(document?.doc.contents, 'notification');
  const section = sections.length === 1 ? sections[0] : undefined;
  const triggers = Object.entries(getState().trigger)
    .filter(([, trigger]) => getTriggerCategoryForType(trigger.type) === 'notification')
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
        NOTIFICATION_POLICY_FIELDS.map((field) => {
          const keys = matchingKeys(node, field);
          const exactPath = prefix ? [...prefix, keys[0] ?? field] : undefined;
          const rawNode = exactPath ? document?.doc.getIn(exactPath, true) : undefined;
          const envKey = `DD_NOTIFICATION_${trigger.type.toUpperCase()}_${trigger.name.toUpperCase()}_${field.toUpperCase()}`;
          const reference =
            isAlias(rawNode) ||
            isMap(rawNode) ||
            (isScalar(rawNode) &&
              typeof rawNode.value === 'string' &&
              /^\$\{/.test(rawNode.value)) ||
            process.env[`${envKey}__FILE`] !== undefined ||
            getConfigFileLayer()[`${envKey}__FILE`] !== undefined;
          const environmentOwned =
            configFileSources[envKey] === 'env' || process.env[envKey] !== undefined;
          const readOnlyReason = !document
            ? 'configuration-file-unavailable'
            : trigger.agent
              ? 'agent-trigger'
              : !isMap(node)
                ? 'trigger-not-in-file'
                : keys.length > 1
                  ? 'ambiguous-field-alias'
                  : reference
                    ? 'referenced-field'
                    : environmentOwned
                      ? 'environment-owned'
                      : trigger.type === 'mqtt' && field === 'mode'
                        ? 'provider-forced'
                        : undefined;
          const descriptor: ConfigurationEditFieldDescriptor = {
            present: rawNode !== undefined,
            source: reference
              ? 'reference'
              : environmentOwned
                ? 'env'
                : rawNode !== undefined
                  ? 'file'
                  : 'default',
          };
          if (readOnlyReason) descriptor.readOnlyReason = readOnlyReason;
          else descriptor.path = exactPath;
          if (!reference && !trigger.agent && keys.length < 2) {
            if (isScalar(rawNode) && scalar(rawNode.value)) descriptor.value = rawNode.value;
            const effective = (trigger.configuration as Record<string, unknown>)[field];
            if (scalar(effective)) descriptor.effectiveValue = effective;
          }
          return [field, descriptor] as const;
        }),
      );
      return {
        id,
        type: trigger.type,
        name: trigger.name,
        category: 'notification' as const,
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
