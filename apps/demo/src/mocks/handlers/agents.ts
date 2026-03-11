import { HttpResponse, http } from 'msw';
import { agents } from '../data/agents';

export const agentHandlers = [
  http.get('/api/agents', () => HttpResponse.json({ data: agents })),

  http.get('/api/agents/:name/log', () =>
    HttpResponse.json({
      entries: [
        {
          timestamp: new Date(Date.now() - 300000).toISOString(),
          level: 'info',
          message: 'Agent connected to controller',
        },
        {
          timestamp: new Date(Date.now() - 240000).toISOString(),
          level: 'info',
          message: 'Starting container watch cycle',
        },
        {
          timestamp: new Date(Date.now() - 180000).toISOString(),
          level: 'info',
          message: 'Found 3 watched containers',
        },
        {
          timestamp: new Date(Date.now() - 120000).toISOString(),
          level: 'info',
          message: 'Registry check completed for all images',
        },
        {
          timestamp: new Date(Date.now() - 60000).toISOString(),
          level: 'info',
          message: 'Watch cycle completed — next run in 30m',
        },
      ],
    }),
  ),

  http.get('/api/agents/:name/log/entries', () =>
    HttpResponse.json({
      entries: [
        {
          timestamp: new Date(Date.now() - 300000).toISOString(),
          level: 'info',
          message: 'Agent connected to controller',
        },
        {
          timestamp: new Date(Date.now() - 240000).toISOString(),
          level: 'info',
          message: 'Starting container watch cycle',
        },
        {
          timestamp: new Date(Date.now() - 180000).toISOString(),
          level: 'debug',
          message: 'Pulling manifest for prom/prometheus:v2.54.0',
        },
        {
          timestamp: new Date(Date.now() - 120000).toISOString(),
          level: 'info',
          message: 'Registry check completed',
        },
        {
          timestamp: new Date(Date.now() - 60000).toISOString(),
          level: 'info',
          message: 'Watch cycle completed',
        },
      ],
    }),
  ),
];
