import express from 'express';
import { getAgents } from '../agent';

const router = express.Router();

function getAgentsList(req, res) {
    const agents = getAgents();
    const safeAgents = agents.map((agent) => ({
        name: agent.name,
        host: agent.config.host,
        port: agent.config.port,
        connected: agent.isConnected,
    }));
    res.json(safeAgents);
}

export function init() {
    router.get('/', getAgentsList);
    return router;
}
