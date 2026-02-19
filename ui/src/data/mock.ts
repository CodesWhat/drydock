import { ref, computed } from 'vue';

// ── Container Types ─────────────────────────────────────

export interface ContainerDetails {
  ports: string[];
  volumes: string[];
  env: { key: string; value: string }[];
  labels: string[];
}

export interface Container {
  name: string;
  image: string;
  currentTag: string;
  newTag: string | null;
  status: 'running' | 'stopped';
  registry: 'dockerhub' | 'ghcr' | 'custom';
  updateKind: 'major' | 'minor' | 'patch' | 'digest' | null;
  bouncer: 'safe' | 'unsafe' | 'blocked';
  server: string;
  details: ContainerDetails;
}

export const containers = ref<Container[]>([
  // ── Local (10 containers: 8 running, 2 stopped) ──
  {
    name: 'traefik', image: 'traefik', currentTag: '2.10.7', newTag: '3.0.1', status: 'running',
    registry: 'dockerhub', updateKind: 'major', bouncer: 'blocked', server: 'Local',
    details: { ports: ['80:80', '443:443', '8080:8080'], volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro', './traefik.yml:/traefik.yml'], env: [{ key: 'TRAEFIK_LOG_LEVEL', value: 'INFO' }], labels: ['reverse-proxy', 'load-balancer', 'production'] },
  },
  {
    name: 'postgres-db', image: 'postgres', currentTag: '15.4', newTag: '16.1', status: 'running',
    registry: 'dockerhub', updateKind: 'major', bouncer: 'blocked', server: 'Local',
    details: { ports: ['5432:5432'], volumes: ['pg_data:/var/lib/postgresql/data'], env: [{ key: 'POSTGRES_DB', value: 'drydock' }, { key: 'POSTGRES_USER', value: 'admin' }], labels: ['database', 'production'] },
  },
  {
    name: 'redis-cache', image: 'redis', currentTag: '7.0.12', newTag: '7.2.4', status: 'running',
    registry: 'dockerhub', updateKind: 'minor', bouncer: 'safe', server: 'Local',
    details: { ports: ['6379:6379'], volumes: ['redis_data:/data'], env: [{ key: 'REDIS_MAXMEMORY', value: '256mb' }], labels: ['cache', 'production'] },
  },
  {
    name: 'nginx-proxy', image: 'nginx', currentTag: '1.24.0', newTag: '1.25.3', status: 'stopped',
    registry: 'dockerhub', updateKind: 'minor', bouncer: 'unsafe', server: 'Local',
    details: { ports: ['8081:80'], volumes: ['./nginx.conf:/etc/nginx/nginx.conf:ro'], env: [], labels: ['proxy', 'staging'] },
  },
  {
    name: 'grafana', image: 'grafana/grafana', currentTag: '10.1.5', newTag: '10.2.3', status: 'running',
    registry: 'dockerhub', updateKind: 'minor', bouncer: 'safe', server: 'Local',
    details: { ports: ['3000:3000'], volumes: ['grafana_data:/var/lib/grafana'], env: [{ key: 'GF_SECURITY_ADMIN_USER', value: 'admin' }], labels: ['monitoring', 'observability'] },
  },
  {
    name: 'prometheus', image: 'prom/prometheus', currentTag: '2.48.1', newTag: null, status: 'running',
    registry: 'dockerhub', updateKind: null, bouncer: 'safe', server: 'Local',
    details: { ports: ['9090:9090'], volumes: ['./prometheus.yml:/etc/prometheus/prometheus.yml', 'prom_data:/prometheus'], env: [], labels: ['monitoring', 'metrics', 'production'] },
  },
  {
    name: 'drydock-api', image: 'ghcr.io/drydock/api', currentTag: '1.3.1', newTag: '1.3.2', status: 'running',
    registry: 'ghcr', updateKind: 'patch', bouncer: 'safe', server: 'Local',
    details: { ports: ['3001:3001'], volumes: ['./config:/app/config:ro'], env: [{ key: 'NODE_ENV', value: 'production' }, { key: 'LOG_LEVEL', value: 'info' }], labels: ['api', 'drydock', 'production'] },
  },
  {
    name: 'drydock-ui', image: 'ghcr.io/drydock/ui', currentTag: '1.3.1', newTag: null, status: 'running',
    registry: 'ghcr', updateKind: null, bouncer: 'safe', server: 'Local',
    details: { ports: ['8080:80'], volumes: [], env: [{ key: 'API_URL', value: 'http://drydock-api:3001' }], labels: ['frontend', 'drydock', 'production'] },
  },
  {
    name: 'registry-mirror', image: 'registry.internal/mirror', currentTag: '2.8.3', newTag: '2.8.4', status: 'stopped',
    registry: 'custom', updateKind: 'patch', bouncer: 'unsafe', server: 'Local',
    details: { ports: ['5000:5000'], volumes: ['registry_data:/var/lib/registry'], env: [{ key: 'REGISTRY_STORAGE_DELETE_ENABLED', value: 'true' }], labels: ['registry', 'internal'] },
  },
  {
    name: 'watchtower', image: 'containrrr/watchtower', currentTag: '1.7.1', newTag: null, status: 'running',
    registry: 'dockerhub', updateKind: null, bouncer: 'safe', server: 'Local',
    details: { ports: [], volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro'], env: [{ key: 'WATCHTOWER_POLL_INTERVAL', value: '3600' }, { key: 'WATCHTOWER_CLEANUP', value: 'true' }], labels: ['automation', 'updates'] },
  },
  // ── Agent-01 (prod-east) (12 containers: all running) ──
  {
    name: 'api-gateway', image: 'kong', currentTag: '3.5.0', newTag: '3.6.1', status: 'running',
    registry: 'dockerhub', updateKind: 'minor', bouncer: 'safe', server: 'Agent-01 (prod-east)',
    details: { ports: ['8000:8000', '8443:8443', '8001:8001'], volumes: ['./kong.yml:/opt/kong/declarative/kong.yml:ro'], env: [{ key: 'KONG_DATABASE', value: 'off' }, { key: 'KONG_PROXY_LISTEN', value: '0.0.0.0:8000' }], labels: ['api-gateway', 'production'] },
  },
  {
    name: 'auth-service', image: 'ghcr.io/acme/auth-service', currentTag: '2.4.1', newTag: '2.4.2', status: 'running',
    registry: 'ghcr', updateKind: 'patch', bouncer: 'safe', server: 'Agent-01 (prod-east)',
    details: { ports: ['4000:4000'], volumes: [], env: [{ key: 'JWT_SECRET', value: '***' }, { key: 'REDIS_URL', value: 'redis://redis-prod:6379' }], labels: ['auth', 'microservice', 'production'] },
  },
  {
    name: 'user-service', image: 'ghcr.io/acme/user-service', currentTag: '3.1.0', newTag: null, status: 'running',
    registry: 'ghcr', updateKind: null, bouncer: 'safe', server: 'Agent-01 (prod-east)',
    details: { ports: ['4001:4001'], volumes: [], env: [{ key: 'DB_HOST', value: 'postgres-prod' }, { key: 'NODE_ENV', value: 'production' }], labels: ['users', 'microservice', 'production'] },
  },
  {
    name: 'order-service', image: 'ghcr.io/acme/order-service', currentTag: '1.8.3', newTag: '1.9.0', status: 'running',
    registry: 'ghcr', updateKind: 'minor', bouncer: 'safe', server: 'Agent-01 (prod-east)',
    details: { ports: ['4002:4002'], volumes: [], env: [{ key: 'STRIPE_KEY', value: '***' }, { key: 'DB_HOST', value: 'postgres-prod' }], labels: ['orders', 'microservice', 'production'] },
  },
  {
    name: 'notification-worker', image: 'ghcr.io/acme/notifications', currentTag: '1.2.0', newTag: null, status: 'running',
    registry: 'ghcr', updateKind: null, bouncer: 'safe', server: 'Agent-01 (prod-east)',
    details: { ports: [], volumes: [], env: [{ key: 'SMTP_HOST', value: 'smtp.mailgun.org' }, { key: 'QUEUE_URL', value: 'amqp://rabbitmq-prod:5672' }], labels: ['notifications', 'worker', 'production'] },
  },
  {
    name: 'rabbitmq-prod', image: 'rabbitmq', currentTag: '3.12.10', newTag: '3.13.0', status: 'running',
    registry: 'dockerhub', updateKind: 'minor', bouncer: 'unsafe', server: 'Agent-01 (prod-east)',
    details: { ports: ['5672:5672', '15672:15672'], volumes: ['rabbitmq_data:/var/lib/rabbitmq'], env: [{ key: 'RABBITMQ_DEFAULT_USER', value: 'admin' }], labels: ['messaging', 'queue', 'production'] },
  },
  {
    name: 'postgres-prod', image: 'postgres', currentTag: '16.1', newTag: null, status: 'running',
    registry: 'dockerhub', updateKind: null, bouncer: 'safe', server: 'Agent-01 (prod-east)',
    details: { ports: ['5432:5432'], volumes: ['pg_prod_data:/var/lib/postgresql/data'], env: [{ key: 'POSTGRES_DB', value: 'acme_prod' }, { key: 'POSTGRES_USER', value: 'acme' }], labels: ['database', 'production'] },
  },
  {
    name: 'redis-prod', image: 'redis', currentTag: '7.2.4', newTag: null, status: 'running',
    registry: 'dockerhub', updateKind: null, bouncer: 'safe', server: 'Agent-01 (prod-east)',
    details: { ports: ['6379:6379'], volumes: ['redis_prod_data:/data'], env: [{ key: 'REDIS_MAXMEMORY', value: '512mb' }], labels: ['cache', 'session-store', 'production'] },
  },
  {
    name: 'elasticsearch', image: 'docker.elastic.co/elasticsearch/elasticsearch', currentTag: '8.11.3', newTag: '8.12.0', status: 'running',
    registry: 'custom', updateKind: 'minor', bouncer: 'safe', server: 'Agent-01 (prod-east)',
    details: { ports: ['9200:9200', '9300:9300'], volumes: ['es_data:/usr/share/elasticsearch/data'], env: [{ key: 'discovery.type', value: 'single-node' }, { key: 'ES_JAVA_OPTS', value: '-Xms1g -Xmx1g' }], labels: ['search', 'logging', 'production'] },
  },
  {
    name: 'kibana', image: 'docker.elastic.co/kibana/kibana', currentTag: '8.11.3', newTag: '8.12.0', status: 'running',
    registry: 'custom', updateKind: 'minor', bouncer: 'safe', server: 'Agent-01 (prod-east)',
    details: { ports: ['5601:5601'], volumes: [], env: [{ key: 'ELASTICSEARCH_HOSTS', value: 'http://elasticsearch:9200' }], labels: ['logging', 'observability', 'production'] },
  },
  {
    name: 'cadvisor', image: 'gcr.io/cadvisor/cadvisor', currentTag: '0.47.2', newTag: '0.49.1', status: 'running',
    registry: 'custom', updateKind: 'minor', bouncer: 'safe', server: 'Agent-01 (prod-east)',
    details: { ports: ['8888:8080'], volumes: ['/:/rootfs:ro', '/var/run:/var/run:ro', '/sys:/sys:ro', '/var/lib/docker/:/var/lib/docker:ro'], env: [], labels: ['monitoring', 'metrics', 'production'] },
  },
  {
    name: 'drydock-agent-01', image: 'ghcr.io/drydock/agent', currentTag: '1.3.1', newTag: '1.3.2', status: 'running',
    registry: 'ghcr', updateKind: 'patch', bouncer: 'safe', server: 'Agent-01 (prod-east)',
    details: { ports: ['3001:3001'], volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro'], env: [{ key: 'DRYDOCK_SERVER', value: 'https://drydock.internal:3001' }, { key: 'AGENT_TOKEN', value: '***' }], labels: ['drydock', 'agent', 'production'] },
  },
  // ── Agent-02 (staging) (4 containers: all stopped — disconnected host) ──
  {
    name: 'staging-app', image: 'ghcr.io/acme/app', currentTag: '3.0.0-rc.2', newTag: '3.0.0-rc.5', status: 'stopped',
    registry: 'ghcr', updateKind: 'patch', bouncer: 'unsafe', server: 'Agent-02 (staging)',
    details: { ports: ['8080:8080'], volumes: [], env: [{ key: 'NODE_ENV', value: 'staging' }, { key: 'API_URL', value: 'http://staging-api:4000' }], labels: ['frontend', 'staging'] },
  },
  {
    name: 'staging-api', image: 'ghcr.io/acme/api', currentTag: '3.0.0-rc.2', newTag: '3.0.0-rc.5', status: 'stopped',
    registry: 'ghcr', updateKind: 'patch', bouncer: 'unsafe', server: 'Agent-02 (staging)',
    details: { ports: ['4000:4000'], volumes: [], env: [{ key: 'NODE_ENV', value: 'staging' }, { key: 'DB_HOST', value: 'staging-db' }], labels: ['api', 'staging'] },
  },
  {
    name: 'staging-db', image: 'postgres', currentTag: '16.1', newTag: null, status: 'stopped',
    registry: 'dockerhub', updateKind: null, bouncer: 'safe', server: 'Agent-02 (staging)',
    details: { ports: ['5432:5432'], volumes: ['staging_pg_data:/var/lib/postgresql/data'], env: [{ key: 'POSTGRES_DB', value: 'acme_staging' }], labels: ['database', 'staging'] },
  },
  {
    name: 'drydock-agent-02', image: 'ghcr.io/drydock/agent', currentTag: '1.3.1', newTag: '1.3.2', status: 'stopped',
    registry: 'ghcr', updateKind: 'patch', bouncer: 'safe', server: 'Agent-02 (staging)',
    details: { ports: ['3001:3001'], volumes: ['/var/run/docker.sock:/var/run/docker.sock:ro'], env: [{ key: 'DRYDOCK_SERVER', value: 'https://drydock.internal:3001' }, { key: 'AGENT_TOKEN', value: '***' }], labels: ['drydock', 'agent', 'staging'] },
  },
]);

// ── Stats ──────────────────────────────────────────────

export const stats = [
  { label: 'Containers', value: '26', icon: 'containers', color: 'var(--dd-primary)', colorMuted: 'var(--dd-primary-muted)', trend: '+3' },
  { label: 'Updates Available', value: '16', icon: 'updates', color: 'var(--dd-warning)', colorMuted: 'var(--dd-warning-muted)', trend: '+5' },
  { label: 'Security Issues', value: '3', icon: 'security', color: 'var(--dd-danger)', colorMuted: 'var(--dd-danger-muted)', trend: '-2' },
  { label: 'Uptime', value: '99.8%', icon: 'uptime', color: 'var(--dd-success)', colorMuted: 'var(--dd-success-muted)', trend: '+0.1%' },
];

// ── Recent Updates ─────────────────────────────────────

export const recentUpdates = [
  { name: 'traefik', image: 'traefik', oldVer: '2.10.7', newVer: '3.0.1', status: 'updated', time: '12m ago', running: true },
  { name: 'postgres-db', image: 'postgres', oldVer: '15.4', newVer: '16.1', status: 'pending', time: '34m ago', running: true },
  { name: 'redis-cache', image: 'redis', oldVer: '7.0.12', newVer: '7.2.4', status: 'updated', time: '1h ago', running: true },
  { name: 'nginx-proxy', image: 'nginx', oldVer: '1.24.0', newVer: '1.25.3', status: 'failed', time: '2h ago', running: false },
  { name: 'grafana', image: 'grafana/grafana', oldVer: '10.1.5', newVer: '10.2.3', status: 'updated', time: '3h ago', running: true },
];

// ── Vulnerabilities (dashboard) ────────────────────────

export const vulnerabilities = [
  { id: 'CVE-2024-21626', severity: 'CRITICAL', package: 'runc 1.1.11', image: 'nginx-proxy' },
  { id: 'CVE-2024-0727', severity: 'CRITICAL', package: 'openssl 3.1.4', image: 'traefik' },
  { id: 'CVE-2023-50164', severity: 'HIGH', package: 'curl 8.4.0', image: 'postgres-db' },
];

// ── Container Logs ─────────────────────────────────────

export const containerLogs: Record<string, string[]> = {
  'traefik': [
    '2025-02-17T15:23:01.123Z  Starting Traefik v2.10.7...',
    '2025-02-17T15:23:01.456Z  Loading configuration from /traefik.yml',
    '2025-02-17T15:23:01.789Z  Entrypoint web listening on :80',
    '2025-02-17T15:23:01.801Z  Entrypoint websecure listening on :443',
    '2025-02-17T15:23:02.012Z  Entrypoint traefik listening on :8080',
    '2025-02-17T15:23:02.340Z  Provider docker: watching containers on unix:///var/run/docker.sock',
    '2025-02-17T15:23:03.001Z  [warn] Certificate for *.example.com expires in 14 days',
    '2025-02-17T15:23:04.210Z  Adding route for service drydock-api@docker',
    '2025-02-17T15:23:04.215Z  Adding route for service drydock-ui@docker',
    '2025-02-17T15:23:04.218Z  Adding route for service grafana@docker',
    '2025-02-17T15:23:05.502Z  Configuration loaded from Docker provider (8 services)',
    '2025-02-17T15:23:10.330Z  10.0.1.50 - GET /api/v1/containers 200 23ms',
    '2025-02-17T15:23:15.781Z  10.0.1.50 - GET /dashboard/ 200 4ms',
    '2025-02-17T15:23:20.105Z  [warn] Rate limiter triggered for 192.168.1.105 (50 req/s)',
    '2025-02-17T15:23:25.442Z  Health check passed for drydock-api@docker',
  ],
  'postgres-db': [
    '2025-02-17T15:23:01.100Z  PostgreSQL 15.4 on x86_64-pc-linux-gnu, compiled by gcc 12.2.0',
    '2025-02-17T15:23:01.201Z  listening on IPv4 address "0.0.0.0", port 5432',
    '2025-02-17T15:23:01.350Z  database system was shut down at 2025-02-17 15:22:58 UTC',
    '2025-02-17T15:23:01.510Z  database system is ready to accept connections',
    '2025-02-17T15:23:02.701Z  connection received: host=172.18.0.5 port=42318',
    '2025-02-17T15:23:02.780Z  connection authorized: user=admin database=drydock',
    '2025-02-17T15:23:04.100Z  checkpoint starting: time',
    '2025-02-17T15:23:06.201Z  checkpoint complete: wrote 847 buffers (5.2%); WAL file(s) added 1, removed 0',
    '2025-02-17T15:23:10.330Z  [warn] autovacuum: found 1847 dead tuples in table "audit_log"',
    '2025-02-17T15:23:12.450Z  statement: SELECT count(*) FROM containers WHERE status = $1',
    '2025-02-17T15:23:12.453Z  duration: 2.314 ms',
    '2025-02-17T15:23:15.700Z  connection received: host=172.18.0.5 port=42320',
    '2025-02-17T15:23:18.900Z  [error] could not extend file "base/16384/16521": No space left on device',
    '2025-02-17T15:23:18.910Z  [hint] Check free disk space.',
    '2025-02-17T15:23:20.100Z  temporary file: path "base/pgsql_tmp/pgsql_tmp3241.0", size 41943040',
  ],
  'redis-cache': [
    '2025-02-17T15:23:01.050Z  oO0OoO0OoO0Oo Redis is starting oO0OoO0OoO0Oo',
    '2025-02-17T15:23:01.051Z  Redis version=7.0.12, bits=64, commit=00000000, modified=0',
    '2025-02-17T15:23:01.100Z  Configuration loaded from /etc/redis/redis.conf',
    '2025-02-17T15:23:01.200Z  Running mode=standalone, port=6379.',
    '2025-02-17T15:23:01.210Z  Server initialized',
    '2025-02-17T15:23:01.215Z  Loading RDB produced by version 7.0.12',
    '2025-02-17T15:23:01.280Z  RDB age 342 seconds',
    '2025-02-17T15:23:01.290Z  DB loaded from disk: 0.075 seconds',
    '2025-02-17T15:23:01.300Z  Ready to accept connections tcp',
    '2025-02-17T15:23:05.400Z  DB 0: 1247 keys (0 volatile) in 2048 slots HT.',
    '2025-02-17T15:23:10.500Z  [warn] Memory usage 198.42M exceeds maxmemory 256mb by ratio 0.77',
    '2025-02-17T15:23:15.602Z  1 clients connected (0 replicas), 198.42M memory in use',
    '2025-02-17T15:23:20.700Z  Background AOF rewrite started by pid 42',
    '2025-02-17T15:23:21.100Z  Background AOF rewrite finished successfully',
    '2025-02-17T15:23:25.800Z  DB saved on disk',
  ],
  'nginx-proxy': [
    '2025-02-17T15:20:01.100Z  nginx: [emerg] "worker_processes" directive invalid value in /etc/nginx/nginx.conf:3',
    '2025-02-17T15:20:01.110Z  nginx: configuration file /etc/nginx/nginx.conf test failed',
    '2025-02-17T15:18:30.200Z  2025/02/17 15:18:30 [notice] 1#1: using the "epoll" event method',
    '2025-02-17T15:18:30.210Z  2025/02/17 15:18:30 [notice] 1#1: nginx/1.24.0',
    '2025-02-17T15:18:30.215Z  2025/02/17 15:18:30 [notice] 1#1: OS: Linux 6.1.0-18-amd64',
    '2025-02-17T15:18:31.100Z  10.0.1.1 - - "GET / HTTP/1.1" 502 559 "-" "curl/8.4.0"',
    '2025-02-17T15:18:31.101Z  [error] 29#29: *1 connect() failed (111: Connection refused) while connecting to upstream',
    '2025-02-17T15:18:35.200Z  10.0.1.1 - - "GET /health HTTP/1.1" 502 559 "-" "docker-healthcheck"',
    '2025-02-17T15:18:40.301Z  10.0.1.1 - - "GET /health HTTP/1.1" 502 559 "-" "docker-healthcheck"',
    '2025-02-17T15:18:45.400Z  [error] 29#29: *4 connect() failed (111: Connection refused) while connecting to upstream',
    '2025-02-17T15:18:50.500Z  [crit] 29#29: worker process 31 exited on signal 9',
    '2025-02-17T15:18:50.510Z  [notice] 29#29: signal 17 (SIGCHLD) received from 31',
    '2025-02-17T15:18:50.520Z  [notice] 29#29: start worker process 45',
    '2025-02-17T15:18:55.600Z  [warn] 29#29: 1024 worker_connections are not enough for 1847 active connections',
    '2025-02-17T15:19:00.700Z  [notice] 1#1: signal 3 (SIGQUIT) received, shutting down',
  ],
  'grafana': [
    '2025-02-17T15:23:01.200Z  Starting Grafana v10.1.5 (commit: abc123def)',
    '2025-02-17T15:23:01.400Z  Config loaded from /etc/grafana/grafana.ini',
    '2025-02-17T15:23:01.600Z  HTTP Server Listen addr=0.0.0.0:3000 protocol=http',
    '2025-02-17T15:23:02.100Z  Connecting to database: sqlite3',
    '2025-02-17T15:23:02.350Z  Database migration completed (version 547)',
    '2025-02-17T15:23:02.500Z  Registering plugin: Prometheus',
    '2025-02-17T15:23:02.510Z  Registering plugin: Loki',
    '2025-02-17T15:23:03.001Z  [warn] Plugin "grafana-worldmap-panel" is unsigned',
    '2025-02-17T15:23:03.200Z  Initializing Stream Manager',
    '2025-02-17T15:23:04.100Z  Starting background services...',
    '2025-02-17T15:23:04.300Z  Live Push Gateway started',
    '2025-02-17T15:23:05.500Z  Data source "Prometheus" (uid: prom-01) connected successfully',
    '2025-02-17T15:23:06.700Z  Alert rule evaluation started (48 rules)',
    '2025-02-17T15:23:10.800Z  [warn] Dashboard "Container Overview" has unsaved changes from user admin',
    '2025-02-17T15:23:15.900Z  Scheduled report "Weekly Summary" queued for delivery',
  ],
  'prometheus': [
    '2025-02-17T15:23:01.050Z  Starting Prometheus v2.48.1 (branch: HEAD, revision: abc123)',
    '2025-02-17T15:23:01.060Z  Build context (go=go1.21.5, platform=linux/amd64)',
    '2025-02-17T15:23:01.200Z  Loading configuration file /etc/prometheus/prometheus.yml',
    '2025-02-17T15:23:01.400Z  Completed loading of configuration file',
    '2025-02-17T15:23:01.500Z  Server is ready to receive web requests.',
    '2025-02-17T15:23:01.510Z  TSDB started',
    '2025-02-17T15:23:02.100Z  Scrape discovery manager started',
    '2025-02-17T15:23:03.200Z  Scraping target: http://drydock-api:3001/metrics (interval: 15s)',
    '2025-02-17T15:23:03.210Z  Scraping target: http://node-exporter:9100/metrics (interval: 15s)',
    '2025-02-17T15:23:05.400Z  [warn] Scrape target "traefik:8080" returned HTTP 503',
    '2025-02-17T15:23:10.500Z  Head GC completed: removed 12847 series, freed 4.2MB',
    '2025-02-17T15:23:15.600Z  WAL segment 000847 written (8.1MB)',
    '2025-02-17T15:23:20.700Z  Compaction completed in 1.23s (merged 3 blocks)',
    '2025-02-17T15:23:25.800Z  Rule evaluation completed: 12 rules, 0 errors',
    '2025-02-17T15:23:30.900Z  TSDB head truncated: mint=1708185780000',
  ],
  'drydock-api': [
    '2025-02-17T15:23:01.100Z  Drydock API v1.3.1 starting...',
    '2025-02-17T15:23:01.200Z  Loading configuration from /app/config/config.yml',
    '2025-02-17T15:23:01.350Z  Connecting to Docker socket at /var/run/docker.sock',
    '2025-02-17T15:23:01.500Z  Docker engine v27.5.1 detected (API v1.46)',
    '2025-02-17T15:23:01.700Z  Initializing watcher for 47 containers',
    '2025-02-17T15:23:02.100Z  Registry auth: Docker Hub (token valid until 2025-02-18T15:23:00Z)',
    '2025-02-17T15:23:02.300Z  Registry auth: ghcr.io (token valid until 2025-02-18T15:23:00Z)',
    '2025-02-17T15:23:02.500Z  HTTP server listening on 0.0.0.0:3001',
    '2025-02-17T15:23:03.800Z  Watcher scan started: checking 47 containers across 3 registries',
    '2025-02-17T15:23:08.100Z  [warn] Rate limit approaching for Docker Hub (87/100 requests)',
    '2025-02-17T15:23:10.200Z  Watcher scan complete: 6 updates found',
    '2025-02-17T15:23:12.300Z  GET /api/v1/containers 200 23ms',
    '2025-02-17T15:23:14.400Z  GET /api/v1/updates 200 45ms',
    '2025-02-17T15:23:16.500Z  [error] Failed to reach registry.internal/mirror (ECONNREFUSED)',
    '2025-02-17T15:23:18.600Z  POST /api/v1/containers/traefik/update 202 12ms - update queued',
  ],
  'drydock-ui': [
    '2025-02-17T15:23:01.050Z  Starting nginx for Drydock UI...',
    '2025-02-17T15:23:01.100Z  Configuration: /etc/nginx/conf.d/default.conf',
    '2025-02-17T15:23:01.200Z  Upstream API: http://drydock-api:3001',
    '2025-02-17T15:23:01.250Z  Listening on port 80',
    '2025-02-17T15:23:01.260Z  Worker process started (pid: 7)',
    '2025-02-17T15:23:05.300Z  10.0.1.50 - "GET / HTTP/1.1" 200 1847 "Mozilla/5.0"',
    '2025-02-17T15:23:05.310Z  10.0.1.50 - "GET /assets/index-abc123.js HTTP/1.1" 200 245760',
    '2025-02-17T15:23:05.315Z  10.0.1.50 - "GET /assets/index-def456.css HTTP/1.1" 200 34560',
    '2025-02-17T15:23:10.400Z  10.0.1.50 - "GET /api/v1/containers HTTP/1.1" 200 (proxied)',
    '2025-02-17T15:23:15.500Z  10.0.1.50 - "GET /api/v1/updates HTTP/1.1" 200 (proxied)',
    '2025-02-17T15:23:20.600Z  192.168.1.105 - "GET / HTTP/1.1" 200 1847',
    '2025-02-17T15:23:25.700Z  192.168.1.105 - "GET /favicon.ico HTTP/1.1" 304 0',
    '2025-02-17T15:23:30.800Z  10.0.1.50 - "GET /api/v1/security HTTP/1.1" 200 (proxied)',
    '2025-02-17T15:23:35.900Z  [warn] upstream timed out (110: Connection timed out) while reading response from drydock-api',
    '2025-02-17T15:23:40.000Z  10.0.1.50 - "GET /api/v1/containers HTTP/1.1" 200 (proxied)',
  ],
  'registry-mirror': [
    '2025-02-17T15:20:01.100Z  registry starting version=2.8.3',
    '2025-02-17T15:20:01.200Z  listening on [::]:5000',
    '2025-02-17T15:20:01.300Z  storage driver: filesystem rootdirectory=/var/lib/registry',
    '2025-02-17T15:20:02.400Z  [warn] TLS not configured, running in HTTP mode',
    '2025-02-17T15:20:05.500Z  GET /v2/ 200 1ms',
    '2025-02-17T15:20:10.600Z  GET /v2/_catalog 200 12ms (47 repositories)',
    '2025-02-17T15:20:15.700Z  [error] storage error: disk usage 94% exceeds threshold 90%',
    '2025-02-17T15:20:15.710Z  [warn] garbage collection recommended',
    '2025-02-17T15:20:20.800Z  PUT /v2/nginx/manifests/1.25.3 201 340ms',
    '2025-02-17T15:20:25.900Z  [error] network unreachable: upstream registry-1.docker.io',
    '2025-02-17T15:20:30.000Z  GET /v2/traefik/manifests/3.0.1 404 2ms',
    '2025-02-17T15:20:35.100Z  [error] failed to sync mirror: context deadline exceeded',
    '2025-02-17T15:20:40.200Z  Health check: storage OK, upstream UNREACHABLE',
    '2025-02-17T15:20:45.300Z  [warn] 3 sync operations pending (backlog)',
    '2025-02-17T15:20:50.400Z  Process received SIGTERM, shutting down gracefully...',
  ],
  'watchtower': [
    '2025-02-17T15:23:01.100Z  Watchtower 1.7.1',
    '2025-02-17T15:23:01.200Z  Using notifications: none',
    '2025-02-17T15:23:01.300Z  Scheduling first run: 2025-02-17T16:23:01Z',
    '2025-02-17T15:23:01.310Z  Poll interval: 3600 seconds',
    '2025-02-17T15:23:01.320Z  Cleanup: enabled',
    '2025-02-17T15:23:02.400Z  Checking /var/run/docker.sock for container updates...',
    '2025-02-17T15:23:03.500Z  Found 10 containers to watch',
    '2025-02-17T15:23:04.600Z  Pulling traefik:2.10.7 to check for digest changes',
    '2025-02-17T15:23:08.700Z  [warn] Skipping container "registry-mirror": stopped',
    '2025-02-17T15:23:10.800Z  traefik: digest unchanged',
    '2025-02-17T15:23:12.900Z  redis-cache: digest unchanged',
    '2025-02-17T15:23:14.000Z  grafana: digest unchanged',
    '2025-02-17T15:23:16.100Z  Scan complete: 0 containers need updates',
    '2025-02-17T15:23:16.200Z  Sleeping for 3600 seconds...',
    '2025-02-17T15:23:16.210Z  Next check at: 2025-02-17T16:23:16Z',
  ],
};

export function getContainerLogs(name: string): string[] {
  return containerLogs[name] || [
    '2025-02-17T15:23:01.000Z  No logs available for this container',
  ];
}

// ── Security Page ────────────────────────────────────

export const securityStats = {
  scannedImages: 47,
  clean: 41,
  critical: 2,
  high: 3,
  medium: 8,
  low: 12,
};

export const securityVulnerabilities = [
  { id: 'CVE-2024-21626', severity: 'CRITICAL', package: 'runc', version: '1.1.11', fixedIn: '1.1.12', image: 'nginx-proxy', publishedDate: '2024-01-31' },
  { id: 'CVE-2024-0727', severity: 'CRITICAL', package: 'openssl', version: '3.1.4', fixedIn: '3.1.5', image: 'traefik', publishedDate: '2024-01-26' },
  { id: 'CVE-2023-50164', severity: 'HIGH', package: 'curl', version: '8.4.0', fixedIn: '8.4.1', image: 'postgres-db', publishedDate: '2023-12-07' },
  { id: 'CVE-2024-1086', severity: 'HIGH', package: 'linux-kernel', version: '6.6.8', fixedIn: '6.6.15', image: 'grafana', publishedDate: '2024-01-31' },
  { id: 'CVE-2023-46218', severity: 'HIGH', package: 'curl', version: '8.4.0', fixedIn: '8.5.0', image: 'redis-cache', publishedDate: '2023-12-06' },
  { id: 'CVE-2024-0553', severity: 'MEDIUM', package: 'gnutls', version: '3.8.2', fixedIn: '3.8.3', image: 'traefik', publishedDate: '2024-01-16' },
  { id: 'CVE-2023-6129', severity: 'MEDIUM', package: 'openssl', version: '3.1.4', fixedIn: '3.1.5', image: 'drydock-api', publishedDate: '2024-01-09' },
  { id: 'CVE-2023-5678', severity: 'MEDIUM', package: 'openssl', version: '3.0.12', fixedIn: '3.0.13', image: 'registry-mirror', publishedDate: '2023-11-06' },
  { id: 'CVE-2024-0567', severity: 'MEDIUM', package: 'gnutls', version: '3.8.2', fixedIn: '3.8.3', image: 'prometheus', publishedDate: '2024-01-16' },
  { id: 'CVE-2023-44487', severity: 'MEDIUM', package: 'nghttp2', version: '1.57.0', fixedIn: null, image: 'nginx-proxy', publishedDate: '2023-10-10' },
  { id: 'CVE-2023-50495', severity: 'MEDIUM', package: 'ncurses', version: '6.4', fixedIn: '6.4-20231217', image: 'postgres-db', publishedDate: '2023-12-12' },
  { id: 'CVE-2023-52425', severity: 'MEDIUM', package: 'expat', version: '2.5.0', fixedIn: '2.6.0', image: 'grafana', publishedDate: '2024-02-04' },
  { id: 'CVE-2023-45853', severity: 'LOW', package: 'zlib', version: '1.3', fixedIn: '1.3.1', image: 'redis-cache', publishedDate: '2023-10-14' },
  { id: 'CVE-2023-39615', severity: 'LOW', package: 'libxml2', version: '2.11.5', fixedIn: null, image: 'traefik', publishedDate: '2023-08-29' },
  { id: 'CVE-2023-31484', severity: 'LOW', package: 'perl', version: '5.36.0', fixedIn: '5.38.0', image: 'prometheus', publishedDate: '2023-04-29' },
];

export const securityScanHistory = [
  { container: 'traefik', image: 'traefik:2.10.7', scannedAt: '14 min ago', vulnCount: 3, status: 'issues' as const },
  { container: 'postgres-db', image: 'postgres:15.4', scannedAt: '22 min ago', vulnCount: 2, status: 'issues' as const },
  { container: 'redis-cache', image: 'redis:7.0.12', scannedAt: '35 min ago', vulnCount: 2, status: 'issues' as const },
  { container: 'drydock-api', image: 'ghcr.io/drydock/api:1.3.1', scannedAt: '1h ago', vulnCount: 0, status: 'clean' as const },
  { container: 'watchtower', image: 'containrrr/watchtower:1.7.1', scannedAt: '2h ago', vulnCount: 0, status: 'clean' as const },
];

// ── Servers Page ──────────────────────────────────────

export interface Server {
  name: string;
  host: string;
  status: 'connected' | 'disconnected';
  dockerVersion: string;
  os: string;
  arch: string;
  cpus: number;
  memoryGb: number;
  containers: { total: number; running: number; stopped: number };
  images: number;
  lastSeen: string;
}

export const servers = ref<Server[]>([
  { name: 'Local', host: 'unix:///var/run/docker.sock', status: 'connected', dockerVersion: '27.5.1', os: 'Ubuntu 24.04', arch: 'amd64', cpus: 8, memoryGb: 32, containers: { total: 10, running: 8, stopped: 2 }, images: 18, lastSeen: 'Just now' },
  { name: 'Agent-01 (prod-east)', host: 'https://10.0.1.50:3001', status: 'connected', dockerVersion: '27.5.1', os: 'Debian 12', arch: 'amd64', cpus: 16, memoryGb: 64, containers: { total: 12, running: 12, stopped: 0 }, images: 23, lastSeen: '2s ago' },
  { name: 'Agent-02 (staging)', host: 'https://10.0.2.10:3001', status: 'disconnected', dockerVersion: '26.1.4', os: 'Alpine 3.20', arch: 'arm64', cpus: 4, memoryGb: 8, containers: { total: 4, running: 0, stopped: 4 }, images: 12, lastSeen: '14m ago' },
]);

export const serversStats = computed(() => {
  const all = servers.value;
  return {
    total: all.length,
    totalContainers: all.reduce((sum, s) => sum + s.containers.total, 0),
    connected: all.filter((s) => s.status === 'connected').length,
    disconnected: all.filter((s) => s.status === 'disconnected').length,
  };
});

// ── Registries Page ─────────────────────────────────────

export const registriesData = [
  { id: 'hub', name: 'Docker Hub', type: 'hub', status: 'connected', config: { login: 'drydock-bot', url: 'https://registry-1.docker.io' } },
  { id: 'ghcr', name: 'GitHub Packages', type: 'ghcr', status: 'connected', config: { login: 'CodesWhat', url: 'https://ghcr.io' } },
  { id: 'quay', name: 'Quay.io', type: 'quay', status: 'connected', config: { namespace: 'drydock', url: 'https://quay.io' } },
  { id: 'ecr', name: 'AWS ECR (prod)', type: 'ecr', status: 'error', config: { region: 'us-east-1', accountId: '123456789012', accessKeyId: 'AKIA***' } },
  { id: 'gitlab', name: 'GitLab Registry', type: 'gitlab', status: 'connected', config: { url: 'https://registry.gitlab.com', token: '***' } },
];

// ── Agents Page ─────────────────────────────────────────

export interface Agent {
  id: string;
  name: string;
  host: string;
  status: 'connected' | 'disconnected';
  dockerVersion: string;
  os: string;
  arch: string;
  cpus: number;
  memoryGb: number;
  containers: { total: number; running: number; stopped: number };
  images: number;
  lastSeen: string;
  version: string;
  uptime: string;
  logLevel: string;
  pollInterval: string;
}

export interface AgentLog {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  component: string;
  message: string;
}

export const agentsData = ref<Agent[]>([
  { id: 'agent-local', name: 'Local', host: 'unix:///var/run/docker.sock', status: 'connected', dockerVersion: '27.5.1', os: 'Ubuntu 24.04', arch: 'amd64', cpus: 8, memoryGb: 32, containers: { total: 31, running: 28, stopped: 3 }, images: 45, lastSeen: 'Just now', version: '1.3.2', uptime: '14d 7h 23m', logLevel: 'info', pollInterval: '*/6 * * * *' },
  { id: 'agent-01', name: 'prod-east', host: 'https://10.0.1.50:3001', status: 'connected', dockerVersion: '27.5.1', os: 'Debian 12', arch: 'amd64', cpus: 16, memoryGb: 64, containers: { total: 12, running: 12, stopped: 0 }, images: 23, lastSeen: '2s ago', version: '1.3.2', uptime: '32d 11h 5m', logLevel: 'info', pollInterval: '*/4 * * * *' },
  { id: 'agent-02', name: 'staging', host: 'https://10.0.2.10:3001', status: 'disconnected', dockerVersion: '26.1.4', os: 'Alpine 3.20', arch: 'arm64', cpus: 4, memoryGb: 8, containers: { total: 4, running: 0, stopped: 4 }, images: 12, lastSeen: '14m ago', version: '1.3.1', uptime: '0d 0h 0m', logLevel: 'debug', pollInterval: '0 8 * * 1' },
  { id: 'agent-03', name: 'dev-local', host: 'https://192.168.1.100:3001', status: 'connected', dockerVersion: '27.5.1', os: 'Fedora 41', arch: 'amd64', cpus: 4, memoryGb: 16, containers: { total: 8, running: 7, stopped: 1 }, images: 18, lastSeen: '1s ago', version: '1.3.2', uptime: '3d 19h 42m', logLevel: 'info', pollInterval: '*/10 * * * *' },
]);

export const agentLogs: Record<string, AgentLog[]> = {
  'agent-local': [
    { timestamp: '2025-02-17T15:23:01.123Z', level: 'info', component: 'api', message: 'Server started on 0.0.0.0:3001' },
    { timestamp: '2025-02-17T15:23:01.456Z', level: 'info', component: 'docker', message: 'Connected to Docker engine v27.5.1 via /var/run/docker.sock' },
    { timestamp: '2025-02-17T15:23:02.104Z', level: 'info', component: 'watcher:hub', message: 'Scanning 31 containers for updates...' },
    { timestamp: '2025-02-17T15:23:03.217Z', level: 'debug', component: 'registry:hub', message: 'Authenticated with Docker Hub (rate limit: 87/100)' },
    { timestamp: '2025-02-17T15:23:04.550Z', level: 'info', component: 'watcher:hub', message: 'Update found: traefik 2.10.7 -> 3.0.1 (major)' },
    { timestamp: '2025-02-17T15:23:05.012Z', level: 'info', component: 'watcher:hub', message: 'Update found: postgres 15.4 -> 16.1 (major)' },
    { timestamp: '2025-02-17T15:23:06.192Z', level: 'warn', component: 'registry:hub', message: 'Rate limit approaching for Docker Hub (91/100 requests used)' },
    { timestamp: '2025-02-17T15:23:07.103Z', level: 'info', component: 'watcher:hub', message: 'Update found: redis 7.0.12 -> 7.2.4 (minor)' },
    { timestamp: '2025-02-17T15:23:08.290Z', level: 'error', component: 'registry:ghcr', message: 'Failed to fetch manifest for ghcr.io/drydock/api:latest (HTTP 429)' },
    { timestamp: '2025-02-17T15:23:09.441Z', level: 'info', component: 'watcher:hub', message: 'Retrying ghcr.io/drydock/api in 30s (attempt 1/3)' },
    { timestamp: '2025-02-17T15:23:10.115Z', level: 'info', component: 'trigger:slack', message: 'Webhook delivered to #ops-updates (6 updates)' },
    { timestamp: '2025-02-17T15:23:11.320Z', level: 'debug', component: 'docker', message: 'Health check passed for postgres-db (latency: 4ms)' },
    { timestamp: '2025-02-17T15:23:12.456Z', level: 'info', component: 'watcher:hub', message: 'Scan complete: 6 updates across 31 containers' },
    { timestamp: '2025-02-17T15:23:13.550Z', level: 'info', component: 'api', message: 'GET /api/v1/containers 200 (23ms)' },
    { timestamp: '2025-02-17T15:23:14.920Z', level: 'warn', component: 'docker', message: 'Container nginx-proxy stopped (exit code 137 - OOM killed)' },
    { timestamp: '2025-02-17T15:23:16.880Z', level: 'info', component: 'docker', message: 'All health checks passed (28/28 running)' },
    { timestamp: '2025-02-17T15:23:18.620Z', level: 'debug', component: 'auth', message: 'Session refreshed for admin (expires 2025-02-17T16:23:18Z)' },
    { timestamp: '2025-02-17T15:23:20.880Z', level: 'info', component: 'backup', message: 'Database backup completed (2.3MB, 0.8s)' },
    { timestamp: '2025-02-17T15:23:22.015Z', level: 'info', component: 'api', message: 'GET /api/v1/updates 200 (45ms)' },
    { timestamp: '2025-02-17T15:23:24.440Z', level: 'info', component: 'watcher:hub', message: 'Next scan scheduled in 6h' },
  ],
  'agent-01': [
    { timestamp: '2025-02-17T15:22:50.100Z', level: 'info', component: 'agent', message: 'Agent prod-east connected to hub (wss://drydock.local:3001)' },
    { timestamp: '2025-02-17T15:22:50.340Z', level: 'info', component: 'docker', message: 'Connected to Docker engine v27.5.1 via /var/run/docker.sock' },
    { timestamp: '2025-02-17T15:22:51.200Z', level: 'info', component: 'watcher:hub', message: 'Scanning 12 containers for updates...' },
    { timestamp: '2025-02-17T15:22:52.330Z', level: 'debug', component: 'registry:ghcr', message: 'Authenticated with ghcr.io using token' },
    { timestamp: '2025-02-17T15:22:53.112Z', level: 'info', component: 'watcher:hub', message: 'All 12 containers up to date' },
    { timestamp: '2025-02-17T15:22:54.800Z', level: 'info', component: 'docker', message: 'Health check passed for all 12 containers (avg latency: 3ms)' },
    { timestamp: '2025-02-17T15:22:55.990Z', level: 'info', component: 'agent', message: 'Heartbeat sent to hub (rtt: 12ms)' },
    { timestamp: '2025-02-17T15:22:57.150Z', level: 'debug', component: 'docker', message: 'Image prune completed: removed 3 dangling images (1.2GB freed)' },
    { timestamp: '2025-02-17T15:22:58.400Z', level: 'info', component: 'trigger:http', message: 'POST /webhook/ci 200 - pipeline status: passing' },
    { timestamp: '2025-02-17T15:23:00.100Z', level: 'info', component: 'watcher:hub', message: 'Next scan scheduled in 4h' },
  ],
  'agent-02': [
    { timestamp: '2025-02-17T15:09:01.100Z', level: 'info', component: 'agent', message: 'Agent staging connected to hub (wss://drydock.local:3001)' },
    { timestamp: '2025-02-17T15:09:01.450Z', level: 'info', component: 'docker', message: 'Connected to Docker engine v26.1.4 via /var/run/docker.sock' },
    { timestamp: '2025-02-17T15:09:02.200Z', level: 'info', component: 'watcher:hub', message: 'Scanning 4 containers for updates...' },
    { timestamp: '2025-02-17T15:09:03.100Z', level: 'warn', component: 'docker', message: 'Docker engine v26.1.4 is outdated (latest: v27.5.1)' },
    { timestamp: '2025-02-17T15:09:04.350Z', level: 'info', component: 'watcher:hub', message: 'Update found: staging-api 2.1.0 -> 2.2.0 (minor)' },
    { timestamp: '2025-02-17T15:09:06.800Z', level: 'info', component: 'watcher:hub', message: 'Scan complete: 1 update across 4 containers' },
    { timestamp: '2025-02-17T15:09:08.100Z', level: 'info', component: 'agent', message: 'Heartbeat sent to hub (rtt: 45ms)' },
    { timestamp: '2025-02-17T15:09:10.200Z', level: 'warn', component: 'agent', message: 'High latency to hub (rtt: 45ms, threshold: 30ms)' },
    { timestamp: '2025-02-17T15:09:17.100Z', level: 'error', component: 'agent', message: 'Connection to hub lost (ETIMEDOUT)' },
    { timestamp: '2025-02-17T15:09:26.500Z', level: 'warn', component: 'agent', message: 'Entering offline mode after 3 failed reconnect attempts' },
  ],
  'agent-03': [
    { timestamp: '2025-02-17T15:20:01.100Z', level: 'info', component: 'agent', message: 'Agent dev-local connected to hub (wss://drydock.local:3001)' },
    { timestamp: '2025-02-17T15:20:01.350Z', level: 'info', component: 'docker', message: 'Connected to Docker engine v27.5.1 via /var/run/docker.sock' },
    { timestamp: '2025-02-17T15:20:02.200Z', level: 'info', component: 'watcher:hub', message: 'Scanning 8 containers for updates...' },
    { timestamp: '2025-02-17T15:20:04.500Z', level: 'info', component: 'watcher:hub', message: 'Update found: dev-api 0.9.3 -> 0.10.0 (minor)' },
    { timestamp: '2025-02-17T15:20:05.750Z', level: 'info', component: 'watcher:hub', message: 'Update found: dev-ui 0.9.3 -> 0.10.0 (minor)' },
    { timestamp: '2025-02-17T15:20:06.900Z', level: 'info', component: 'watcher:hub', message: 'Scan complete: 2 updates across 8 containers' },
    { timestamp: '2025-02-17T15:20:08.100Z', level: 'info', component: 'agent', message: 'Heartbeat sent to hub (rtt: 2ms)' },
    { timestamp: '2025-02-17T15:20:12.350Z', level: 'info', component: 'docker', message: 'Health check passed for 7/8 containers' },
    { timestamp: '2025-02-17T15:20:13.500Z', level: 'warn', component: 'docker', message: 'Container dev-cache health check timeout (>5s)' },
    { timestamp: '2025-02-17T15:20:27.700Z', level: 'info', component: 'watcher:hub', message: 'Next scan scheduled in 10m' },
  ],
};

export function getAgentLogs(agentId: string): AgentLog[] {
  return agentLogs[agentId] ?? [];
}

export function formatAgentLogTimestamp(iso: string) {
  const d = new Date(iso);
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

// ── Triggers Page ───────────────────────────────────────

export const triggersData = [
  { id: 'slack-ops', name: 'Slack #ops-updates', type: 'slack', status: 'active', config: { channel: '#ops-updates', webhook: 'https://hooks.slack.com/***' } },
  { id: 'discord-dev', name: 'Discord Dev', type: 'discord', status: 'active', config: { webhook: 'https://discord.com/api/webhooks/***' } },
  { id: 'email-admin', name: 'Admin Email', type: 'smtp', status: 'active', config: { to: 'admin@example.com', from: 'drydock@example.com', host: 'smtp.sendgrid.net' } },
  { id: 'http-ci', name: 'CI Pipeline Webhook', type: 'http', status: 'error', config: { url: 'https://ci.example.com/api/trigger', method: 'POST' } },
  { id: 'telegram-alerts', name: 'Telegram Alerts', type: 'telegram', status: 'active', config: { botToken: '***', chatId: '-1001234567890' } },
  { id: 'mqtt-home', name: 'MQTT Home Automation', type: 'mqtt', status: 'active', config: { broker: 'mqtt://192.168.1.5:1883', topic: 'drydock/updates' } },
];

// ── Watchers Page ───────────────────────────────────────

export const watchersData = [
  { id: 'local', name: 'Local Docker', type: 'docker', status: 'watching', containers: 31, cron: '0 */6 * * *', lastRun: '2h ago', config: { socket: '/var/run/docker.sock', watchByDefault: 'true' } },
  { id: 'agent-01-watcher', name: 'prod-east', type: 'docker', status: 'watching', containers: 12, cron: '0 */4 * * *', lastRun: '45m ago', config: { agent: 'agent-01', watchByDefault: 'true' } },
  { id: 'agent-02-watcher', name: 'staging', type: 'docker', status: 'paused', containers: 4, cron: '0 8 * * 1', lastRun: '6d ago', config: { agent: 'agent-02', maintenanceWindow: 'true', maintenanceOpen: 'false', nextWindow: '2026-02-17T08:00:00Z' } },
];

// ── Auth Page ───────────────────────────────────────────

export const authData = [
  { id: 'basic', name: 'Basic Auth', type: 'basic', status: 'active', config: { username: 'admin', hash: 'argon2id:***' } },
  { id: 'oidc', name: 'Google OIDC', type: 'oidc', status: 'active', config: { issuer: 'https://accounts.google.com', clientId: '***', redirectUri: 'https://drydock.example.com/auth/callback' } },
];

// ── Notifications Page ──────────────────────────────────

export const notificationsData = ref([
  { id: 'update-available', name: 'Update Available', enabled: true, triggers: ['slack-ops', 'discord-dev', 'email-admin'], description: 'When a container has a new version' },
  { id: 'update-applied', name: 'Update Applied', enabled: true, triggers: ['slack-ops'], description: 'After a container is successfully updated' },
  { id: 'update-failed', name: 'Update Failed', enabled: true, triggers: ['slack-ops', 'email-admin', 'telegram-alerts'], description: 'When an update fails or is rolled back' },
  { id: 'security-alert', name: 'Security Alert', enabled: true, triggers: ['email-admin', 'telegram-alerts'], description: 'Critical/High vulnerability detected' },
  { id: 'agent-disconnect', name: 'Agent Disconnected', enabled: false, triggers: [] as string[], description: 'When a remote agent loses connection' },
]);

// ── Profile Page ────────────────────────────────────────

export const profileData = { username: 'admin', email: 'admin@example.com', role: 'Administrator', lastLogin: '2026-02-16 14:23:01', sessions: 3 };

// ── Helper Functions ──────────────────────────────────

export function parseServer(server: string): { name: string; env: string | null } {
  const m = server.match(/^(.+?)\s*\((.+)\)$/);
  return m ? { name: m[1], env: m[2] } : { name: server, env: null };
}

export function serverBadgeColor(server: string) {
  const { env } = parseServer(server);
  if (!env) return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)' };
  if (env.includes('prod')) return { bg: 'var(--dd-success-muted)', text: 'var(--dd-success)' };
  if (env.includes('staging')) return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)' };
  return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)' };
}

export function registryLabel(reg: string) {
  return reg === 'dockerhub' ? 'Dockerhub' : reg === 'ghcr' ? 'GHCR' : 'Custom';
}

export function registryColorBg(reg: string) {
  if (reg === 'dockerhub') return 'var(--dd-info-muted)';
  if (reg === 'ghcr') return 'var(--dd-alt-muted)';
  return 'var(--dd-neutral-muted)';
}

export function registryColorText(reg: string) {
  if (reg === 'dockerhub') return 'var(--dd-info)';
  if (reg === 'ghcr') return 'var(--dd-alt)';
  return 'var(--dd-neutral)';
}

export function updateKindColor(kind: string | null) {
  if (kind === 'major') return { bg: 'var(--dd-danger-muted)', text: 'var(--dd-danger)' };
  if (kind === 'minor') return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)' };
  if (kind === 'patch') return { bg: 'var(--dd-primary-muted)', text: 'var(--dd-primary)' };
  if (kind === 'digest') return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)' };
  return { bg: 'transparent', text: 'transparent' };
}

