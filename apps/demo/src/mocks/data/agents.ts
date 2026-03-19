export const agents = [
  {
    name: 'nas-agent',
    host: '192.168.1.50',
    port: 3001,
    connected: true,
    version: '1.5.0',
    os: 'linux',
    arch: 'amd64',
    cpus: 4,
    memoryGb: 16,
    uptimeSeconds: 864000,
    lastSeen: new Date().toISOString(),
    logLevel: 'info',
    pollInterval: '*/30 * * * *',
    containers: { total: 3, running: 3, stopped: 0 },
    images: 3,
  },
];
