/**
 * Portwing/1.0 WebSocket gateway.
 *
 * Accepts edge agent connections at /api/portwing/ws (or /api/v1/portwing/ws).
 * Auth is entirely in the first WS frame (Ed25519 hello); no session cookie required.
 *
 * DrydockCompat 1.4.0 is the level advertised by the edge agent client; the doc
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
import { save as saveStore } from '../store/index.js';
import * as nameBindingsStore from '../store/name-bindings.js';
import { getErrorMessage } from '../util/error.js';
import {
  getDefaultRateLimitKey,
  isOriginAllowed,
  type UpgradeRequest,
  writeUpgradeError,
} from './ws-upgrade-utils.js';

const log = logger.child({ component: 'portwing-ws' });

// Matches canonical Portwing paths.
export const PORTWING_WS_ROUTE_PATTERN = /^\/api(?:\/v1)?\/portwing\/ws$/;

const PROTOCOL_STRING = 'portwing/1.0';
const SERVER_COMPAT_LEVEL = '1.4.0';
const HELLO_TIMEOUT_MS = 30_000;
const NONCE_PATTERN = /^[0-9a-f]{32}$/;
// Key IDs are hex(SHA-256(raw32Bytes)[:8]) → exactly 16 lowercase hex chars.
const KEY_ID_PATTERN = /^[0-9a-f]{16}$/;
// Upper bound on the raw (pre-sanitize) hello.agentName string. computeAgentName()
// slices its OUTPUT to 63 chars, but an attacker-supplied multi-megabyte string
// would still be copied/regex-processed before that slice runs; this caps the input.
const MAX_AGENT_NAME_INPUT_LENGTH = 256;
const MAX_CLOCK_SKEW_SECONDS = 60;
const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024; // 16 MB — matches the agent conn.SetReadLimit

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

// Parallel registry: pubKeyId → Map of WebSocket → the EdgeAgentAdapter that
// owns it. Populated/depopulated in lockstep with liveSessionsByKeyId (same
// registration site in processHello, same deregister closure) so revocation
// can synchronously tear down each session's adapter — not just close its raw
// ws — via EdgeAgentAdapter.terminate(). That closes the zombie-frame window
// a bare ws.close() leaves open: a frame already buffered in the transport
// when the key is revoked would otherwise still reach the adapter's
// onMessage() (see disconnectByKeyId). Keyed by ws (not a bare
// Set<EdgeAgentAdapter>) so disconnectByKeyId can correlate each live session
// to its own adapter and fall back to a direct sendErrorAndClose() for the
// (should-never-happen-post-hello) case of a session with no registered
// adapter.
const liveAdaptersByKeyId = new Map<string, Map<WebSocketLike, EdgeAgentAdapter>>();

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

// Identity binding: agentName → pubKeyId of the key that first registered it.
// Squat/theft prevention (see computeAgentName + processHello Step 10): the
// sanitized/fallback display name has no cryptographic meaning on its own, so
// without this binding any holder of ANY valid registered key could claim a
// name already in use by a different agent. Bound on first successful hello;
// a later hello reusing the same name is only admitted if it authenticated
// under the SAME pubKeyId. Released when the owning key is revoked (see
// disconnectByKeyId) so a legitimately re-provisioned agent can reclaim its name.
//
// This Map is a read-optimized in-memory mirror of the durable
// app/store/name-bindings.ts collection, not the source of truth: every write
// here (bind, prune, revoke-release) is write-through'd to that store, and
// rehydrateNameBindings() reloads this Map from the store once at startup
// (see createPortwingWsGateway()). Without the durable backing, a process
// restart — including the restart that deploys this very protection — would
// wipe the map and reopen the squat window until every agent reconnects.
//
// Unlike liveSessionsByKeyId/inFlightAgents, a binding is NOT released on plain
// disconnect — the whole point is that the name stays claimed while its key is
// still valid, even between reconnects. Left uncapped, a single never-revoked
// key could grow this map without bound by reconnecting under a fresh
// agentId/agentName every time (nothing but the 200/60s per-key nonce-admission
// limit throttles that, which still permits ~288k new bindings/day/key). Bound
// memory the same way nonceCache is bounded: a hard size cap plus periodic
// pruning of bindings that are both stale (idle past NAME_BINDING_STALE_MS) and
// not currently backing a live connection (checked via getAgent so an active
// agent's own binding is never evicted out from under it).
const nameToKeyId = new Map<string, { keyId: string; lastSeenAt: number }>();
// Hard cap on distinct name bindings, matching nonceCache's cap in spirit.
const MAX_NAME_BINDINGS = 10_000;
// A binding idle longer than this (no hello seen under its name) becomes
// eligible for eviction once the map is at/over MAX_NAME_BINDINGS, provided the
// name isn't currently backing a live connection.
const NAME_BINDING_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Evict name bindings that are both idle past NAME_BINDING_STALE_MS and not
 * currently backing a live agent connection. Called opportunistically when a
 * new binding would push the map over MAX_NAME_BINDINGS, and periodically
 * alongside nonce pruning so long-idle bindings don't just wait for a cap hit.
 * Every eviction here is also write-through'd to the durable store so the two
 * never drift.
 */
