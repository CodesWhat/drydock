/**
 * Get registry component icon.
 * @returns {string}
 */
function getRegistryIcon() {
  return 'fas fa-database';
}

/**
 * Get registry provider icon (acr, ecr...).
 * @param provider
 * @returns {string}
 */
const REGISTRY_PROVIDER_ICONS = {
  acr: 'fab fa-microsoft',
  custom: 'fas fa-cubes',
  ecr: 'fab fa-aws',
  forgejo: 'fas fa-code-branch',
  gcr: 'fab fa-google',
  ghcr: 'fab fa-github',
  gitea: 'fas fa-code-branch',
  gitlab: 'fab fa-gitlab',
  hub: 'fab fa-docker',
  quay: 'fab fa-redhat',
  lscr: 'fab fa-linux',
  codeberg: 'fas fa-mountain',
  dhi: 'fab fa-docker',
  docr: 'fab fa-digital-ocean',
};

function getRegistryProviderIcon(provider) {
  const providerName = `${provider || ''}`.split('.')[0];
  return REGISTRY_PROVIDER_ICONS[providerName] || 'fas fa-cube';
}

/**
 * Get registry provider brand color.
 * @param provider
 * @returns {string}
 */
function getRegistryProviderColor(provider) {
  switch (provider.split('.')[0]) {
    case 'acr':
      return '#0078D4';
    case 'ecr':
      return '#FF9900';
    case 'forgejo':
      return '#FB923C';
    case 'gcr':
      return '#4285F4';
    case 'ghcr':
      return '#8B5CF6';
    case 'gitea':
      return '#609926';
    case 'gitlab':
      return '#FC6D26';
    case 'hub':
      return '#2496ED';
    case 'quay':
      return '#EE0000';
    case 'lscr':
      return '#DA3B8A';
    case 'codeberg':
      return '#2185D0';
    case 'dhi':
      return '#2496ED';
    case 'docr':
      return '#0080FF';
    case 'custom':
      return '#6B7280';
    case 'trueforge':
      return '#6B7280';
    default:
      return '#6B7280';
  }
}

/**
 * get all registries.
 * @returns {Promise<any>}
 */
async function getAllRegistries() {
  const response = await fetch('/api/registries', { credentials: 'include' });
  return response.json();
}

export { getRegistryIcon, getRegistryProviderIcon, getRegistryProviderColor, getAllRegistries };
