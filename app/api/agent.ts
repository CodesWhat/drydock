import express, { type Request, type Response } from 'express';
import { getAgent, getAgents } from '../agent/index.js';
import { formatLogDisplayTimestamp } from '../log/display-timestamp.js';
import * as storeContainer from '../store/container.js';
import { sendErrorResponse } from './error-response.js';

const router = express.Router();
const ALLOWED_LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
const SAFE_LOG_COMPONENT_PATTERN = /^[a-zA-Z0-9._-]+$/;
const AGENT_LOG_FETCH_ERROR_MESSAGE = 'Failed to fetch logs from agent';
const AGENT_LOG_STRING_FIELDS = ['level', 'component', 'msg', 'message'] as const;

interface AgentLogEntriesRequestParams {
  name: string;
}

interface AgentLogEntriesRequestQuery {
  level?: string;
  component?: string;
  tail?: string;
  since?: string;
}

type AgentLogStringField = (typeof AGENT_LOG_STRING_FIELDS)[number];

interface NormalizedAgentLogEntry {
  timestamp?: number | string;
  level?: string;
  component?: string;
  msg?: string;
  message?: string;
  displayTimestamp: string;
}

interface AgentStatsBucket {
  total: number;
  running: number;
  updatesAvailable: number;
  imageFingerprints: Set<string>;
}

function createEmptyStatsBucket(): AgentStatsBucket {
  return {
    total: 0,
    running: 0,
    updatesAvailable: 0,
    imageFingerprints: new Set<string>(),
  };
}

/**
 * Build per-agent container stats in a single pass over the container
 * store. Replaces the previous O(agents × containers) pattern (full clone +
 * per-agent group + 3 `.filter()` passes) — see #301.
 */
function buildStatsByAgent(agentNames: string[]): Map<string, AgentStatsBucket> {
  const statsByAgent = new Map<string, AgentStatsBucket>();
  for (const name of agentNames) {
    statsByAgent.set(name, createEmptyStatsBucket());
  }
  for (const container of storeContainer.getContainersRaw({})) {
    if (typeof container.agent !== 'string') {
      continue;
    }
    const bucket = statsByAgent.get(container.agent);
    if (!bucket) {
      continue;
    }
    bucket.total += 1;
    if (String(container.status ?? '').toLowerCase() === 'running') {
      bucket.running += 1;
    }
    if (container.updateAvailable === true) {
      bucket.updatesAvailable += 1;
    }
    const imageKey = container.image?.id ?? container.image?.name ?? container.id;
    if (typeof imageKey === 'string' && imageKey !== '') {
      bucket.imageFingerprints.add(imageKey);
    }
  }
  return statsByAgent;
}

function getValidatedLogLevel(level: unknown): string | undefined | null {
  if (level == null) {
    return undefined;
  }
  if (typeof level !== 'string') {
    return null;
  }
  const normalizedLevel = level.toLowerCase();
  if (!ALLOWED_LOG_LEVELS.has(normalizedLevel)) {
    return null;
  }
  return normalizedLevel;
}

function getValidatedLogComponent(component: unknown): string | undefined | null {
  if (component == null) {
    return undefined;
  }
  if (typeof component !== 'string') {
    return null;
  }
  if (!SAFE_LOG_COMPONENT_PATTERN.test(component)) {
    return null;
  }
  return component;
}

function getOwnAgentLogValue(logEntry: Record<string, unknown>, field: string): unknown {
  return Object.hasOwn(logEntry, field) ? logEntry[field] : undefined;
}

function getOwnAgentLogString(
  logEntry: Record<string, unknown>,
  field: AgentLogStringField | 'displayTimestamp',
): string | undefined {
  const value = getOwnAgentLogValue(logEntry, field);
  return typeof value === 'string' ? value : undefined;
}

function getOwnAgentLogTimestamp(logEntry: Record<string, unknown>): number | string | undefined {
  const value = getOwnAgentLogValue(logEntry, 'timestamp');
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  return typeof value === 'string' ? value : undefined;
}

function normalizeAgentLogEntry(entry: unknown) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return entry;
  }

  const logEntry = entry as Record<string, unknown>;
  const normalizedEntry: NormalizedAgentLogEntry = {
    displayTimestamp: '-',
  };
  const timestamp = getOwnAgentLogTimestamp(logEntry);
  if (timestamp !== undefined) {
    normalizedEntry.timestamp = timestamp;
  }

  for (const field of AGENT_LOG_STRING_FIELDS) {
    const value = getOwnAgentLogString(logEntry, field);
    if (value !== undefined) {
      normalizedEntry[field] = value;
    }
  }

  const displayTimestamp = getOwnAgentLogString(logEntry, 'displayTimestamp');
  normalizedEntry.displayTimestamp =
    displayTimestamp && displayTimestamp.trim().length > 0
      ? displayTimestamp
      : formatLogDisplayTimestamp(timestamp);

  return normalizedEntry;
}

function normalizeAgentLogEntries(entries: unknown) {
  if (!Array.isArray(entries)) {
    return entries;
  }
  return entries.map((entry) => normalizeAgentLogEntry(entry));
}

function getAgentsList(req: Request, res: Response) {
  const agents = getAgents();
  const statsByAgent = buildStatsByAgent(agents.map((agent) => agent.name));
  const safeAgents = agents.map((agent) => {
    const bucket = statsByAgent.get(agent.name) ?? createEmptyStatsBucket();
    const stopped = Math.max(bucket.total - bucket.running, 0);
    return {
      name: agent.name,
      host: agent.config.host,
      port: agent.config.port,
      connected: agent.isConnected,
      version: agent.info?.version,
      os: agent.info?.os,
      arch: agent.info?.arch,
      cpus: agent.info?.cpus,
      memoryGb: agent.info?.memoryGb,
      uptimeSeconds: agent.info?.uptimeSeconds,
      lastSeen: agent.info?.lastSeen,
      logLevel: agent.info?.logLevel,
      pollInterval: agent.info?.pollInterval,
      containers: {
        total: bucket.total,
        running: bucket.running,
        stopped,
        updatesAvailable: bucket.updatesAvailable,
      },
      images: bucket.imageFingerprints.size,
    };
  });
  res.status(200).json({
    data: safeAgents,
    total: safeAgents.length,
  });
}

async function getAgentLogEntries(
  req: Request<AgentLogEntriesRequestParams, unknown, unknown, AgentLogEntriesRequestQuery>,
  res: Response,
) {
  const agent = getAgent(req.params.name);
  if (!agent) {
    sendErrorResponse(res, 404, 'Agent not found');
    return;
  }
  if (!agent.isConnected) {
    sendErrorResponse(res, 503, 'Agent is not connected');
    return;
  }
  try {
    const level = getValidatedLogLevel(req.query.level);
    if (level === null) {
      sendErrorResponse(res, 400, 'Invalid level query parameter');
      return;
    }

    const component = getValidatedLogComponent(req.query.component);
    if (component === null) {
      sendErrorResponse(res, 400, 'Invalid component query parameter');
      return;
    }

    const tail = req.query.tail ? Number.parseInt(req.query.tail, 10) : undefined;
    const since = req.query.since ? Number.parseInt(req.query.since, 10) : undefined;
    const entries = await agent.getLogEntries({ level, component, tail, since });
    res.json(normalizeAgentLogEntries(entries));
  } catch (error: unknown) {
    sendErrorResponse(res, 502, AGENT_LOG_FETCH_ERROR_MESSAGE);
  }
}

export function init() {
  router.get('/', getAgentsList);
  router.get('/:name/log/entries', getAgentLogEntries);
  return router;
}
