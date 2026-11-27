/**
 * Audience (agent ID) handling for Portwing signature v3.
 *
 * Two pieces live here so AgentClient stays small:
 *  - parsePortwingInfo(): reads `GET /_portwing/info` into the two facts the
 *    controller acts on (the agent ID and whether v3 is available).
 *  - AudiencePinStore: the per-agent pin. Once an agent has accepted one v3
 *    request, Drydock never signs v2 for it again and never accepts a different
 *    agent ID, because the info body is unsigned and a 401 reason can be forged
 *    by anything that terminates TLS in between. Only an operator edit clears
 *    the pin.
 *
 * The pin is a small JSON file in the store directory rather than a SQLite
 * table on purpose. A schema migration would make a Drydock 1.8 rollback
 * refuse to open the database; a file next to it is simply ignored by 1.8.
 */
import fs from 'node:fs';
import path from 'node:path';
import { getStoreConfiguration } from '../configuration/index.js';
import { resolveConfiguredPath } from '../runtime/paths.js';
import { isValidAgentId } from './ed25519-signer.js';

export const AUDIENCE_PIN_FILE = 'portwing-audience-pins.json';

export interface PortwingInfo {
  /** The agent's own ID when it is a string; may still be unusable as an audience. */
  agentId?: string;
  /** True only when the agent offers v3 and its ID satisfies the agent ID rule. */
  v3: boolean;
  /** Why the agent cannot do v3 (`agent-id-not-persistent` and friends). */
  v3Reason?: string;
}

/** Reads the `/_portwing/info` body. A missing `v3` field means an agent without v3. */
export function parsePortwingInfo(data: unknown): PortwingInfo {
  const body = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const agentId = typeof body.agentId === 'string' ? body.agentId : undefined;
  const v3 = body.v3 === true && isValidAgentId(agentId);
  return {
    ...(agentId === undefined ? {} : { agentId }),
    v3,
    ...(!v3 && typeof body.v3Reason === 'string' ? { v3Reason: body.v3Reason } : {}),
  };
}

/** Thrown instead of signing when the agent behind a pinned audience changed. */
export class AudienceMismatchError extends Error {
  constructor(agentName: string, pinned: string, reported: string | undefined) {
    super(
      `Agent ${agentName} no longer matches its pinned Portwing agent ID ${pinned}` +
        (reported ? ` (it reported ${reported})` : '') +
        '. Drydock stopped signing requests to it. If the agent was replaced on purpose, ' +
        `remove "${agentName}" from ${AUDIENCE_PIN_FILE} in the store directory and restart Drydock.`,
    );
    this.name = 'AudienceMismatchError';
  }
}

export class AudiencePinStore {
  constructor(private readonly filePath: string) {}

  private read(): Map<string, string> {
    let raw: string;
    try {
      raw = fs.readFileSync(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
      throw error;
    }
    const parsed: unknown = JSON.parse(raw);
    const pins = new Map<string, string>();
    if (parsed && typeof parsed === 'object') {
      for (const [name, agentId] of Object.entries(parsed)) {
        if (isValidAgentId(agentId)) pins.set(name, agentId);
      }
    }
    return pins;
  }

  get(agentName: string): string | undefined {
    return this.read().get(agentName);
  }

  set(agentName: string, agentId: string): void {
    const pins = this.read();
    pins.set(agentName, agentId);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(Object.fromEntries(pins), null, 2)}\n`, {
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, this.filePath);
  }
}

let defaultStore: AudiencePinStore | undefined;

/** The pin store for the configured store directory. */
export function getAudiencePinStore(): AudiencePinStore {
  defaultStore ??= new AudiencePinStore(
    path.join(
      resolveConfiguredPath((getStoreConfiguration()?.path as string | undefined) ?? '/store', {
        label: 'DD_STORE_PATH',
      }),
      AUDIENCE_PIN_FILE,
    ),
  );
  return defaultStore;
}
