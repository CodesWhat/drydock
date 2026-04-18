const now = Date.now();
const m = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

export const logEntries = [
  {
    timestamp: m(1),
    level: 'info' as const,
    component: 'api',
    message: 'GET /api/containers 200 12ms',
  },
  {
    timestamp: m(2),
    level: 'debug' as const,
    component: 'store',
    message: 'Container collection query: 15 results',
  },
  {
    timestamp: m(3),
    level: 'info' as const,
    component: 'watcher',
    message: 'Poll cycle completed for docker.local: 15 containers',
  },
  {
    timestamp: m(5),
    level: 'info' as const,
    component: 'scanner',
    message: 'Scan completed for vaultwarden/server:1.32.5 — 5 vulnerabilities found',
  },
  {
    timestamp: m(6),
    level: 'warn' as const,
    component: 'scanner',
    message: 'Critical vulnerability CVE-2024-45678 detected in vaultwarden/server:1.32.5',
  },
  {
    timestamp: m(8),
    level: 'info' as const,
    component: 'registry',
    message: 'Fetched tags for grafana/grafana from Docker Hub (42 tags)',
  },
  {
    timestamp: m(10),
    level: 'info' as const,
    component: 'registry',
    message: 'Fetched tags for prom/prometheus from Docker Hub (38 tags)',
  },
  {
    timestamp: m(11),
    level: 'debug' as const,
    component: 'registry',
    message: 'Token exchange for ghcr.io/authelia/authelia succeeded',
  },
  {
    timestamp: m(12),
    level: 'info' as const,
    component: 'registry',
    message: 'Fetched tags for ghcr.io/authelia/authelia from GHCR (25 tags)',
  },
  {
    timestamp: m(14),
    level: 'info' as const,
    component: 'trigger',
    message: 'Fired slack.homelab for grafana minor update 11.3.0 -> 11.4.0',
  },
  {
    timestamp: m(14),
    level: 'info' as const,
    component: 'trigger',
    message: 'Fired discord.updates for grafana minor update 11.3.0 -> 11.4.0',
  },
  {
    timestamp: m(15),
    level: 'info' as const,
    component: 'watcher',
    message: 'Container grafana: update available 11.3.0 -> 11.4.0 (minor)',
  },
  {
    timestamp: m(16),
    level: 'info' as const,
    component: 'watcher',
    message: 'Container authelia: update available 4.38.16 -> 4.39.0 (minor)',
  },
  {
    timestamp: m(18),
    level: 'debug' as const,
    component: 'store',
    message: 'Persisted store to /store/dd.json (24KB)',
  },
  {
    timestamp: m(20),
    level: 'info' as const,
    component: 'api',
    message:
      'SSE client connected: client ID sse-client-a1b2c3d4 from source IP 192.168.1.10 (1 total)',
  },
  {
    timestamp: m(22),
    level: 'info' as const,
    component: 'agent',
    message: 'Agent nas-agent heartbeat received (3 containers, uptime 864000s)',
  },
  {
    timestamp: m(25),
    level: 'info' as const,
    component: 'registry',
    message: 'Fetched tags for lscr.io/linuxserver/sonarr from LSCR (18 tags)',
  },
  {
    timestamp: m(28),
    level: 'warn' as const,
    component: 'scanner',
    message: 'High vulnerability CVE-2024-56789 detected in jellyfin/jellyfin:10.10.3',
  },
  {
    timestamp: m(30),
    level: 'info' as const,
    component: 'scanner',
    message: 'Scan completed for jellyfin/jellyfin:10.10.3 — 8 vulnerabilities found',
  },
  {
    timestamp: m(35),
    level: 'info' as const,
    component: 'watcher',
    message: 'Poll cycle completed for docker.local: 15 containers',
  },
  {
    timestamp: m(40),
    level: 'debug' as const,
    component: 'api',
    message: 'Session refreshed for user admin',
  },
  {
    timestamp: m(45),
    level: 'info' as const,
    component: 'registry',
    message: 'Fetched tags for traefik from Docker Hub (30 tags)',
  },
  {
    timestamp: m(50),
    level: 'info' as const,
    component: 'trigger',
    message: 'Fired slack.homelab for jellyfin patch update 10.10.3 -> 10.10.6',
  },
  {
    timestamp: m(55),
    level: 'info' as const,
    component: 'watcher',
    message: 'Container jellyfin: update available 10.10.3 -> 10.10.6 (patch)',
  },
  {
    timestamp: m(60),
    level: 'info' as const,
    component: 'api',
    message: 'Server started on port 3000',
  },
];
