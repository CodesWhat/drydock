export interface SampleServiceCard {
  id: string;
  name: string;
  server: string;
  status: 'healthy' | 'degraded' | 'offline';
  updates: number;
}

export interface SampleWatcherItem {
  id: string;
  name: string;
  endpoint: string;
  status: 'connected' | 'disconnected';
  containers: number;
}

interface SampleContainerRow {
  id: string;
  name: string;
  status: 'running' | 'stopped';
  server: string;
  updates: number;
}

export const sampleServiceCards: SampleServiceCard[] = [
  { id: 'gateway', name: 'API Gateway', server: 'edge-1', status: 'healthy', updates: 0 },
  { id: 'worker', name: 'Background Worker', server: 'edge-2', status: 'degraded', updates: 2 },
  { id: 'reports', name: 'Reports Service', server: 'edge-3', status: 'offline', updates: 1 },
];

export const sampleWatcherItems: SampleWatcherItem[] = [
  {
    id: 'local',
    name: 'Local Docker',
    endpoint: 'unix:///var/run/docker.sock',
    status: 'connected',
    containers: 18,
  },
  {
    id: 'edge-1',
    name: 'Edge Cluster 1',
    endpoint: 'tcp://10.42.0.12:2376',
    status: 'connected',
    containers: 9,
  },
  {
    id: 'edge-2',
    name: 'Edge Cluster 2',
    endpoint: 'tcp://10.42.0.13:2376',
    status: 'disconnected',
    containers: 0,
  },
];

export const sampleContainerRows: SampleContainerRow[] = [
  { id: 'api', name: 'drydock-api', status: 'running', server: 'local', updates: 0 },
  { id: 'web', name: 'drydock-web', status: 'running', server: 'edge-1', updates: 2 },
  { id: 'db', name: 'postgres', status: 'stopped', server: 'edge-2', updates: 1 },
];
