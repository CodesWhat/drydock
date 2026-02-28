/**
 * Get registry component icon.
 * @returns {string}
 */
function getRegistryIcon() {
  return 'sh-docker';
}

/**
 * Get registry provider icon (acr, ecr...).
 * @param provider
 * @returns {string}
 */
const REGISTRY_PROVIDER_ICONS = {
  acr: 'sh-microsoft',
  alicr: 'sh-alibaba-cloud',
  artifactory: 'sh-jfrog-artifactory',
  custom: 'sh-docker',
  ecr: 'sh-amazon-web-services',
  forgejo: 'sh-forgejo',
  gar: 'sh-google',
  gcr: 'sh-google',
  ghcr: 'sh-github',
  gitea: 'sh-gitea',
  gitlab: 'sh-gitlab',
  harbor: 'sh-harbor',
  hub: 'sh-docker',
  ibmcr: 'sh-ibm',
  nexus: 'sh-sonatype-nexus-repository',
  ocir: 'sh-oracle-cloud',
  quay: 'sh-quay',
  lscr: 'sh-linux',
  codeberg: 'sh-codeberg',
  dhi: 'sh-docker',
  docr: 'sh-digitalocean',
};

function getRegistryProviderIcon(provider) {
  const providerName = `${provider || ''}`.split('.')[0];
  return REGISTRY_PROVIDER_ICONS[providerName] || 'sh-docker';
}

/**
 * Get registry provider brand color.
 * @param provider
 * @returns {string}
 */
const REGISTRY_PROVIDER_COLORS = {
  acr: '#0078D4',
  alicr: '#FF6A00',
  artifactory: '#41BF47',
  ecr: '#FF9900',
  forgejo: '#FB923C',
  gar: '#4285F4',
  gcr: '#4285F4',
  ghcr: '#8B5CF6',
  gitea: '#609926',
  gitlab: '#FC6D26',
  harbor: '#60B932',
  hub: '#2496ED',
  ibmcr: '#0F62FE',
  nexus: '#1B1C30',
  ocir: '#F80000',
  quay: '#EE0000',
  lscr: '#DA3B8A',
  codeberg: '#2185D0',
  dhi: '#2496ED',
  docr: '#0080FF',
  custom: '#6B7280',
  trueforge: '#6B7280',
};

function getRegistryProviderColor(provider) {
  return REGISTRY_PROVIDER_COLORS[provider.split('.')[0]] || '#6B7280';
}

/**
 * get all registries.
 * @returns {Promise<unknown>}
 */
async function getAllRegistries() {
  const response = await fetch('/api/registries', { credentials: 'include' });
  return response.json();
}

function buildRegistryDetailPath({ type, name, agent }) {
  const segments = ['/api/registries'];
  if (agent) {
    segments.push(encodeURIComponent(agent));
  }
  segments.push(encodeURIComponent(type), encodeURIComponent(name));
  return segments.join('/');
}

async function getRegistry({ type, name, agent }) {
  const response = await fetch(buildRegistryDetailPath({ type, name, agent }), {
    credentials: 'include',
  });
  return response.json();
}

export {
  getRegistryIcon,
  getRegistryProviderIcon,
  getRegistryProviderColor,
  getAllRegistries,
  getRegistry,
};
