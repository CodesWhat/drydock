import { isMap, isScalar } from 'yaml';
import { getState } from '../../registry/index.js';
import type Trigger from '../../triggers/providers/Trigger.js';
import { resolveActionConcurrency } from '../../updates/action-concurrency.js';
import { configFileSources, getTriggerConfigurations } from '../index.js';
import {
  type ConfigurationEditFieldDescriptor,
  matchingKeys,
  type readEditorDocument,
  referencedPath,
  scalar,
} from './editor-snapshot.js';

interface TriggerFieldContext {
  document: Awaited<ReturnType<typeof readEditorDocument>>;
  category: 'action' | 'notification';
  trigger: Pick<Trigger, 'type' | 'name' | 'agent' | 'configuration'>;
  field: string;
  node: unknown;
  prefix: string[] | undefined;
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

function fieldReadOnlyReason(
  { document, trigger, node, field }: TriggerFieldContext,
  ownership: {
    keyCount: number;
    reference: boolean;
    environmentOwned: boolean;
    digestTemplate: boolean;
  },
) {
  if (!document) return 'configuration-file-unavailable';
  if (trigger.agent) return 'agent-trigger';
  if (!isMap(node)) return 'trigger-not-in-file';
  if (ownership.keyCount > 1) return 'ambiguous-field-alias';
  if (ownership.reference) return 'referenced-field';
  if (ownership.environmentOwned) return 'environment-owned';
  if (trigger.type === 'mqtt') {
    if (ownership.digestTemplate) return 'provider-unsupported';
    if (field === 'mode') return 'provider-forced';
  }
  return undefined;
}

function effectiveFieldValue(
  { document, category, trigger, field }: TriggerFieldContext,
  rawNode: unknown,
  environmentOwned: boolean,
) {
  if (category === 'action' && field === 'concurrency') {
    if (
      trigger.configuration.concurrency === undefined &&
      referencedPath(document, ['update', 'concurrency'])
    )
      return undefined;
    return resolveActionConcurrency(trigger.configuration);
  }
  if (
    category === 'action' &&
    field === 'order' &&
    rawNode === undefined &&
    !environmentOwned &&
    inheritedOrderIsReferenced(document, trigger.name)
  )
    return undefined;
  return (trigger.configuration as Record<string, unknown>)[field];
}

export function triggerFieldDescriptor(
  context: TriggerFieldContext,
): ConfigurationEditFieldDescriptor {
  const { document, category, trigger, field, node, prefix } = context;
  const digestTemplate = field === 'securitydigesttitle' || field === 'securitydigestbody';
  const keys = matchingKeys(node, field);
  const exactPath = prefix ? [...prefix, keys[0] ?? field] : undefined;
  const rawNode = exactPath ? document?.doc.getIn(exactPath, true) : undefined;
  const envKey = `DD_${category.toUpperCase()}_${trigger.type.toUpperCase()}_${trigger.name.toUpperCase()}_${field.toUpperCase()}`;
  // A literal environment setting wins over file references at merge time.
  const reference =
    process.env[envKey] === undefined &&
    referencedPath(document, [category, trigger.type, trigger.name, field], digestTemplate);
  const environmentOwned = configFileSources[envKey] === 'env' || process.env[envKey] !== undefined;
  const readOnlyReason = fieldReadOnlyReason(context, {
    keyCount: keys.length,
    reference,
    environmentOwned,
    digestTemplate,
  });
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
    const effective = effectiveFieldValue(context, rawNode, environmentOwned);
    if (scalar(effective)) descriptor.effectiveValue = effective;
  }
  return descriptor;
}