export function bouncerColor(status: string) {
  if (status === 'safe') return { bg: 'var(--dd-success-muted)', text: 'var(--dd-success)' };
  if (status === 'unsafe') return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)' };
  return { bg: 'var(--dd-danger-muted)', text: 'var(--dd-danger)' };
}

export function severityColor(sev: string) {
  if (sev === 'CRITICAL') return { bg: 'var(--dd-danger-muted)', text: 'var(--dd-danger)' };
  if (sev === 'HIGH') return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)' };
  if (sev === 'MEDIUM') return { bg: 'var(--dd-caution-muted)', text: 'var(--dd-caution)' };
  return { bg: 'var(--dd-info-muted)', text: 'var(--dd-info)' };
}

export function registryTypeBadge(type: string) {
  if (type === 'hub') return { bg: 'var(--dd-info-muted)', text: 'var(--dd-info)', label: 'Hub' };
  if (type === 'ghcr') return { bg: 'var(--dd-alt-muted)', text: 'var(--dd-alt)', label: 'GHCR' };
  if (type === 'quay') return { bg: 'var(--dd-danger-muted)', text: 'var(--dd-danger)', label: 'Quay' };
  if (type === 'ecr') return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)', label: 'ECR' };
  if (type === 'gitlab') return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)', label: 'GitLab' };
  return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)', label: type };
}