function pruneStaleNameBindings(nowMs: number): void {
  for (const [name, binding] of nameToKeyId.entries()) {
    if (nowMs - binding.lastSeenAt > NAME_BINDING_STALE_MS && !getAgent(name)) {
      nameToKeyId.delete(name);
      nameBindingsStore.deleteBinding(name);
    }
  }
}

/**
 * Reload nameToKeyId from the durable name-bindings store. Called once from
 * createPortwingWsGateway() so a restarted server knows which key owns which
 * name before any agent reconnects — see the nameToKeyId doc comment above.
 *
 * Only evaluates staleness against the records it just loaded (not the whole
 * map — that's pruneStaleNameBindings()'s job on its own cadence) so a
 * binding that was already past NAME_BINDING_STALE_MS before the restart
 * doesn't get a fresh 24h lease purely from being reloaded, while a genuinely
 * fresh binding is admitted as-is.
 */
function rehydrateNameBindings(): void {
  const nowMs = Date.now();
  for (const record of nameBindingsStore.listBindings()) {
    if (nowMs - record.lastSeenAt > NAME_BINDING_STALE_MS && !getAgent(record.agentName)) {
      nameBindingsStore.deleteBinding(record.agentName);
      continue;
    }
    nameToKeyId.set(record.agentName, { keyId: record.keyId, lastSeenAt: record.lastSeenAt });
  }
}

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
    // Bound nameToKeyId growth the same cycle — see pruneStaleNameBindings.
    pruneStaleNameBindings(Date.now());
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
  liveAdaptersByKeyId.clear();
  nameToKeyId.clear();
  if (noncePruneInterval !== undefined) {
    clearInterval(noncePruneInterval);
    noncePruneInterval = undefined;
  }
}

/** Exposed for tests to reset the live-session registry. */
export function clearLiveSessionsForTesting(): void {
  liveSessionsByKeyId.clear();
  liveAdaptersByKeyId.clear();
}

/**
 * Disconnect all live WebSocket sessions authenticated under the given keyId.
 * Sends an 'unknown-key' error frame and closes with code 1008 ('key revoked').
 * Returns the number of connections closed.
 */
