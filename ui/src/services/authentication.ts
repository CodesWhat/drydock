import { extractCollectionData } from '../utils/api';

interface AuthenticationDetailPathOptions {
  type: string;
  name: string;
  agent?: string;
}

function getAuthProviderIcon(type: string) {
  switch (type) {
    case 'basic':
      return 'sh-key';
    case 'oidc':
      return 'sh-openid';
    case 'anonymous':
      return 'sh-user-secret';
    default:
      return 'sh-lock';
  }
}

function getAuthProviderColor(type: string) {
  switch (type) {
    case 'basic':
      return '#F59E0B';
    case 'oidc':
      return '#F97316';
    case 'anonymous':
      return '#6B7280';
    default:
      return '#6B7280';
  }
}

async function getAllAuthentications() {
  const response = await fetch('/api/authentications', { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`Failed to get authentications: ${response.statusText}`);
  }
  const payload = await response.json();
  return extractCollectionData(payload);
}

function buildAuthenticationDetailPath({ type, name, agent }: AuthenticationDetailPathOptions) {
  const segments = ['/api/authentications'];
  segments.push(encodeURIComponent(type), encodeURIComponent(name));
  if (agent) {
    segments.push(encodeURIComponent(agent));
  }
  return segments.join('/');
}

async function getAuthentication({ type, name, agent }: AuthenticationDetailPathOptions) {
  const response = await fetch(buildAuthenticationDetailPath({ type, name, agent }), {
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(`Failed to get authentication: ${response.statusText}`);
  }
  return response.json();
}

export { getAllAuthentications, getAuthentication, getAuthProviderColor, getAuthProviderIcon };
