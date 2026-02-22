function getTriggerIcon() {
  return 'sh-bolt';
}

function getTriggerProviderIcon(type) {
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

function getTriggerProviderColor(type) {
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

async function getAllTriggers() {
  const response = await fetch('/api/triggers', { credentials: 'include' });
  return response.json();
}

async function runTrigger({ triggerType, triggerName, container }) {
  const response = await fetch(`/api/triggers/${triggerType}/${triggerName}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(container),
  });
  const json = await response.json();
  if (response.status !== 200) {
    throw new Error(json.error ? json.error : 'Unknown error');
  }
  return json;
}

export {
  getTriggerIcon,
  getTriggerProviderIcon,
  getTriggerProviderColor,
  getAllTriggers,
  runTrigger,
};
