import { Request, Response } from 'express';
import logger from '../../log';
import * as event from '../../event';
import { Container } from '../../model/container';
import { getVersion } from '../../configuration';

const log = logger.child({ component: 'agent-api-event' });

interface SseClient {
    id: number;
    res: Response;
}

// SSE Clients
let sseClients: SseClient[] = [];

/**
 * Send SSE event to all clients.
 * @param eventName
 * @param data
 */
function sendSseEvent(eventName: string, data: any) {
    const message = {
        type: eventName,
        data: data,
    };
    const payload = JSON.stringify(message);
    sseClients.forEach((client) => {
        client.res.write(`data: ${payload}\n\n`);
    });
}

/**
 * Subscribe to Events (SSE).
 */
export function subscribeEvents(req: Request, res: Response) {
    log.info(`Controller WUD with ip ${req.ip} connected.`);

    const headers = {
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
    };
    res.writeHead(200, headers);

    const client: SseClient = {
        id: Date.now(),
        res,
    };
    sseClients.push(client);

    // Send Welcome / Ack
    const ackMessage = {
        type: 'wud:ack',
        data: { version: getVersion() },
    };
    client.res.write(`data: ${JSON.stringify(ackMessage)}\n\n`);

    req.on('close', () => {
        log.info(`Controller WUD with ip ${req.ip} disconnected.`);
        sseClients = sseClients.filter((c) => c.id !== client.id);
    });
}

/**
 * Initialize event listeners.
 */
export function initEvents() {
    event.registerContainerAdded((container: Container) =>
        sendSseEvent('wud:container-added', container),
    );
    event.registerContainerUpdated((container: Container) =>
        sendSseEvent('wud:container-updated', container),
    );
    event.registerContainerRemoved((container: Container) =>
        sendSseEvent('wud:container-removed', { id: container.id }),
    );
}