export function triggerTypeBadge(type: string) {
  if (type === 'slack') return { bg: 'var(--dd-info-muted)', text: 'var(--dd-info)', label: 'Slack' };
  if (type === 'discord') return { bg: 'var(--dd-alt-muted)', text: 'var(--dd-alt)', label: 'Discord' };
  if (type === 'smtp') return { bg: 'var(--dd-success-muted)', text: 'var(--dd-success)', label: 'SMTP' };
  if (type === 'http') return { bg: 'var(--dd-warning-muted)', text: 'var(--dd-warning)', label: 'HTTP' };
  if (type === 'telegram') return { bg: 'var(--dd-primary-muted)', text: 'var(--dd-primary)', label: 'Telegram' };
  if (type === 'mqtt') return { bg: 'var(--dd-caution-muted)', text: 'var(--dd-caution)', label: 'MQTT' };
  return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)', label: type };
}

export function watcherStatusColor(status: string) {
  if (status === 'watching') return 'var(--dd-success)';
  if (status === 'paused') return 'var(--dd-warning)';
  return 'var(--dd-neutral)';
}

export function authTypeBadge(type: string) {
  if (type === 'basic') return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)', label: 'Basic' };
  if (type === 'oidc') return { bg: 'var(--dd-primary-muted)', text: 'var(--dd-primary)', label: 'OIDC' };
  return { bg: 'var(--dd-neutral-muted)', text: 'var(--dd-neutral)', label: type };
}

export function triggerNameById(id: string) {
  const t = triggersData.find(tr => tr.id === id);
  return t ? t.name : id;
}
