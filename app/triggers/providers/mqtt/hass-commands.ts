export const HASS_INSTALL_PAYLOAD = 'install';
export const HASS_COMMAND_TOPIC_SUFFIX = '/cmd';
export const HASS_COMMAND_QOS = 1;

export function getHassCommandTopicFilters(baseTopic: string): string[] {
  return [`${baseTopic}/+/+/cmd`, `${baseTopic}/agent/+/+/+/cmd`];
}

export function getHassCommandTopicFromStateTopic(stateTopic: string): string {
  return `${stateTopic}${HASS_COMMAND_TOPIC_SUFFIX}`;
}

export function isHassInstallPayload(payload: Buffer | string): boolean {
  return payload.toString('utf8').trim() === HASS_INSTALL_PAYLOAD;
}

// Defensive only — the broker should never deliver anything outside our two
// subscribed filters, but this keeps the handler safe if that guarantee ever
// weakens (e.g. a future unrelated subscription on the same client).
export function getStateTopicFromCommandTopic(
  topic: string,
  baseTopic: string,
): string | undefined {
  if (!topic.startsWith(`${baseTopic}/`) || !topic.endsWith(HASS_COMMAND_TOPIC_SUFFIX)) {
    return undefined;
  }
  return topic.slice(0, -HASS_COMMAND_TOPIC_SUFFIX.length);
}

export type HassCommandResolution<C> =
  | { status: 'not-found' }
  | { status: 'ambiguous'; containers: C[] }
  | { status: 'found'; container: C };

export function resolveHassCommandContainer<C>(
  containers: C[],
  stateTopic: string,
  getStateTopicForContainer: (container: C) => string,
): HassCommandResolution<C> {
  const matches = containers.filter((c) => getStateTopicForContainer(c) === stateTopic);
  if (matches.length === 0) return { status: 'not-found' };
  if (matches.length > 1) return { status: 'ambiguous', containers: matches };
  return { status: 'found', container: matches[0] };
}
