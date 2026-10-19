import { randomBytes, timingSafeEqual } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { DockerApiProxyResponse } from './AgentClient.js';

const DEFAULT_MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;

const HOP_BY_HOP_HEADERS = new Set([
  'authorization',
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

interface PortwingDockerRequester {
  requestDockerApi(
    method: string,
    target: string,
    headers: Record<string, string>,
    body?: Buffer,
  ): Promise<DockerApiProxyResponse>;
}

interface PortwingDockerBridgeOptions {
  maxRequestBodyBytes?: number;
}

export interface PortwingDockerBridgeEndpoint {
  baseUrl: string;
  authorization: string;
  host: '127.0.0.1';
  port: number;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function requestHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (HOP_BY_HOP_HEADERS.has(name) || value === undefined) {
      continue;
    }
    headers[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return headers;
}

function copyResponseHeaders(res: ServerResponse, headers: Record<string, string>): void {
  for (const [name, value] of Object.entries(headers)) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      res.setHeader(name, value);
    }
  }
}

type PortwingTransportFailureReason =
  | 'timeout'
  | 'agent-unreachable'
  | 'bad-upstream-response'
  | 'transport-failed';

const UNREACHABLE_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ERR_NETWORK',
]);

const BAD_RESPONSE_ERROR_CODES = new Set(['ERR_BAD_RESPONSE', 'ERR_FR_MAX_BODY_LENGTH_EXCEEDED']);

function errorCodes(error: unknown): string[] {
  const codes: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current && typeof current === 'object'; depth += 1) {
    const { code, cause } = current as { code?: unknown; cause?: unknown };
    if (typeof code === 'string') {
      codes.push(code);
    }
    current = cause;
  }
  return codes;
}

function classifyTransportError(error: unknown): PortwingTransportFailureReason {
  const message = error instanceof Error ? error.message : '';
  const codes = errorCodes(error);
  if (
    /^Malformed Docker API response|^Invalid upstream status|maxContentLength/i.test(message) ||
    codes.some((code) => BAD_RESPONSE_ERROR_CODES.has(code))
  ) {
    return 'bad-upstream-response';
  }
  if (codes.includes('ECONNABORTED') || /timeout|timed out/i.test(message)) {
    return 'timeout';
  }
  if (
    codes.some((code) => UNREACHABLE_ERROR_CODES.has(code)) ||
    /connection closed/i.test(message)
  ) {
    return 'agent-unreachable';
  }
  return 'transport-failed';
}

export class PortwingDockerBridge {
  private readonly authorization: string;
  private readonly maxRequestBodyBytes: number;
  private readonly sockets = new Set<Socket>();
  private server?: http.Server;
  private endpoint?: PortwingDockerBridgeEndpoint;

  constructor(
    private readonly requester: PortwingDockerRequester,
    options: PortwingDockerBridgeOptions = {},
  ) {
    this.authorization = `Bearer ${randomBytes(32).toString('base64url')}`;
    this.maxRequestBodyBytes = options.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES;
  }

  async start(): Promise<PortwingDockerBridgeEndpoint> {
    if (this.endpoint) {
      return this.endpoint;
    }
    const server = http.createServer((req, res) => {
      void this.handle(req, res).catch(() => {
        res.destroy();
      });
    });
    server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
    });
    this.server = server;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once('error', onError);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', onError);
        resolve();
      });
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      await this.stop();
      throw new Error('Unable to determine Portwing Docker bridge address');
    }
    this.endpoint = {
      baseUrl: `http://127.0.0.1:${address.port}`,
      authorization: this.authorization,
      host: '127.0.0.1',
      port: address.port,
    };
    return this.endpoint;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.endpoint = undefined;
    if (!server) {
      return;
    }
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private async readBody(req: IncomingMessage): Promise<Buffer | undefined> {
    const chunks: Buffer[] = [];
    let total = 0;
    let oversized = false;
    for await (const rawChunk of req) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      total += chunk.length;
      if (total > this.maxRequestBodyBytes) {
        oversized = true;
        continue;
      }
      chunks.push(chunk);
    }
    if (oversized) {
      return undefined;
    }
    return chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks, total);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!safeEqual(req.headers.authorization ?? '', this.authorization)) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Unauthorized');
      return;
    }

    const body = await this.readBody(req);
    if (body === undefined) {
      res.writeHead(413, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Docker API request body exceeds the bridge limit');
      return;
    }

    try {
      const response = await this.requester.requestDockerApi(
        req.method ?? 'GET',
        req.url ?? '/',
        requestHeaders(req),
        body.length > 0 ? body : undefined,
      );
      if (
        !Number.isInteger(response.statusCode) ||
        response.statusCode < 100 ||
        response.statusCode > 599
      ) {
        throw new Error('Invalid upstream status');
      }
      copyResponseHeaders(res, response.headers);
      res.statusCode = response.statusCode;
      res.setHeader('content-length', String(response.body.length));
      res.end(response.body);
    } catch (error: unknown) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      // The JSON body lets docker-modem surface `reason` on the thrown error
      // (`error.json.reason`) so callers can tell a slow daemon from a dead agent.
      const reason = classifyTransportError(error);
      const payload = JSON.stringify({ message: 'Portwing Docker transport failed', reason });
      res.writeHead(reason === 'timeout' ? 504 : 502, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(Buffer.byteLength(payload)),
      });
      res.end(payload);
    }
  }
}
