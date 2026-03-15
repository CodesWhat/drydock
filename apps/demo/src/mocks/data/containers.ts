import { daysToMs } from '../../utils/time';

/**
 * Mock container data in the **API format** expected by mapApiContainer().
 *
 * API shape:
 *   id, name, displayName, displayIcon, status, watcher,
 *   image: { name, variant, registry: { name, url }, tag: { value, semver } },
 *   result?: { tag, link, noUpdateReason },
 *   updateAvailable, updateKind?: { kind, semverDiff },
 *   security?: { scan?: { status, summary }, updateScan?: { status, summary } },
 *   labels?: Record<string, string>,
 *   updateDetectedAt, details?: { ports, volumes, env }
 */

/** Return an ISO-8601 timestamp `daysAgo` days before now. */
function daysAgo(days: number): string {
  return new Date(Date.now() - daysToMs(days)).toISOString();
}

function c(opts: {
  id: string;
  name: string;
  displayName: string;
  displayIcon: string;
  image: string;
  tag: string;
  status?: string;
  registryType: string;
  registryUrl?: string;
  newTag?: string;
  semverDiff?: string;
  scanStatus?: string;
  scanSummary?: Record<string, number>;
  updateScanStatus?: string;
  updateScanSummary?: Record<string, number>;
  updateDetectedAt?: string;
  group: string;
  ports?: string[];
  volumes?: string[];
  env?: { key: string; value: string; sensitive?: boolean }[];
}) {
  const hasUpdate = !!opts.newTag;
  return {
    id: opts.id,
    name: opts.name,
    displayName: opts.displayName,
    displayIcon: opts.displayIcon,
    status: opts.status ?? 'running',
    watcher: 'local',
    image: {
      name: opts.image,
      registry: { name: opts.registryType, url: opts.registryUrl ?? '' },
      tag: { value: opts.tag, semver: true },
    },
    updateAvailable: hasUpdate,
    ...(hasUpdate
      ? {
          result: { tag: opts.newTag },
          updateKind: { kind: 'tag', semverDiff: opts.semverDiff ?? 'minor' },
        }
      : {}),
    ...(opts.updateDetectedAt ? { updateDetectedAt: opts.updateDetectedAt } : {}),
    security: {
      scan: opts.scanStatus
        ? { status: opts.scanStatus, summary: opts.scanSummary ?? null }
        : undefined,
      updateScan: opts.updateScanStatus
        ? { status: opts.updateScanStatus, summary: opts.updateScanSummary ?? null }
        : undefined,
    },
    labels: {
      'dd.watch': 'true',
      'dd.group': opts.group,
      'dd.display.name': opts.displayName,
    },
    details: {
      ports: opts.ports ?? [],
      volumes: opts.volumes ?? [],
      env: opts.env ?? [],
    },
  };
}

const noKnownVulnerabilities = { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 };
const lscrMediaEnv = [
  { key: 'PUID', value: '1000' },
  { key: 'PGID', value: '1000' },
  { key: 'TZ', value: 'America/New_York' },
];

type ContainerOptions = Parameters<typeof c>[0];

function lscrMediaContainer(
  opts: Omit<
    ContainerOptions,
    'registryType' | 'registryUrl' | 'scanStatus' | 'scanSummary' | 'group' | 'env'
  > &
    Partial<Pick<ContainerOptions, 'scanStatus' | 'scanSummary' | 'group' | 'env'>>,
) {
  return c({
    ...opts,
    registryType: 'lscr',
    registryUrl: 'https://lscr.io',
    scanStatus: opts.scanStatus ?? 'scanned',
    scanSummary: opts.scanSummary ?? noKnownVulnerabilities,
    group: opts.group ?? 'media',
    env: opts.env ?? lscrMediaEnv,
  });
}

