import { containers } from './containers';

function countContainers(agentName: string) {
  const owned = containers.filter(
    (container) => 'agent' in container && container.agent === agentName,
  );
  const running = owned.filter((container) => container.status === 'running').length;
  return { total: owned.length, running, stopped: owned.length - running };
}

export const agents = [
  {
    name: 'nas-agent',
    host: '192.168.1.50',
    port: 3001,
    connected: true,
    version: '1.8.0-rc.9',
    os: 'linux',
    arch: 'amd64',
    cpus: 4,
    memoryGb: 16,
    uptimeSeconds: 864000,
    lastSeen: new Date().toISOString(),
    logLevel: 'info',
    pollInterval: '*/30 * * * *',
    containers: countContainers('nas-agent'),
    images: 3,
  },
];
