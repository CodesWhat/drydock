/**
 * Auto-resolve Docker image names to Dashboard Icons (homarr-labs) slugs.
 *
 * When a container has no custom displayIcon (i.e. still the default "mdi:docker"),
 * we extract the base software name from the image and map it to a Dashboard Icons
 * slug so that containers get branded icons out of the box.
 *
 * The CDN URL is: https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/{slug}.png
 * If the icon doesn't exist (404), IconRenderer's onerror fallback handles it.
 */

/**
 * Check if a displayIcon value is a legacy MDI icon that should be auto-resolved.
 * After the FA6 migration, mdi:* icons don't render. Treat them all as auto-resolvable.
 */
function isLegacyOrDefaultIcon(displayIcon: string): boolean {
  if (!displayIcon) return true;
  return displayIcon.startsWith('mdi:') || displayIcon.startsWith('mdi-');
}

/**
 * Curated map: Docker image base name -> Dashboard Icons slug.
 * Only needed when the image name differs from the icon slug.
 */
const IMAGE_TO_ICON: Record<string, string> = {
  // Databases
  postgres: 'postgresql',
  mongo: 'mongodb',
  mysql: 'mysql',
  mariadb: 'mariadb',
  redis: 'redis',
  memcached: 'memcached',
  couchdb: 'couchdb',
  cassandra: 'apache-cassandra',
  influxdb: 'influxdb',
  clickhouse: 'clickhouse',
  cockroachdb: 'cockroachdb',
  neo4j: 'neo4j',
  mssql: 'microsoft-sql-server',
  timescaledb: 'timescaledb',

  // Web servers & proxies
  nginx: 'nginx',
  httpd: 'apache',
  apache: 'apache',
  traefik: 'traefik',
  caddy: 'caddy',
  haproxy: 'haproxy',
  envoy: 'envoyproxy',
  squid: 'squid',

  // Container & orchestration
  portainer: 'portainer',
  'portainer-ce': 'portainer',
  watchtower: 'watchtower',
  dockge: 'dockge',
  yacht: 'yacht',

  // Programming languages & runtimes
  node: 'node-js',
  python: 'python',
  ruby: 'ruby',
  golang: 'go',
  go: 'go',
  rust: 'rust',
  php: 'php',
  openjdk: 'java',
  eclipse_temurin: 'java',
  'eclipse-temurin': 'java',
  amazoncorretto: 'java',
  dotnet: 'microsoft-dotnet',
  elixir: 'elixir',
  perl: 'perl',
  swift: 'swift',

  // OS & base images
  alpine: 'alpine-linux',
  ubuntu: 'ubuntu',
  debian: 'debian',
  centos: 'centos',
  fedora: 'fedora',
  archlinux: 'arch-linux',
  'alma-linux': 'alma-linux',
  almalinux: 'alma-linux',
  rockylinux: 'rocky-linux',
  busybox: 'linux',
  clearlinux: 'linux',

  // Message queues & streaming
  rabbitmq: 'rabbitmq',
  nats: 'nats',
  kafka: 'apache-kafka',
  mosquitto: 'mosquitto',
  emqx: 'emqx',
  activemq: 'apache-activemq',

  // Monitoring & observability
  grafana: 'grafana',
  prometheus: 'prometheus',
  loki: 'loki',
  jaeger: 'jaeger',
  zipkin: 'zipkin',
  alertmanager: 'alertmanager',
  zabbix: 'zabbix',
  uptime_kuma: 'uptime-kuma',
  'uptime-kuma': 'uptime-kuma',
  netdata: 'netdata',

  // Home automation & media
  homeassistant: 'home-assistant',
  'home-assistant': 'home-assistant',
  jellyfin: 'jellyfin',
  plex: 'plex',
  emby: 'emby',
  sonarr: 'sonarr',
  radarr: 'radarr',
  lidarr: 'lidarr',
  prowlarr: 'prowlarr',
  bazarr: 'bazarr',
  overseerr: 'overseerr',
  tautulli: 'tautulli',
  ombi: 'ombi',
  jackett: 'jackett',

  // Cloud storage & file sharing
  nextcloud: 'nextcloud',
  owncloud: 'owncloud',
  syncthing: 'syncthing',
  minio: 'minio',
  seafile: 'seafile',
  filebrowser: 'filebrowser',

  // CI/CD & dev tools
  gitea: 'gitea',
  gitlab: 'gitlab',
  'gitlab-ce': 'gitlab',
  'gitlab-ee': 'gitlab',
  jenkins: 'jenkins',
  drone: 'drone',
  woodpecker: 'woodpecker-ci',
  'n8n': 'n8n',
  registry: 'docker',
  sonarqube: 'sonarqube',
  harbor: 'harbor',
  verdaccio: 'verdaccio',

  // Auth & identity
  keycloak: 'keycloak',
  authelia: 'authelia',
  authentik: 'authentik',
  vault: 'hashicorp-vault',

  // DNS & networking
  pihole: 'pi-hole',
  'pi-hole': 'pi-hole',
  adguardhome: 'adguard-home',
  'adguard-home': 'adguard-home',
  unbound: 'unbound',
  wireguard: 'wireguard',
  tailscale: 'tailscale',
  cloudflared: 'cloudflare',

  // Wiki & docs
  bookstack: 'bookstack',
  wikijs: 'wikijs',
  'wiki-js': 'wikijs',
  outline: 'outline',
  dokuwiki: 'dokuwiki',

  // Drydock itself
  drydock: '__drydock__',

  // Misc popular images
  wordpress: 'wordpress',
  ghost: 'ghost',
  mastodon: 'mastodon',
  vaultwarden: 'vaultwarden',
  bitwarden: 'bitwarden',
  elasticsearch: 'elasticsearch',
  kibana: 'kibana',
  logstash: 'logstash',
  'actual-server': 'actual-budget',
  freshrss: 'freshrss',
  paperless: 'paperless-ngx',
  'paperless-ngx': 'paperless-ngx',
  immich: 'immich',
  photoprism: 'photoprism',
  duplicati: 'duplicati',
  restic: 'restic',
  code_server: 'visual-studio-code',
  'code-server': 'visual-studio-code',
  homepage: 'homepage',
  homarr: 'homarr',
  dashy: 'dashy',
};

