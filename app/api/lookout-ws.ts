/**
 * Lookout/1.0 WebSocket gateway.
 *
 * Accepts edge agent connections at /api/lookout/ws (or /api/v1/lookout/ws).
 * Auth is entirely in the first WS frame (Ed25519 hello); no session cookie required.
 *
 * DrydockCompat 1.4.0 is the level advertised by the lookout client; the doc
 * reference to 1.5.x reflects pre-release planning and has no bearing on the
 * wire protocol implemented here.
 */
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer } from 'ws';
import { AgentClient } from '../agent/AgentClient.js';
import {
  EdgeAgentAdapter,
  type HelloMessage,
  type WebSocketLike,
} from '../agent/EdgeAgentAdapter.js';
import { getAgent } from '../agent/manager.js';
import { getServerConfiguration } from '../configuration/index.js';
import logger from '../log/index.js';
import * as agentKeys from '../store/agent-keys.js';
import { getErrorMessage } from '../util/error.js';
import {
  getDefaultRateLimitKey,
  isOriginAllowed,
  type UpgradeRequest,
  writeUpgradeError,
} from './ws-upgrade-utils.js';

const log = logger.child({ component: 'lookout-ws' });

// Matches /api/lookout/ws and /api/v1/lookout/ws — the versioned alias is free.
// The lookout client dials cfg.DrydockURL + "/api/lookout/ws" so the primary
// match is the unversioned path.
export const LOOKOUT_WS_ROUTE_PATTERN = /^\/api(?:\/v1)?\/lookout\/ws$/;

const PROTOCOL_STRING = 'lookout/1.0';
const SERVER_COMPAT_LEVEL = '1.4';
const HELLO_TIMEOUT_MS = 30_000;
const NONCE_PATTERN = /^[0-9a-f]{32}$/;
// Key IDs are hex(SHA-256(raw32Bytes)[:8]) → exactly 16 lowercase hex chars.
const KEY_ID_PATTERN = /^[0-9a-f]{16}$/;
const MAX_CLOCK_SKEW_SECONDS = 60;
const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024; // 16 MB — matches lookout conn.SetReadLimit

// SHA-256 of empty string — the WebSocket upgrade has no body.
const EMPTY_BODY_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// Ed25519 SubjectPublicKeyInfo header (RFC 5480, 12 bytes).
// Prepended to raw 32-byte key bytes to form a valid SPKI DER blob that
// Node.js crypto.createPublicKey accepts.  The header is constant for all
// Ed25519 keys — only the trailing 32 bytes vary.
const ED25519_SPKI_HEADER = Buffer.from('302a300506032b6570032100', 'hex');

// Live-session registry: pubKeyId → Set of WebSocket connections that have
// completed a successful hello under that key.  Used by DELETE /keys/:keyId
// to disconnect all live sessions immediately on revocation.
const liveSessionsByKeyId = new Map<string, Set<WebSocketLike>>();

// Global nonce cache: nonce → Unix second when accepted.
// NOT per-connection — prevents replay across connections.
// In clustered deployments nonces are not shared; see risk note in design doc.
//
// Security note: the cache is shared across all key IDs.  A single authenticated
// principal could legitimately fill the pool (10,000 entries × 120 s window ≈ 83/s).
// The admission check below (NONCE_ADMISSION_PER_KEY_PER_WINDOW) provides a
// per-key rate limit that makes sustained pool-exhaustion attacks impractical;
// adjust the constant if the expected burst rate of legitimate agents rises above it.
const nonceCache = new Map<string, number>();
// Per-key nonce admission tracking: keyId → count of nonces admitted in the current window.
// Evicted alongside the main cache during periodic pruning.
const noncesPerKey = new Map<string, number>();
// Maximum nonces a single key may seed into the global cache within one clock-skew window.
// 200 → comfortable headroom for burst reconnects; attackers need 50× more to fill the pool.
const NONCE_ADMISSION_PER_KEY_PER_WINDOW = 200;
let noncePruneInterval: ReturnType<typeof setInterval> | undefined;

// In-flight agent registrations: agentName is added here before welcome is sent
// and removed after activate() returns (or if welcome send fails).  This closes
// the TOCTOU window between the getAgent() duplicate-check and the addAgent()
// call inside EdgeAgentAdapter.activate() — concurrent hellos with the same
// agentId will hit this Set rather than both slipping through.
const inFlightAgents = new Set<string>();

