export const HASS_INSTALL_PAYLOAD = 'install';
const HASS_COMMAND_TOPIC_SUFFIX = '/cmd';
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

// Opt-in per-container buttons (`hass.buttons`). Their command topics hang off
// the container state topic as `<state>/cmd/<action>` so they can never match
// the install `<state>/cmd` filters above, and each button publishes the
// outcome of the last press to `<state>/cmd/<action>/result`.
export type HassButtonAction = 'check' | 'update';
export const HASS_BUTTON_ACTIONS: readonly HassButtonAction[] = ['check', 'update'];
export const HASS_BUTTON_PRESS_PAYLOAD = 'PRESS';
const HASS_BUTTON_COMMAND_SEGMENT = '/cmd/';

export function getHassButtonCommandTopicFilters(baseTopic: string): string[] {
  return [`${baseTopic}/+/+/cmd/+`, `${baseTopic}/agent/+/+/+/cmd/+`];
}

export function getHassButtonCommandTopic(stateTopic: string, action: HassButtonAction): string {
  return `${stateTopic}${HASS_BUTTON_COMMAND_SEGMENT}${action}`;
}

export function getHassButtonResultTopic(stateTopic: string, action: HassButtonAction): string {
  return `${getHassButtonCommandTopic(stateTopic, action)}/result`;
}

export function isHassButtonPressPayload(payload: Buffer | string): boolean {
  return payload.toString('utf8').trim() === HASS_BUTTON_PRESS_PAYLOAD;
}

export function parseHassButtonCommandTopic(
  topic: string,
  baseTopic: string,
): { stateTopic: string; action: HassButtonAction } | undefined {
  if (!topic.startsWith(`${baseTopic}/`)) {
    return undefined;
  }
  for (const action of HASS_BUTTON_ACTIONS) {
    const suffix = `${HASS_BUTTON_COMMAND_SEGMENT}${action}`;
    if (topic.endsWith(suffix) && topic.length > baseTopic.length + 1 + suffix.length) {
      return { stateTopic: topic.slice(0, -suffix.length), action };
    }
  }
  return undefined;
}

// HA caps `release_summary` at 255 characters (Python str length, so count
// code points rather than UTF-16 units to avoid splitting a surrogate pair).
const HASS_RELEASE_SUMMARY_MAX_LENGTH = 255;

export function buildHassReleaseSummary(
  releaseNotes: { title?: unknown; body?: unknown } | undefined,
): string | undefined {
  const parts = [releaseNotes?.title, releaseNotes?.body]
    .filter((part): part is string => typeof part === 'string')
    .map((part) => part.replaceAll(/\s+/g, ' ').trim())
    .filter((part) => part !== '');
  if (parts.length === 0) {
    return undefined;
  }
  const characters = Array.from(parts.join(': '));
  if (characters.length <= HASS_RELEASE_SUMMARY_MAX_LENGTH) {
    return characters.join('');
  }
  return `${characters.slice(0, HASS_RELEASE_SUMMARY_MAX_LENGTH - 1).join('')}…`;
}