/**
 * Well-known namespace prefixes whose org name should be stripped
 * to get the base software name.
 */
const STRIP_NAMESPACES = [
  'library',
  'linuxserver',
  'lscr.io/linuxserver',
  'bitnami',
  'lsiobase',
  'hotio',
  'ghcr.io',
];

/**
 * Extract the base software name from a Docker image name.
 *
 * Examples:
 *   "nginx"                        -> "nginx"
 *   "library/nginx"                -> "nginx"
 *   "linuxserver/nginx"            -> "nginx"
 *   "bitnami/postgresql"           -> "postgresql"
 *   "ghcr.io/linuxserver/nginx"    -> "nginx"
 */
function extractBaseName(imageName: string): string {
  let name = imageName.toLowerCase().trim();

  // Remove tag if present
  const colonIdx = name.indexOf(':');
  if (colonIdx !== -1) {
    name = name.substring(0, colonIdx);
  }

  // Remove digest if present
  const atIdx = name.indexOf('@');
  if (atIdx !== -1) {
    name = name.substring(0, atIdx);
  }

  // Strip known namespace prefixes
  for (const ns of STRIP_NAMESPACES) {
    const prefix = `${ns}/`;
    if (name.startsWith(prefix)) {
      name = name.substring(prefix.length);
    }
  }

  // Take only the last path segment (handles "org/repo" -> "repo")
  const lastSlash = name.lastIndexOf('/');
  if (lastSlash !== -1) {
    name = name.substring(lastSlash + 1);
  }

  return name;
}

/**
 * Resolve a Dashboard Icons slug from an image name.
 * Returns the slug if a match is found, or null if no confident match.
 */
function resolveIconSlug(imageName: string): string | null {
  const baseName = extractBaseName(imageName);

  // Direct map lookup
  if (IMAGE_TO_ICON[baseName]) {
    return IMAGE_TO_ICON[baseName];
  }

  // Try the base name directly as a slug (many match 1:1)
  // The CDN onerror will handle misses
  if (baseName && baseName.length > 1) {
    return baseName;
  }

  return null;
}

/** Drydock's own logo, served from /drydock-logo.png in the static build. */
const DRYDOCK_LOGO_URL = '/drydock-logo.png';

/**
 * Get the effective display icon for a container.
 *
 * If the user set a custom icon via Docker label (hl-, sh-, si-, fa*, or URL), use that.
 * If the icon is a legacy MDI icon (mdi:* / mdi-*), auto-resolve from the image name.
 *
 * @param displayIcon - The container's displayIcon field (from Docker label or default)
 * @param imageName   - The container's image.name field
 * @returns The icon string to pass to IconRenderer
 */
export function getEffectiveDisplayIcon(displayIcon: string, imageName: string): string {
  // User set a modern icon (hl-, sh-, si-, fa*, or URL) — respect it
  if (!isLegacyOrDefaultIcon(displayIcon)) {
    return displayIcon;
  }

  // Auto-resolve from image name
  const slug = resolveIconSlug(imageName);
  if (slug === '__drydock__') {
    return DRYDOCK_LOGO_URL;
  }
  if (slug) {
    return `hl-${slug}`;
  }

  // Final fallback: Docker brand icon
  return 'fab fa-docker';
}