function startNoncePruning(): void {
  if (noncePruneInterval !== undefined) {
    return;
  }
  noncePruneInterval = setInterval(() => {
    const now = Math.floor(Date.now() / 1000);
    for (const [nonce, ts] of nonceCache.entries()) {
      if (now - ts > MAX_CLOCK_SKEW_SECONDS * 2) {
        nonceCache.delete(nonce);
      }
    }
    // Reset per-key admission counters each pruning cycle (every 60 s).
    noncesPerKey.clear();
  }, 60_000);
  /* v8 ignore next */
  if (typeof noncePruneInterval.unref === 'function') {
    noncePruneInterval.unref();
  }
}

/** Exposed for tests to reset global state. */
export function clearNonceCacheForTesting(): void {
  nonceCache.clear();
  noncesPerKey.clear();
  inFlightAgents.clear();
  liveSessionsByKeyId.clear();
  if (noncePruneInterval !== undefined) {
    clearInterval(noncePruneInterval);
    noncePruneInterval = undefined;
  }
}

/** Exposed for tests to reset the live-session registry. */
export function clearLiveSessionsForTesting(): void {
  liveSessionsByKeyId.clear();
}

/**
 * Disconnect all live WebSocket sessions authenticated under the given keyId.
 * Sends an 'unknown-key' error frame and closes with code 1008 ('key revoked').
 * Returns the number of connections closed.
 */
export function disconnectByKeyId(keyId: string): number {
  const sessions = liveSessionsByKeyId.get(keyId);
  if (!sessions || sessions.size === 0) {
    return 0;
  }
  let count = 0;
  for (const ws of sessions) {
    sendErrorAndClose(ws, 'unknown-key', 'key revoked', 1008);
    count++;
  }
  liveSessionsByKeyId.delete(keyId);
  return count;
}

/** Exposed for tests to pre-fill the nonce cache (e.g. to test the >10,000 eviction path). */
export function fillNonceCacheForTesting(nonces: Map<string, number>): void {
  for (const [k, v] of nonces) {
    nonceCache.set(k, v);
  }
}

/** Exposed for tests to set per-key nonce admission counters. */
export function fillNoncesPerKeyForTesting(perKey: Map<string, number>): void {
  for (const [k, v] of perKey) {
    noncesPerKey.set(k, v);
  }
}

function sendErrorAndClose(
  ws: WebSocketLike,
  code: string,
  message: string,
  closeCode: number,
): void {
  try {
    ws.send(JSON.stringify({ type: 'error', data: { message, code } }));
  } catch {
    // best effort
  }
  ws.close(closeCode, code);
}

// Package version sourced at module init time from the app package.json.
// This is the server-side version operators can verify externally.
let _drydockVersion: string | undefined;
function drydockVersion(): string {
  if (_drydockVersion !== undefined) {
    return _drydockVersion;
  }
  // Populated by injectDrydockVersionForTesting() in tests, or from package.json at runtime.
  _drydockVersion = '1.5.0';
  return _drydockVersion;
}

/** Exposed for tests to override the version string. */
export function injectDrydockVersionForTesting(version: string): void {
  _drydockVersion = version;
}

/**
 * Verify the Ed25519 signature in the hello frame.
 * Canonical message: METHOD\nPATH\nBODY_HASH_HEX\nUNIX_TIMESTAMP_DECIMAL\nNONCE
 *
 * PATH is intentionally hard-coded to '/api/lookout/ws' regardless of whether the
 * agent connected via the versioned alias '/api/v1/lookout/ws'.  Both paths are
 * signature-equivalent by design: the lookout client always signs over the canonical
 * unversioned path so that adding or removing the /v1 alias never forces a key rotation.
 * If this equivalence is ever removed, agents MUST be updated to sign the actual path.
 */
function verifyHelloSignature(
  pubkeyBase64: string,
  timestamp: number,
  nonce: string,
  signatureBase64url: string,
): boolean {
  const canonical = Buffer.from(
    ['GET', '/api/lookout/ws', EMPTY_BODY_HASH, String(timestamp), nonce].join('\n'),
  );
  // Registry stores raw 32-byte Ed25519 key as base64. Node.js crypto.verify
  // does not accept format:'raw' — reconstruct the full SPKI DER by prepending
  // the constant Ed25519 ASN.1 header before calling createPublicKey.
  const rawKeyBuf = Buffer.from(pubkeyBase64, 'base64');
  const spkiDer = Buffer.concat([ED25519_SPKI_HEADER, rawKeyBuf]);
  const pubKey = createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
  const sigBuf = Buffer.from(signatureBase64url, 'base64url');

  return cryptoVerify(null, canonical, pubKey, sigBuf);
}