export const containers = [
  c({
    id: 'a1b2c3d4e5f6',
    name: 'grafana',
    displayName: 'Grafana',
    displayIcon: 'sh-grafana',
    image: 'grafana/grafana',
    tag: '11.3.0',
    registryType: 'hub',
    newTag: '11.4.0',
    semverDiff: 'minor',
    updateDetectedAt: daysAgo(2),
    scanStatus: 'scanned',
    scanSummary: { unknown: 0, low: 3, medium: 1, high: 0, critical: 0 },
    group: 'monitoring',
    ports: ['3000:3000/tcp'],
    volumes: ['grafana-data:/var/lib/grafana'],
    env: [
      { key: 'GF_SECURITY_ADMIN_USER', value: 'admin' },
      { key: 'GF_SECURITY_ADMIN_PASSWORD', value: '********', sensitive: true },
      { key: 'GF_SERVER_ROOT_URL', value: 'https://grafana.local' },
    ],
  }),
  c({
    id: 'b2c3d4e5f6a7',
    name: 'prometheus',
    displayName: 'Prometheus',
    displayIcon: 'sh-prometheus',
    image: 'prom/prometheus',
    tag: 'v2.54.0',
    registryType: 'hub',
    scanStatus: 'scanned',
    scanSummary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
    group: 'monitoring',
    ports: ['9090:9090/tcp'],
    volumes: [
      'prometheus-data:/prometheus',
      '/etc/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro',
    ],
  }),
  c({
    id: 'c3d4e5f6a7b8',
    name: 'loki',
    displayName: 'Loki',
    displayIcon: 'sh-loki',
    image: 'grafana/loki',
    tag: '3.2.0',
    registryType: 'hub',
    newTag: '3.3.1',
    semverDiff: 'minor',
    updateDetectedAt: daysAgo(10),
    scanStatus: 'scanned',
    scanSummary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
    group: 'monitoring',
    ports: ['3100:3100/tcp'],
    volumes: ['loki-data:/loki'],
  }),
  c({
    id: 'd4e5f6a7b8c9',
    name: 'alertmanager',
    displayName: 'Alertmanager',
    displayIcon: 'sh-prometheus',
    image: 'prom/alertmanager',
    tag: 'v0.27.0',
    registryType: 'hub',
    scanStatus: 'scanned',
    scanSummary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
    group: 'monitoring',
    ports: ['9093:9093/tcp'],
    volumes: ['alertmanager-data:/alertmanager'],
  }),
  c({
    id: 'e5f6a7b8c9d0',
    name: 'node-exporter',
    displayName: 'Node Exporter',
    displayIcon: 'sh-prometheus',
    image: 'prom/node-exporter',
    tag: 'v1.8.2',
    registryType: 'hub',
    scanStatus: 'not-scanned',
    group: 'monitoring',
    ports: ['9100:9100/tcp'],
    volumes: ['/proc:/host/proc:ro', '/sys:/host/sys:ro', '/:/rootfs:ro'],
  }),
  c({
    id: 'f6a7b8c9d0e1',
    name: 'jellyfin',
    displayName: 'Jellyfin',
    displayIcon: 'sh-jellyfin',
    image: 'jellyfin/jellyfin',
    tag: '10.10.3',
    registryType: 'hub',
    newTag: '10.10.6',
    semverDiff: 'patch',
    updateDetectedAt: daysAgo(4),
    scanStatus: 'scanned',
    scanSummary: { unknown: 0, low: 5, medium: 2, high: 1, critical: 0 },
    group: 'media',
    ports: ['8096:8096/tcp', '8920:8920/tcp'],
    volumes: [
      'jellyfin-config:/config',
      'jellyfin-cache:/cache',
      '/media/movies:/media/movies:ro',
      '/media/tv:/media/tv:ro',
    ],
    env: [{ key: 'JELLYFIN_PublishedServerUrl', value: 'https://jellyfin.local' }],
  }),
  lscrMediaContainer({
    id: 'a7b8c9d0e1f2',
    name: 'sonarr',
    displayName: 'Sonarr',
    displayIcon: 'sh-sonarr',
    image: 'linuxserver/sonarr',
    tag: '4.0.10',
    ports: ['8989:8989/tcp'],
    volumes: ['sonarr-config:/config', '/media/tv:/tv', '/media/downloads:/downloads'],
  }),
  lscrMediaContainer({
    id: 'b8c9d0e1f2a3',
    name: 'radarr',
    displayName: 'Radarr',
    displayIcon: 'sh-radarr',
    image: 'linuxserver/radarr',
    tag: '5.14.0',
    ports: ['7878:7878/tcp'],
    volumes: ['radarr-config:/config', '/media/movies:/movies', '/media/downloads:/downloads'],
  }),
  lscrMediaContainer({
    id: 'c9d0e1f2a3b4',
    name: 'prowlarr',
    displayName: 'Prowlarr',
    displayIcon: 'sh-prowlarr',
    image: 'linuxserver/prowlarr',
    tag: '1.25.0',
    newTag: '1.26.1',
    semverDiff: 'minor',
    updateDetectedAt: daysAgo(14),
    ports: ['9696:9696/tcp'],
    volumes: ['prowlarr-config:/config'],
  }),
  c({
    id: 'd0e1f2a3b4c5',
    name: 'traefik',
    displayName: 'Traefik',
    displayIcon: 'sh-traefik',
    image: 'traefik',
    tag: 'v3.2.0',
    registryType: 'hub',
    scanStatus: 'scanned',
    scanSummary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
    group: 'infra',
    ports: ['80:80/tcp', '443:443/tcp', '8080:8080/tcp'],
    volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro', 'traefik-certs:/certs'],
    env: [
      { key: 'CF_API_EMAIL', value: 'admin@example.com' },
      { key: 'CF_DNS_API_TOKEN', value: '********', sensitive: true },
    ],
  }),
  c({
    id: 'e1f2a3b4c5d6',
    name: 'authelia',
    displayName: 'Authelia',
    displayIcon: 'sh-authelia',
    image: 'authelia/authelia',
    tag: '4.38.16',
    registryType: 'ghcr',
    registryUrl: 'https://ghcr.io',
    newTag: '4.39.0',
    semverDiff: 'minor',
    updateDetectedAt: daysAgo(1),
    scanStatus: 'scanned',
    scanSummary: { unknown: 0, low: 1, medium: 0, high: 0, critical: 0 },
    updateScanStatus: 'scanned',
    updateScanSummary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
    group: 'infra',
    ports: ['9091:9091/tcp'],
    volumes: ['authelia-config:/config'],
    env: [
      { key: 'AUTHELIA_JWT_SECRET', value: '********', sensitive: true },
      { key: 'AUTHELIA_SESSION_SECRET', value: '********', sensitive: true },
    ],
  }),
  c({
    id: 'f2a3b4c5d6e7',
    name: 'vaultwarden',
    displayName: 'Vaultwarden',
    displayIcon: 'sh-vaultwarden',
    image: 'vaultwarden/server',
    tag: '1.32.5',
    registryType: 'hub',
    scanStatus: 'scanned',
    scanSummary: { unknown: 0, low: 2, medium: 1, high: 1, critical: 1 },
    group: 'infra',
    ports: ['8082:80/tcp'],
    volumes: ['vaultwarden-data:/data'],
    env: [
      { key: 'ADMIN_TOKEN', value: '********', sensitive: true },
      { key: 'DOMAIN', value: 'https://vault.local' },
      { key: 'SIGNUPS_ALLOWED', value: 'false' },
    ],
  }),
  c({
    id: 'a3b4c5d6e7f8',
    name: 'adguard',
    displayName: 'AdGuard Home',
    displayIcon: 'sh-adguard-home',
    image: 'adguardteam/adguardhome',
    tag: 'v0.107.55',
    registryType: 'hub',
    scanStatus: 'scanned',
    scanSummary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
    group: 'infra',
    ports: ['53:53/tcp', '53:53/udp', '3003:3000/tcp'],
    volumes: ['adguard-work:/opt/adguardhome/work', 'adguard-conf:/opt/adguardhome/conf'],
  }),
  c({
    id: 'b4c5d6e7f8a9',
    name: 'drydock',
    displayName: 'Drydock',
    displayIcon: 'sh-drydock',
    image: 'codeswhat/drydock',
    tag: '1.4.0',
    registryType: 'ghcr',
    registryUrl: 'https://ghcr.io',
    scanStatus: 'scanned',
    scanSummary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
    group: 'self',
    ports: ['3000:3000/tcp'],
    volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro', 'drydock-store:/store'],
    env: [
      { key: 'DD_WATCHER_LOCAL_SOCKET', value: '/var/run/docker.sock' },
      { key: 'DD_REGISTRY_HUB_PUBLIC_AUTH', value: 'anonymous' },
      { key: 'DD_REGISTRY_GHCR_PRIVATE_TOKEN', value: '********', sensitive: true },
    ],
  }),
  {
    ...c({
      id: 'c5d6e7f8a9b0',
      name: 'portainer',
      displayName: 'Portainer',
      displayIcon: 'sh-portainer',
      image: 'portainer/portainer-ce',
      tag: '2.22.0',
      status: 'stopped',
      registryType: 'hub',
      scanStatus: 'blocked',
      scanSummary: { unknown: 0, low: 0, medium: 0, high: 0, critical: 0 },
      group: 'self',
      ports: ['9443:9443/tcp'],
      volumes: ['/var/run/docker.sock:/var/run/docker.sock', 'portainer-data:/data'],
    }),
  },
];
