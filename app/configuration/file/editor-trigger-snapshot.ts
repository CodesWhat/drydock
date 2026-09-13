import { isAlias, isMap, isScalar } from 'yaml';
import { getState } from '../../registry/index.js';
import { getTriggerCategoryForType } from '../../triggers/trigger-category.js';
import { resolveActionConcurrency } from '../../updates/action-concurrency.js';
import {
  configFileInterpolatedKeys,
  configFileSources,
  getTriggerConfigurations,
} from '../index.js';
import {
  type ConfigurationEditFieldDescriptor,
  matchingKeys,
  type readEditorDocument,
  scalar,
} from './editor-snapshot.js';
import { getConfigFileInterpolatedKeys, getConfigFileLayer } from './layer.js';

const NOTIFICATION_POLICY_FIELDS = [
  'threshold',
  'once',
  'mode',
  'securitymode',
  'digestcron',
  'resolvenotifications',
] as const;

function referencedPath(document: Awaited<ReturnType<typeof readEditorDocument>>, path: string[]) {
  const envKey = `DD_${path.join('_').toUpperCase()}`;
  if (
    process.env[`${envKey}__FILE`] !== undefined ||
    getConfigFileLayer()[`${envKey}__FILE`] !== undefined ||
    getConfigFileInterpolatedKeys().has(envKey) ||
    configFileInterpolatedKeys.has(envKey)
  )
    return true;
  let node: unknown = document?.doc.contents;
  for (const segment of path) {
    if (isAlias(node)) return true;
    const keys = matchingKeys(node, segment);
    if (keys.length > 1) return true;
    node = isMap(node) && keys[0] ? node.get(keys[0], true) : undefined;
  }
  return (
    isAlias(node) ||
    isMap(node) ||
    (isScalar(node) && typeof node.value === 'string' && /^\$\{/.test(node.value))
  );
}

function inheritedOrderIsReferenced(
  document: Awaited<ReturnType<typeof readEditorDocument>>,
  name: string,
) {
  const liveProviders = [
    ...Object.values(getState().trigger).map((trigger) => trigger.type),
    ...Object.keys(getTriggerConfigurations()),
  ];
  return ['action', 'notification'].some((category) => {
    if (referencedPath(document, [category, name, 'order'])) return true;
    const sections = matchingKeys(document?.doc.contents, category);
    const section = sections[0] ? document?.doc.get(sections[0], true) : undefined;
    const providers = new Set(liveProviders);
    if (isMap(section)) {
      for (const pair of section.items) {
        if (isScalar(pair.key) && typeof pair.key.value === 'string') providers.add(pair.key.value);
      }
    }
    return [...providers].some(
      (provider) =>
        referencedPath(document, [category, provider, 'order']) ||
        referencedPath(document, [category, provider, name, 'order']),
    );
  });
}

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
          const keys = matchingKeys(node, field);
          const exactPath = prefix ? [...prefix, keys[0] ?? field] : undefined;
          const rawNode = exactPath ? document?.doc.getIn(exactPath, true) : undefined;
          const envKey = `DD_${category.toUpperCase()}_${trigger.type.toUpperCase()}_${trigger.name.toUpperCase()}_${field.toUpperCase()}`;
          const reference =
            isAlias(rawNode) ||
            isMap(rawNode) ||
            (isScalar(rawNode) &&
              typeof rawNode.value === 'string' &&
              /^\$\{/.test(rawNode.value)) ||
            process.env[`${envKey}__FILE`] !== undefined ||
            getConfigFileLayer()[`${envKey}__FILE`] !== undefined ||
            (category === 'action' &&
              referencedPath(document, [category, trigger.type, trigger.name, field]));
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
            const effective =
              category === 'action' && field === 'concurrency'
                ? trigger.configuration.concurrency === undefined &&
                  referencedPath(document, ['update', 'concurrency'])
                  ? undefined
                  : resolveActionConcurrency(trigger.configuration)
                : category === 'action' &&
                    field === 'order' &&
                    rawNode === undefined &&
                    !environmentOwned &&
                    inheritedOrderIsReferenced(document, trigger.name)
                  ? undefined
                  : (trigger.configuration as Record<string, unknown>)[field];
            if (scalar(effective)) descriptor.effectiveValue = effective;
          }
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