interface LookoutWsGatewayDependencies {
  webSocketServer?: {
    handleUpgrade: (
      request: IncomingMessage,
      socket: Socket,
      head: Buffer,
      callback: (ws: WebSocketLike) => void,
    ) => void;
  };
  isRateLimited?: (key: string) => boolean;
  serverConfiguration?: Record<string, unknown>;
  getAgentKeys?: typeof agentKeys;
}

export function createLookoutWsGateway(dependencies: LookoutWsGatewayDependencies = {}) {
  const {
    webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES }),
    /* v8 ignore next -- Buffer.from('…','base64') never throws; default lambda is defensive */
    isRateLimited = () => false,
    serverConfiguration = getServerConfiguration() as Record<string, unknown>,
    getAgentKeys = agentKeys,
  } = dependencies;

  startNoncePruning();

  return {
    handleUpgrade(request: IncomingMessage, socket: Socket, head: Buffer): void {
      // Step 1: URL pattern match
      const url = request.url ?? '';
      let pathname: string;
      try {
        pathname = new URL(url, 'http://localhost').pathname;
        /* v8 ignore start */
      } catch {
        return;
      }
      /* v8 ignore stop */
      if (!LOOKOUT_WS_ROUTE_PATTERN.test(pathname)) {
        return;
      }

      // Step 2: Origin check (CSRF guard)
      if (!isOriginAllowed(request, serverConfiguration)) {
        writeUpgradeError(socket, 403, 'Forbidden');
        return;
      }

      // Step 3: Rate limit
      if (isRateLimited(getDefaultRateLimitKey(request as UpgradeRequest))) {
        writeUpgradeError(socket, 429, 'Too Many Requests');
        return;
      }

      // Upgrade the HTTP connection to WebSocket
      webSocketServer.handleUpgrade(request, socket, head, (ws: WebSocketLike) => {
        handleConnection(ws, getAgentKeys, serverConfiguration);
      });
    },
  };
}

function handleConnection(
  ws: WebSocketLike,
  keyStore: typeof agentKeys,
  serverConfiguration: Record<string, unknown>,
): void {
  // Hello timeout: close if no hello arrives within 30s
  const helloTimer = setTimeout(() => {
    ws.close(1008, 'hello timeout');
  }, HELLO_TIMEOUT_MS);

  let helloHandled = false;

  // Clear the hello timer if the client disconnects or errors before sending hello,
  // preventing a ~30s timer leak.
  ws.on('close', () => clearTimeout(helloTimer));
  ws.on('error', () => clearTimeout(helloTimer));

  ws.on('message', (raw: unknown) => {
    if (helloHandled) {
      // Post-hello messages are routed by EdgeAgentAdapter
      return;
    }
    helloHandled = true;
    clearTimeout(helloTimer);
    void processHello(ws, raw, keyStore, serverConfiguration);
  });
}