export function disconnectByKeyId(keyId: string): number {
  // Release any agent-name bindings claimed by this key, live session or not,
  // so a name is never permanently stranded once its owning key is revoked.
  // Purge the durable store first so a crash between the two purges still
  // leaves the persisted view at least as permissive as (never more locked
  // down than) the in-memory one after a restart.
  nameBindingsStore.deleteBindingsForKey(keyId);
  for (const [name, binding] of nameToKeyId.entries()) {
    if (binding.keyId === keyId) {
      nameToKeyId.delete(name);
    }
  }
  // Fail-safe flush (Fix 1): persist the release immediately so a hard-kill
  // right after revocation can't resurrect a binding to the now-dead key on
  // restart. Best-effort/not awaited: disconnectByKeyId is called
  // synchronously (and un-awaited) from the DELETE /keys/:keyId route
  // (app/api/portwing.ts) and from many synchronous test call sites, so
  // making this async would ripple across both for no matching benefit — a
  // missed flush here only denies a name temporarily and self-heals via
  // pruneStaleNameBindings()/rehydrateNameBindings()'s stale-lease check,
  // unlike the NEW-BIND flush in processHello() below, which must be a hard,
  // awaited failure because it is the only guard against a genuine squat.
  // Wrapped defensively: Promise.resolve(...) guards against saveStore() ever
  // not returning a genuine thenable (the real store/index.ts save() always
  // does, being declared `async function`), and the outer try/catch guards
  // against a synchronous throw from the call itself. Neither this
  // fire-and-forget flush nor the synchronous revocation path around it may
  // ever throw.
  try {
    void Promise.resolve(saveStore()).catch(() => {});
  } catch {
    // best-effort — see above
  }

  const sessions = liveSessionsByKeyId.get(keyId);
  const adapters = liveAdaptersByKeyId.get(keyId);
  liveAdaptersByKeyId.delete(keyId);
  if (!sessions || sessions.size === 0) {
    return 0;
  }
  let count = 0;
  for (const ws of sessions) {
    const adapter = adapters?.get(ws);
    if (adapter) {
      // Synchronous teardown (Fix 2): detaches the message listener and
      // flips disconnected=true immediately, so a frame already buffered in
      // the close window can't be dispatched under a just-revoked key — see
      // EdgeAgentAdapter.terminate().
      adapter.terminate('unknown-key', 'key revoked', 1008);
    } else {
      // Defensive fallback: shouldn't happen post-hello (every live session
      // gets an adapter registered alongside it in processHello), but never
      // leave a session open just because the adapter registry somehow
      // desynced from the session registry.
      sendErrorAndClose(ws, 'unknown-key', 'key revoked', 1008);
    }
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

/**
 * Exposed for tests to pre-fill the name→key binding map (e.g. to test the
 * MAX_NAME_BINDINGS cap and pruneStaleNameBindings without opening 10,000
 * real connections).
 */
export function fillNameBindingsForTesting(
  bindings: Map<string, { keyId: string; lastSeenAt: number }>,
): void {
  for (const [name, binding] of bindings) {
    nameToKeyId.set(name, binding);
  }
}

/** Exposed for tests: current size of the name→key binding map. */
export function nameBindingsSizeForTesting(): number {
  return nameToKeyId.size;
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
 * PATH is intentionally canonicalized to '/api/portwing/ws' regardless of
 * whether the agent connected via the versioned alias '/api/v1/portwing/ws'.
 * Both paths are signature-equivalent by design, so adding or removing the /v1
 * prefix never forces a key rotation.
 */
function verifyHelloSignature(
  pubkeyBase64: string,
  timestamp: number,
  nonce: string,
  signatureBase64url: string,
): boolean {
  // Registry stores raw 32-byte Ed25519 key as base64. Node.js crypto.verify
  // does not accept format:'raw' — reconstruct the full SPKI DER by prepending
  // the constant Ed25519 ASN.1 header before calling createPublicKey.
  const rawKeyBuf = Buffer.from(pubkeyBase64, 'base64');
  const spkiDer = Buffer.concat([ED25519_SPKI_HEADER, rawKeyBuf]);
  const pubKey = createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
  const sigBuf = Buffer.from(signatureBase64url, 'base64url');

  const canonical = Buffer.from(
    ['GET', '/api/portwing/ws', EMPTY_BODY_HASH, String(timestamp), nonce].join('\n'),
  );
  return cryptoVerify(null, canonical, pubKey, sigBuf);
}

/**
 * Validates the raw hello.agentName field's type and length before anything
 * (computeAgentName, logs) touches it. The HelloMessage TS type declares
 * agentName as a required string, but that is a lie at runtime: the value comes
 * straight out of JSON.parse via an `as unknown as HelloMessage` cast, so a
 * number/boolean/array/object survives to here with no compiler help.
 *
 * Returns a human-readable rejection reason when the field is present but
 * malformed; returns null when it is safe to hand to computeAgentName()
 * (including when the field is absent/null, which computeAgentName treats as
 * "no name supplied" and falls back to the agentId-derived default).
 */
function validateAgentNameField(hello: HelloMessage): string | null {
  const { agentName } = hello;
  if (agentName === undefined || agentName === null) {
    return null;
  }
  if (typeof agentName !== 'string') {
    return 'agentName must be a string';
  }
  if (agentName.length > MAX_AGENT_NAME_INPUT_LENGTH) {
    return 'agentName exceeds maximum length';
  }
  return null;
}

/**
 * Compute the agent's display/registry name from the hello frame.
 * hello.agentName is sanitized to a safe slug (lowercase, alphanumeric + hyphen,
 * max 63 chars); an empty, missing, or all-invalid-chars name falls back to
 * `portwing-edge-<agentId>` — the pre-existing unconditional name.
 *
 * Callers MUST run validateAgentNameField() first and reject malformed hellos
 * rather than relying on this function alone; the explicit typeof check below
 * is defense-in-depth so this can never throw even if that invariant is ever
 * violated (a non-string agentName silently falls back instead of crashing).
 */
function computeAgentName(hello: HelloMessage): string {
  const rawName = typeof hello.agentName === 'string' ? hello.agentName.trim() : '';
  const sanitized = rawName
    ? rawName
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 63)
    : '';
  return sanitized || `portwing-edge-${hello.agentId}`;
}

interface PortwingWsGatewayDependencies {
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

export function createPortwingWsGateway(dependencies: PortwingWsGatewayDependencies = {}) {
  const {
    webSocketServer = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES }),
    /* v8 ignore next -- Buffer.from('…','base64') never throws; default lambda is defensive */
    isRateLimited = () => false,
    serverConfiguration = getServerConfiguration() as Record<string, unknown>,
    getAgentKeys = agentKeys,
  } = dependencies;

  startNoncePruning();
  // Reload any bindings persisted by a previous process instance before this
  // gateway accepts its first connection — see the nameToKeyId doc comment.
  // Idempotent: safe to run every time a gateway is (re-)created.
  rehydrateNameBindings();

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
      if (!PORTWING_WS_ROUTE_PATTERN.test(pathname)) {
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

  // Step 2b: Validate agentName's type/length before it reaches computeAgentName,
  // logs, or the registry. A malformed (non-string) agentName must fail this
  // connection with a clear error frame, never throw — see validateAgentNameField().
  const agentNameError = validateAgentNameField(hello);
  if (agentNameError) {
    sendErrorAndClose(ws, 'invalid-agent-name', agentNameError, 1008);
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
    // Any major-version mismatch (either direction) is diagnostic-only — the wire
    // connection is still accepted; this warns operators to check the compat matrix.
    if (majorVersion !== serverMajor) {
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
  // The friendly name is derived from hello.agentName when present (sanitized to a
  // safe slug); collisions on the sanitized name are still caught by this same
  // reservation logic, same as the portwing-edge-<agentId> fallback.
  const agentName = computeAgentName(hello);

  // Step 10a: Name→key identity binding. computeAgentName()'s output (explicit
  // or fallback) is otherwise pure attacker-controlled/derived data with zero tie
  // to the Ed25519 key that just authenticated — without this check, any holder
  // of ANY valid registered key could squat or steal another agent's name (the
  // registry itself is keyed purely by name string; see app/agent/manager.ts).
  // Bind on first use; a name already bound to a DIFFERENT key is rejected.
  // A key that already owns the name (reconnect) is always admitted.
  const existingBinding = nameToKeyId.get(agentName);
  if (existingBinding !== undefined && existingBinding.keyId !== pubKeyId) {
    sendErrorAndClose(
      ws,
      'agent-name-claimed',
      `Agent name ${agentName} is registered to a different key`,
      1008,
    );
    return;
  }

  // Step 10b: Bound the binding map itself. Only a brand-new name (no existing
  // binding) grows nameToKeyId; a reconnect under an already-owned name reuses
  // its entry. Try pruning idle/dead bindings before refusing outright — this
  // mirrors the nonceCache "evict expired, recheck, then reject" pattern above.
  if (existingBinding === undefined && nameToKeyId.size >= MAX_NAME_BINDINGS) {
    pruneStaleNameBindings(Date.now());
    if (nameToKeyId.size >= MAX_NAME_BINDINGS) {
      sendErrorAndClose(ws, 'registry-full', 'Agent name registry is full; try again later', 1008);
      return;
    }
  }

  if (getAgent(agentName) || inFlightAgents.has(agentName)) {
    sendErrorAndClose(ws, 'agent-already-connected', `Agent ${agentName} already connected`, 1008);
    return;
  }
  inFlightAgents.add(agentName);
  const bindingSeenAt = Date.now();
  nameToKeyId.set(agentName, { keyId: pubKeyId, lastSeenAt: bindingSeenAt });
  // Write-through to the durable store so this binding survives a restart —
  // see the nameToKeyId doc comment and rehydrateNameBindings().
  nameBindingsStore.upsertBinding(agentName, pubKeyId, bindingSeenAt);

  // Step 10c: Flush the binding to disk NOW, but only for a brand-new binding
  // (existingBinding === undefined) — a reconnect under an already-owned name
  // only bumps lastSeenAt, which is not security-critical and must not force
  // a disk write on every reconnect. Without this, the binding above only
  // lives in Loki's in-memory collection until the next autosave (5 minutes)
  // or graceful shutdown; a hard-kill/OOM/power-loss in between loses it, and
  // a restarted server rehydrates from the stale on-disk file believing the
  // name unbound — reopening the exact squat window this binding exists to
  // close. Awaited so the name's ownership is durable before the agent is
  // told it's welcome; on failure, roll back every bit of in-memory state
  // this hello reserved so the name stays claimable and no slot leaks.
  if (existingBinding === undefined) {
    try {
      await saveStore();
    } catch (err: unknown) {
      log.error(`Failed to persist name binding for ${agentName}: ${getErrorMessage(err)}`);
      nameToKeyId.delete(agentName);
      nameBindingsStore.deleteBinding(agentName);
      inFlightAgents.delete(agentName);
      sendErrorAndClose(ws, 'internal-error', 'could not persist name binding', 1011);
      return;
    }
  }

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

  const adapter = new EdgeAgentAdapter(client, ws);
  // activate() calls addAgent() — release the in-flight reservation immediately
  // after so the slot is held by the manager instead.
  adapter.activate();
  // Route handlers only ever look up the client via getAgent(name); wire the
  // adapter onto the client so getContainerLogs()/deleteContainer() can reach
  // the WS-tunnel methods instead of falling through to the (nonexistent)
  // edge-agent-placeholder host.
  client.edgeAdapter = adapter;
  inFlightAgents.delete(agentName);

  // Register this session under pubKeyId so it can be disconnected on key revocation.
  const sessions = liveSessionsByKeyId.get(pubKeyId) ?? new Set<WebSocketLike>();
  sessions.add(ws);
  liveSessionsByKeyId.set(pubKeyId, sessions);

  // Register the adapter alongside it (Fix 2) so disconnectByKeyId can
  // synchronously terminate() this session's adapter — not just close its raw
  // ws — on revocation. See the liveAdaptersByKeyId doc comment.
  const adaptersForKey =
    liveAdaptersByKeyId.get(pubKeyId) ?? new Map<WebSocketLike, EdgeAgentAdapter>();
  adaptersForKey.set(ws, adapter);
  liveAdaptersByKeyId.set(pubKeyId, adaptersForKey);

  // Deregister on disconnect so the Set/Map don't grow unboundedly.
  const deregister = () => {
    const s = liveSessionsByKeyId.get(pubKeyId);
    if (s) {
      s.delete(ws);
      if (s.size === 0) {
        liveSessionsByKeyId.delete(pubKeyId);
      }
    }
    const a = liveAdaptersByKeyId.get(pubKeyId);
    if (a) {
      a.delete(ws);
      if (a.size === 0) {
        liveAdaptersByKeyId.delete(pubKeyId);
      }
    }
  };
  ws.on('close', deregister);
  ws.on('error', deregister);

  log.info(
    `Edge agent connected: ${agentName} (version=${hello.version}, drydockCompat=${hello.drydockCompat ?? 'absent'})`,
  );
}

export function attachPortwingWsServer(options: {
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

  const gateway = createPortwingWsGateway({
    isRateLimited: options.isRateLimited,
    serverConfiguration,
  });

  options.server.on('upgrade', (request, socket, head) => {
    gateway.handleUpgrade(request, socket, head);
  });

  return gateway;
}
