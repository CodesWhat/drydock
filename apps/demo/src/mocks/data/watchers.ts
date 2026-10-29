import { containers } from './containers';

const localContainers = containers.filter(
  (container) => !('agent' in container && container.agent),
);
const localRunning = localContainers.filter((container) => container.status === 'running').length;

export const watchers = [
  {
    id: 'docker.local',
    type: 'docker',
    name: 'local',
    configuration: {
      socket: '/var/run/docker.sock',
      watchByDefault: true,
      pollInterval: '*/15 * * * *',
    },
    metadata: {
      containers: {
        total: localContainers.length,
        running: localRunning,
        stopped: localContainers.length - localRunning,
      },
      images: new Set(localContainers.map((container) => container.image.name)).size,
    },
  },
  {
    id: 'docker.remote',
    type: 'docker',
    name: 'remote',
    configuration: {
      socket: '/var/run/docker.sock',
      watchByDefault: true,
      pollInterval: '*/30 * * * *',
    },
    agent: 'nas-agent',
  },
];
