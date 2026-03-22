import { HttpResponse, http } from 'msw';
import { agents } from '../data/agents';

type AgentLogEntryLevel = 'debug' | 'info';

type AgentLogEntrySpec = {
  level: AgentLogEntryLevel;
  message: string;
  offsetMs: number;
};

const agentLogSummarySpecs: AgentLogEntrySpec[] = [
  { offsetMs: 300000, level: 'info', message: 'Agent connected to controller' },
  { offsetMs: 240000, level: 'info', message: 'Starting container watch cycle' },
  { offsetMs: 180000, level: 'info', message: 'Found 3 watched containers' },
  { offsetMs: 120000, level: 'info', message: 'Registry check completed for all images' },
  { offsetMs: 60000, level: 'info', message: 'Watch cycle completed — next run in 30m' },
];

const agentLogDetailSpecs: AgentLogEntrySpec[] = [
  { offsetMs: 300000, level: 'info', message: 'Agent connected to controller' },
  { offsetMs: 240000, level: 'info', message: 'Starting container watch cycle' },
  { offsetMs: 180000, level: 'debug', message: 'Pulling manifest for prom/prometheus:v2.54.0' },
  { offsetMs: 120000, level: 'info', message: 'Registry check completed' },
  { offsetMs: 60000, level: 'info', message: 'Watch cycle completed' },
];

function buildAgentLogEntries(specs: AgentLogEntrySpec[]) {
  const now = Date.now();
  return specs.map((spec) => ({
    timestamp: new Date(now - spec.offsetMs).toISOString(),
    level: spec.level,
    message: spec.message,
  }));
}

export const agentHandlers = [
  http.get('/api/v1/agents', () => HttpResponse.json({ data: agents })),
  http.get('/api/v1/agents/:name/log', () =>
    HttpResponse.json({ entries: buildAgentLogEntries(agentLogSummarySpecs) }),
  ),
  http.get('/api/v1/agents/:name/log/entries', () =>
    HttpResponse.json({ entries: buildAgentLogEntries(agentLogDetailSpecs) }),
  ),
];
