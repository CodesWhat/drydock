import express, { type Request, type Response } from 'express';
import { getAgent, getAgents } from '../agent/index.js';
import type { Container } from '../model/container.js';
import * as storeContainer from '../store/container.js';
import { getContainerStatusSummary } from '../util/container-summary.js';
import { sendErrorResponse } from './error-response.js';

const router = express.Router();
const ALLOWED_LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
const SAFE_LOG_COMPONENT_PATTERN = /^[a-zA-Z0-9._-]+$/;
const AGENT_LOG_FETCH_ERROR_MESSAGE = 'Failed to fetch logs from agent';

interface AgentLogEntriesRequestParams {
  name: string;
}

interface AgentLogEntriesRequestQuery {
  level?: string;
  component?: string;
  tail?: string;
  since?: string;
}

function getAgentContainerStats(containers: Container[]) {
  const containerStatus = getContainerStatusSummary(containers);
  const images = new Set(
    containers.map(
      (container: Container) => container.image?.id ?? container.image?.name ?? container.id,
    ),
  ).size;
  return {
    containers: containerStatus,
    images,
  };
}

function groupContainersByAgent(containers: Container[]) {
  const containersByAgent = new Map<string, Container[]>();
  for (const container of containers) {
    if (typeof container.agent !== 'string') {
      continue;
    }
    if (!containersByAgent.has(container.agent)) {
      containersByAgent.set(container.agent, []);
    }
    containersByAgent.get(container.agent)?.push(container);
  }
  return containersByAgent;
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

function getAgentsList(req: Request, res: Response) {
  const agents = getAgents();
  const containersByAgent = groupContainersByAgent(storeContainer.getContainers());
  const safeAgents = agents.map((agent) => {
    const stats = getAgentContainerStats(containersByAgent.get(agent.name) ?? []);
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
    res.json(entries);
  } catch (error: unknown) {
    sendErrorResponse(res, 502, AGENT_LOG_FETCH_ERROR_MESSAGE);
  }
}

export function init() {
  router.get('/', getAgentsList);
  router.get('/:name/log/entries', getAgentLogEntries);
  return router;
}
