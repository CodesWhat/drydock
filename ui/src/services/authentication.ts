function getAuthenticationIcon() {
  return 'sh-lock';
}

function getAuthProviderIcon(type) {
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

function getAuthProviderColor(type) {
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
  return response.json();
}

export { getAuthenticationIcon, getAuthProviderIcon, getAuthProviderColor, getAllAuthentications };
