function getTriggerIcon() {
  return 'fas fa-bolt';
}

function getTriggerProviderIcon(type) {
  switch (type) {
    case 'http':
      return 'fas fa-globe';
    case 'smtp':
      return 'fas fa-envelope';
    case 'slack':
      return 'fab fa-slack';
    case 'discord':
      return 'fab fa-discord';
    case 'telegram':
      return 'fab fa-telegram';
    case 'mqtt':
      return 'fas fa-tower-broadcast';
    case 'kafka':
      return 'fas fa-bars-staggered';
    case 'pushover':
      return 'fas fa-bell';
    case 'gotify':
      return 'fas fa-bell';
    case 'ntfy':
      return 'fas fa-bell';
    case 'ifttt':
      return 'fas fa-wand-magic-sparkles';
    case 'apprise':
      return 'fas fa-paper-plane';
    case 'command':
      return 'fas fa-terminal';
    case 'dockercompose':
      return 'fab fa-docker';
    case 'rocketchat':
      return 'fas fa-comment';
    case 'docker':
      return 'fab fa-docker';
    default:
      return 'fas fa-bolt';
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
