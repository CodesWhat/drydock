export const serverInfo = {
  version: '1.4.1',
  uptime: 864000,
  hostname: 'drydock-demo',
  platform: 'linux',
  arch: 'amd64',
  nodeVersion: 'v24.0.0',
  configuration: {
    feature: {
      containerActions: true,
      delete: true,
    },
    poll: '*/15 * * * *',
    logLevel: 'info',
  },
};

export const securityRuntime = {
  checkedAt: new Date(Date.now() - 3600000).toISOString(),
  ready: true,
  scanner: {
    enabled: true,
    command: 'trivy',
    commandAvailable: true,
    status: 'ready',
    message: 'Trivy 0.58.0 installed and ready',
    scanner: 'trivy',
    server: '',
  },
  signature: {
    enabled: true,
    command: 'cosign',
    commandAvailable: true,
    status: 'ready',
    message: 'Cosign 2.4.1 installed and ready',
  },
  sbom: {
    enabled: true,
    formats: ['spdx-json', 'cyclonedx-json'],
  },
  requirements: [],
};
