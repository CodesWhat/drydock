import { getVersion } from '../../configuration/index.js';
import { openApiPaths } from './paths/index.js';
import { openApiSchemas } from './schemas.js';

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'Drydock API',
    version: getVersion(),
    description:
      'Machine-readable API specification for Drydock. Canonical API base path is /api/v1, with /api available as a compatibility alias. Authentication defaults to session cookie auth. Mutating requests using session auth must also satisfy same-origin CSRF checks.',
  },
  'x-drydock-conventions': {
    actionPostEndpoints:
      'Side-effecting command operations use action-oriented POST endpoints under resource paths (e.g., POST /api/containers/:id/scan).',
  },
  servers: [
    {
      url: '/',
      description: 'Current Drydock server',
    },
  ],
  tags: [
    { name: 'System', description: 'Health, metadata, and server endpoints' },
    { name: 'Authentication', description: 'Authentication and session lifecycle endpoints' },
    { name: 'Containers', description: 'Container inventory and container-scoped operations' },
    { name: 'Triggers', description: 'Trigger discovery and trigger execution' },
    {
      name: 'Actions',
      description:
        'Side-effecting command operations using action-oriented POST endpoints under resource paths.',
    },
    { name: 'Watchers', description: 'Watcher component discovery' },
    { name: 'Registries', description: 'Registry component discovery' },
    { name: 'Authentications', description: 'Authentication component discovery' },
    { name: 'Agents', description: 'Remote agent status and logs' },
    { name: 'Notifications', description: 'Notification rule management' },
    { name: 'Audit', description: 'Audit log endpoints' },
    { name: 'Logs', description: 'Application and container logs' },
    { name: 'Icons', description: 'Icon proxy/cache endpoints' },
    { name: 'Realtime', description: 'SSE stream and acknowledgements' },
    { name: 'Webhook', description: 'Token-authenticated webhook endpoints' },
    { name: 'Metrics', description: 'Prometheus metrics endpoint' },
    { name: 'Docs', description: 'API documentation endpoints' },
  ],
  security: [{ sessionAuth: [] }],
  components: {
    securitySchemes: {
      sessionAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'connect.sid',
        description:
          'Session cookie authentication. For unsafe methods, requests must also satisfy same-origin CSRF validation (Origin/Referer/Sec-Fetch-Site checks).',
      },
      webhookBearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'Token',
        description:
          'Bearer token configured via webhook settings (shared token or endpoint-specific webhook tokens).',
      },
      metricsBearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'DD_SERVER_METRICS_TOKEN bearer token for /metrics endpoint',
      },
    },
    schemas: openApiSchemas,
  },
  paths: openApiPaths,
} as const;
