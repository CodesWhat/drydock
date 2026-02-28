import express from 'express';
import { getAgent, getAgents } from '../agent/index.js';
import * as storeContainer from '../store/container.js';

const router = express.Router();

function getAgentContainerStats(agentName: string) {
  const containers = storeContainer.getContainers({ agent: agentName });
  const running = containers.filter(
    (container: any) => String(container.status ?? '').toLowerCase() === 'running',
  ).length;
  const total = containers.length;
  const images = new Set(
    containers.map((container: any) => container.image?.id ?? container.image?.name ?? container.id),
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
    const level = req.query.level as string | undefined;
    const component = req.query.component as string | undefined;
    const tail = req.query.tail ? Number.parseInt(req.query.tail as string, 10) : undefined;
    const since = req.query.since ? Number.parseInt(req.query.since as string, 10) : undefined;
    const entries = await agent.getLogEntries({ level, component, tail, since });
    res.json(entries);
  } catch (e: any) {
    res.status(502).json({ error: `Failed to fetch logs from agent: ${e.message}` });
  }
}

export function init() {
  router.get('/', getAgentsList);
  router.get('/:name/log/entries', getAgentLogEntries);
  return router;
}
