import { extractCollectionData, readJsonResponse } from '../utils/api';

interface TriggerDetailPathOptions {
  type: string;
  name: string;
  agent?: string;
}

interface RunTriggerRequest {
  triggerType: string;
  triggerName: string;
  container: unknown;
  triggerAgent?: string;
}

function getTriggerProviderIcon(type: string) {
  switch (type) {
    case 'http':
      return 'sh-globe';
    case 'smtp':
      return 'sh-envelope';
    case 'slack':
      return 'sh-slack';
    case 'discord':
      return 'sh-discord';
    case 'telegram':
      return 'sh-telegram';
    case 'mqtt':
      return 'sh-mqtt';
    case 'kafka':
      return 'sh-apache-kafka';
    case 'pushover':
      return 'sh-pushover';
    case 'gotify':
      return 'sh-gotify';
    case 'ntfy':
      return 'sh-ntfy';
    case 'ifttt':
      return 'sh-ifttt';
    case 'apprise':
      return 'sh-apprise';
    case 'command':
      return 'sh-terminal';
    case 'dockercompose':
      return 'sh-docker';
    case 'rocketchat':
      return 'sh-rocket-chat';
    case 'mattermost':
      return 'sh-mattermost';
    case 'teams':
      return 'sh-microsoft-teams';
    case 'matrix':
      return 'sh-matrix';
    case 'googlechat':
      return 'sh-google-chat';
    case 'docker':
      return 'sh-docker';
    default:
      return 'sh-bolt';
  }
}

function getTriggerProviderColor(type: string) {
  switch (type) {
    case 'slack':
      return '#4A154B';
    case 'discord':
      return '#5865F2';
    case 'telegram':
      return '#26A5E4';
    case 'smtp':
      return '#EA4335';
    case 'mqtt':
      return '#660066';
    case 'kafka':
      return '#231F20';
    case 'http':
      return '#0096C7';
    case 'pushover':
      return '#249DF1';
    case 'gotify':
      return '#00BCD4';
    case 'ntfy':
      return '#57A143';
    case 'ifttt':
      return '#33CCFF';
    case 'apprise':
      return '#3B82F6';
    case 'command':
      return '#10B981';
    case 'docker':
    case 'dockercompose':
      return '#2496ED';
    case 'rocketchat':
      return '#F5455C';
    case 'mattermost':
      return '#0058CC';
    case 'teams':
      return '#6264A7';
    case 'matrix':
      return '#0DBD8B';
    case 'googlechat':
      return '#34A853';
    default:
      return '#6B7280';
  }
}

const ACTION_TRIGGER_TYPES = new Set(['docker', 'dockercompose', 'command']);
const ACTIONS_PATH = '/api/v1/actions';
const NOTIFICATION_TRIGGERS_PATH = '/api/v1/notification-triggers';

function getTriggerCollectionPath(type: string) {
  return ACTION_TRIGGER_TYPES.has(type.toLowerCase()) ? ACTIONS_PATH : NOTIFICATION_TRIGGERS_PATH;
}

async function fetchTriggerCollection(path: string) {
  const response = await fetch(path, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to get triggers: ${response.statusText}`);
  }
  const payload = await readJsonResponse(response);
  return extractCollectionData<{ type: string; name: string }>(payload);
}

async function getAllTriggers() {
  const [actions, notificationTriggers] = await Promise.all([
    fetchTriggerCollection(ACTIONS_PATH),
    fetchTriggerCollection(NOTIFICATION_TRIGGERS_PATH),
  ]);
  return [...actions, ...notificationTriggers].sort(
    (a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name),
  );
}

function buildTriggerDetailPath({ type, name, agent }: TriggerDetailPathOptions) {
  const segments = [getTriggerCollectionPath(type)];
  segments.push(encodeURIComponent(type), encodeURIComponent(name));
  if (agent) {
    segments.push(encodeURIComponent(agent));
  }
  return segments.join('/');
}

async function getTrigger({ type, name, agent }: TriggerDetailPathOptions) {
  const response = await fetch(buildTriggerDetailPath({ type, name, agent }), {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to get trigger: ${response.statusText}`);
  }
  return readJsonResponse(response);
}

async function runTrigger({
  triggerType,
  triggerName,
  container,
  triggerAgent,
}: RunTriggerRequest) {
  const path = buildTriggerDetailPath({
    type: triggerType,
    name: triggerName,
    agent: triggerAgent,
  });
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(container),
  });
  const json = await readJsonResponse<{ error?: string } & Record<string, unknown>>(response);
  if (response.status !== 200) {
    throw new Error(json.error ? json.error : 'Unknown error');
  }
  return json;
}

export { getAllTriggers, getTrigger, getTriggerProviderColor, getTriggerProviderIcon, runTrigger };