async function processHello(
  ws: WebSocketLike,
  raw: unknown,
  keyStore: typeof agentKeys,
  serverConfiguration: Record<string, unknown>,
): Promise<void> {
  // Step 1: Parse envelope
  let envelope: { type?: unknown; data?: Record<string, unknown> };
  try {
    envelope = JSON.parse(String(raw)) as { type?: unknown; data?: Record<string, unknown> };
  } catch {
    sendErrorAndClose(ws, 'parse-error', 'Failed to parse hello frame', 1008);
    return;
  }

  // Step 2: Expect type === 'hello'
  if (envelope.type !== 'hello') {
    sendErrorAndClose(ws, 'expected-hello', `Expected hello, got ${String(envelope.type)}`, 1008);
    return;
  }

  const data = envelope.data;
  if (!data || typeof data !== 'object') {
    sendErrorAndClose(ws, 'parse-error', 'Missing hello data', 1008);
    return;
  }

  const hello = data as unknown as HelloMessage;

  // Step 2a: Validate agentId before it is used in logs or as a Map key.
  // Must be a non-empty string of safe characters (alphanumeric, hyphens, underscores)
  // with a reasonable upper bound; rejects numbers, objects, null, and injection strings.
  if (
    typeof hello.agentId !== 'string' ||
    hello.agentId.length === 0 ||
    hello.agentId.length > 64 ||
    !/^[a-zA-Z0-9_-]+$/.test(hello.agentId)
  ) {
    sendErrorAndClose(ws, 'parse-error', 'Invalid agentId', 1008);
    return;
  }

  // Step 3: Protocol check
  if (hello.protocol !== PROTOCOL_STRING) {
    sendErrorAndClose(
      ws,
      'protocol-mismatch',
      `Unsupported protocol: ${String(hello.protocol)}. Expected ${PROTOCOL_STRING}`,
      1008,
    );
    return;
  }

  // Log version info for audit trail
  const drydockCompat = hello.drydockCompat;
  if (!drydockCompat) {
    log.warn('Edge agent hello has no drydockCompat field (old client?)');
  } else {
    const majorVersion = parseInt(drydockCompat.split('.')[0], 10);
    const serverMajor = parseInt(SERVER_COMPAT_LEVEL.split('.')[0], 10);
    if (majorVersion > serverMajor) {
      log.warn(
        `Edge agent requires drydockCompat ${drydockCompat} but server implements ${SERVER_COMPAT_LEVEL}`,
      );
    }
  }
  log.debug(
    `Hello from agent ${hello.agentId} (version=${hello.version}, protocol=${hello.protocol}, drydockCompat=${hello.drydockCompat ?? 'absent'})`,
  );

  // Step 4: Auth mode detection
  const hasEd25519 =
    typeof hello.pubKeyId === 'string' &&
    typeof hello.timestamp === 'number' &&
    typeof hello.nonce === 'string' &&
    typeof hello.signature === 'string';

  const hasTokenHash = typeof hello.tokenHash === 'string' && hello.tokenHash.length > 0;

  if (!hasEd25519 && !hasTokenHash) {
    sendErrorAndClose(ws, 'no-auth', 'No authentication fields present', 1008);
    return;
  }

  if (!hasEd25519) {
    // Token-hash-only connections are rejected at the edge endpoint: this server
    // has no shared TOKEN secret to compare against — the Ed25519 public-key
    // registry is the sole auth mechanism here.  Agents without PRIVATE_KEY_FILE
    // must obtain a key or use the non-edge SSE path instead.
    sendErrorAndClose(
      ws,
      'ed25519-required',
      'Ed25519 key auth required; token auth not supported on edge endpoint',
      1008,
    );
    return;
  }

  // Ed25519 mode
  const pubKeyId = hello.pubKeyId as string;
  const timestamp = hello.timestamp as number;
  const nonce = hello.nonce as string;
  const signature = hello.signature as string;

  // Reject unreasonably long signature strings before allocating a Buffer.
  // Ed25519 base64url signatures are exactly 86 chars; 200 is a generous ceiling.
  // This prevents a large Buffer.from() allocation from attacker-controlled input.
  if (signature.length > 200) {
    sendErrorAndClose(ws, 'bad-signature', 'Ed25519 signature verification failed', 1008);
    return;
  }

  // Step 4a: Validate keyId format before passing it anywhere (DB or logs).
  // keyId must be exactly 16 lowercase hex chars; reject anything else to prevent
  // log injection, arbitrary-length DB queries, and key-oracle probing.
  if (!KEY_ID_PATTERN.test(pubKeyId)) {
    sendErrorAndClose(ws, 'unknown-key', 'Unknown or revoked key', 1008);
    return;
  }

  // Step 5: Key lookup — generic error message to avoid key-existence oracle.
  const keyRecord = keyStore.getKey(pubKeyId);
  if (!keyRecord) {
    sendErrorAndClose(ws, 'unknown-key', 'Unknown or revoked key', 1008);
    return;
  }

  // Step 6: Timestamp skew
  // Guard against NaN/Infinity first: Math.abs(n - NaN) is NaN, which is not > anything,
  // so a NaN timestamp would silently bypass the skew window without this check.
  // Note: standard JSON never produces NaN/Infinity (they serialize as null, which fails
  // the typeof check in hasEd25519 above), so this branch is defense-in-depth for
  // non-JSON code paths and is intentionally left unreachable via the normal wire path.
  const nowSeconds = Math.floor(Date.now() / 1000);
  /* v8 ignore next */
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
    sendErrorAndClose(ws, 'timestamp-skew', 'Timestamp out of acceptable range', 1008);
    return;
  }

  // Step 7: Nonce format
  if (!NONCE_PATTERN.test(nonce)) {
    sendErrorAndClose(ws, 'bad-nonce', 'Nonce must be 32 lowercase hex chars', 1008);
    return;
  }

  // Step 8: Nonce replay — check presence only; do NOT commit until after sig verification.
  // Committing before verification would let an attacker exhaust the 10,000-entry nonce
  // pool with bad-signature hellos (one valid keyId × 10k unique nonces fills the cache).
  if (nonceCache.size > 10_000) {
    // Evict expired entries first
    for (const [n, ts] of nonceCache.entries()) {
      if (nowSeconds - ts > MAX_CLOCK_SKEW_SECONDS * 2) {
        nonceCache.delete(n);
      }
    }
    if (nonceCache.size > 10_000) {
      sendErrorAndClose(ws, 'replay', 'Nonce cache full; possible attack', 1008);
      return;
    }
  }
  if (nonceCache.has(nonce)) {
    sendErrorAndClose(ws, 'replay', 'Nonce already used', 1008);
    return;
  }

  // Step 9: Signature verify — must happen before nonce is committed.
  let signatureOk: boolean;
  try {
    signatureOk = verifyHelloSignature(keyRecord.pubkey, timestamp, nonce, signature);
  } catch (err: unknown) {
    log.error(`Ed25519 verify threw: ${getErrorMessage(err)}`);
    sendErrorAndClose(ws, 'internal-error', 'Signature verification failed', 1011);
    return;
  }

  if (!signatureOk) {
    sendErrorAndClose(ws, 'bad-signature', 'Ed25519 signature verification failed', 1008);
    return;
  }

  // Commit the nonce only after successful signature verification to prevent
  // pool exhaustion by unauthenticated callers.
  //
  // Per-key admission guard: cap how many nonces a single key may seed per pruning
  // window so that one legitimate-but-misbehaving agent cannot monopolise the shared pool.
  const keyNonceCount = (noncesPerKey.get(pubKeyId) ?? 0) + 1;
  if (keyNonceCount > NONCE_ADMISSION_PER_KEY_PER_WINDOW) {
    sendErrorAndClose(ws, 'rate-limited', 'Nonce admission limit reached for this key', 1008);
    return;
  }
  noncesPerKey.set(pubKeyId, keyNonceCount);
  nonceCache.set(nonce, nowSeconds);

  // Step 10: Prevent duplicate agent names — atomic check/reserve with inFlightAgents
  // so that concurrent hellos cannot both pass before either calls activate().
  const agentName = `lookout-edge-${hello.agentId}`;
  if (getAgent(agentName) || inFlightAgents.has(agentName)) {
    sendErrorAndClose(ws, 'agent-already-connected', `Agent ${agentName} already connected`, 1008);
    return;
  }
  inFlightAgents.add(agentName);

  // Step 11: Send WELCOME
  const pollInterval = 300;
  const welcome = {
    type: 'welcome',
    data: {
      pollInterval,
      config: {
        drydockVersion: drydockVersion(),
        supportedProtocols: PROTOCOL_STRING,
        serverCompatLevel: SERVER_COMPAT_LEVEL,
      },
    },
  };
  try {
    ws.send(JSON.stringify(welcome));
  } catch (err: unknown) {
    log.error(`Failed to send welcome to ${agentName}: ${getErrorMessage(err)}`);
    inFlightAgents.delete(agentName);
    return;
  }

  // Step 12: Create EdgeAgentAdapter and activate it
  const client = new AgentClient(agentName, {
    host: `http://edge-agent-placeholder-${hello.agentId}`,
    port: 0,
    secret: '',
  });
  client.info = {
    version: hello.version,
    pollInterval: String(pollInterval),
  };

  const adapter = new EdgeAgentAdapter(client, ws, hello, {
    pollInterval,
    agentId: hello.agentId,
    version: hello.version,
  });
  // activate() calls addAgent() — release the in-flight reservation immediately
  // after so the slot is held by the manager instead.
  adapter.activate();
  inFlightAgents.delete(agentName);

  // Register this session under pubKeyId so it can be disconnected on key revocation.
  const sessions = liveSessionsByKeyId.get(pubKeyId) ?? new Set<WebSocketLike>();
  sessions.add(ws);
  liveSessionsByKeyId.set(pubKeyId, sessions);

  // Deregister on disconnect so the Set doesn't grow unboundedly.
  const deregister = () => {
    const s = liveSessionsByKeyId.get(pubKeyId);
    if (s) {
      s.delete(ws);
      if (s.size === 0) {
        liveSessionsByKeyId.delete(pubKeyId);
      }
    }
  };
  ws.on('close', deregister);
  ws.on('error', deregister);

  log.info(
    `Edge agent connected: ${agentName} (version=${hello.version}, drydockCompat=${hello.drydockCompat ?? 'absent'})`,
  );
}

export function attachLookoutWsServer(options: {
  server: {
    on: (
      event: 'upgrade',
      listener: (request: IncomingMessage, socket: Socket, head: Buffer) => void,
    ) => void;
  };
  serverConfiguration?: Record<string, unknown>;
  isRateLimited?: (key: string) => boolean;
}) {
  const serverConfiguration =
    options.serverConfiguration ?? (getServerConfiguration() as Record<string, unknown>);

  const gateway = createLookoutWsGateway({
    isRateLimited: options.isRateLimited,
    serverConfiguration,
  });

  options.server.on('upgrade', (request, socket, head) => {
    gateway.handleUpgrade(request, socket, head);
  });

  return gateway;
}
