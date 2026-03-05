import express from 'express';
import { getAgent, getAgents } from '../agent/index.js';
import type { Container } from '../model/container.js';
import * as storeContainer from '../store/container.js';

const router = express.Router();
const ALLOWED_LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
const SAFE_LOG_COMPONENT_PATTERN = /^[a-zA-Z0-9._-]+$/;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return String(error);
}

function getAgentContainerStats(agentName: string) {
  const containers: Container[] = storeContainer.getContainers({ agent: agentName });
  const running = containers.filter(
    (container: Container) => String(container.status ?? '').toLowerCase() === 'running',
  ).length;
  const total = containers.length;
  const images = new Set(
    containers.map(
      (container: Container) => container.image?.id ?? container.image?.name ?? container.id,
    ),
  ).size;
  return {
    containers: {
      total,
      running,
      stopped: Math.max(total - running, 0),
    },
    images,
  };
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

function getAgentsList(req, res) {
  const agents = getAgents();
  const safeAgents = agents.map((agent) => {
    const stats = getAgentContainerStats(agent.name);
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
      ...stats,
    };
  });
  res.json(safeAgents);
}

async function getAgentLogEntries(req, res) {
  const agent = getAgent(req.params.name);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  if (!agent.isConnected) {
    return res.status(503).json({ error: 'Agent is not connected' });
  }
  try {
    const level = getValidatedLogLevel(req.query.level);
    if (level === null) {
      return res.status(400).json({ error: 'Invalid level query parameter' });
    }

    const component = getValidatedLogComponent(req.query.component);
    if (component === null) {
      return res.status(400).json({ error: 'Invalid component query parameter' });
    }

    const tail = req.query.tail ? Number.parseInt(req.query.tail as string, 10) : undefined;
    const since = req.query.since ? Number.parseInt(req.query.since as string, 10) : undefined;
    const entries = await agent.getLogEntries({ level, component, tail, since });
    res.json(entries);
  } catch (error: unknown) {
    res.status(502).json({ error: `Failed to fetch logs from agent: ${getErrorMessage(error)}` });
  }
}

export function init() {
  router.get('/', getAgentsList);
  router.get('/:name/log/entries', getAgentLogEntries);
  return router;
}
