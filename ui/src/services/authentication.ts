function getAuthenticationIcon() {
  return 'sh-lock';
}

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
  return response.json();
}

function buildAuthenticationDetailPath({ type, name, agent }: AuthenticationDetailPathOptions) {
  const segments = ['/api/authentications'];
  if (agent) {
    segments.push(encodeURIComponent(agent));
  }
  segments.push(encodeURIComponent(type), encodeURIComponent(name));
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

export {
  getAuthenticationIcon,
  getAuthProviderIcon,
  getAuthProviderColor,
  getAllAuthentications,
  getAuthentication,
};
