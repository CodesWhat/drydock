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
