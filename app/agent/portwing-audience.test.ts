import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const configurationMock = vi.hoisted(() => ({
  getStoreConfiguration: vi.fn((): { path?: string } | undefined => undefined),
}));
vi.mock('../configuration/index.js', () => configurationMock);

import {
  AUDIENCE_PIN_FILE,
  AudienceMismatchError,
  AudiencePinStore,
  getAudiencePinStore,
  parsePortwingInfo,
} from './portwing-audience.js';

const AGENT_ID = '0123456789abcdef0123456789abcdef';

describe('parsePortwingInfo', () => {
  test('reads a v3-capable agent', () => {
    expect(parsePortwingInfo({ agentId: AGENT_ID, v3: true })).toEqual({
      agentId: AGENT_ID,
      v3: true,
    });
  });

  test('reports the reason when v3 is unavailable', () => {
    expect(
      parsePortwingInfo({ agentId: 'Agent_ID', v3: false, v3Reason: 'agent-id-not-v3-compatible' }),
    ).toEqual({ agentId: 'Agent_ID', v3: false, v3Reason: 'agent-id-not-v3-compatible' });
  });

  test('a missing v3 field means an older agent without v3', () => {
    expect(parsePortwingInfo({ agentId: AGENT_ID })).toEqual({ agentId: AGENT_ID, v3: false });
  });

  test('v3 true with an unusable agent ID is not v3', () => {
    expect(parsePortwingInfo({ agentId: 'Bad_ID', v3: true }).v3).toBe(false);
    expect(parsePortwingInfo({ v3: true }).v3).toBe(false);
  });

  test('ignores a non-string reason and non-object bodies', () => {
    expect(parsePortwingInfo({ v3: false, v3Reason: 7 })).toEqual({ v3: false });
    expect(parsePortwingInfo(null)).toEqual({ v3: false });
    expect(parsePortwingInfo('nope')).toEqual({ v3: false });
  });
});

describe('AudienceMismatchError', () => {
  test('names the agent, the pinned ID and how to clear the pin', () => {
    const error = new AudienceMismatchError('edge', AGENT_ID, 'other-id');
    expect(error.name).toBe('AudienceMismatchError');
    expect(error.message).toContain('edge');
    expect(error.message).toContain(AGENT_ID);
    expect(error.message).toContain('other-id');
    expect(error.message).toContain(AUDIENCE_PIN_FILE);
  });

  test('omits the reported ID when the agent gave none', () => {
    expect(new AudienceMismatchError('edge', AGENT_ID, undefined).message).not.toContain(
      'it reported',
    );
  });
});

describe('AudiencePinStore', () => {
  let directory: string;
  let filePath: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-audience-'));
    filePath = path.join(directory, 'nested', AUDIENCE_PIN_FILE);
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('has no pin before one is set', () => {
    expect(new AudiencePinStore(filePath).get('edge')).toBeUndefined();
  });

  test('persists a pin across store instances and keeps other agents', () => {
    new AudiencePinStore(filePath).set('edge', AGENT_ID);
    new AudiencePinStore(filePath).set('lab', 'agent-b');
    const reopened = new AudiencePinStore(filePath);
    expect(reopened.get('edge')).toBe(AGENT_ID);
    expect(reopened.get('lab')).toBe('agent-b');
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  test('drops entries that are not valid agent IDs and non-object files', () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify({ good: AGENT_ID, bad: 'Not Valid' }));
    const store = new AudiencePinStore(filePath);
    expect(store.get('good')).toBe(AGENT_ID);
    expect(store.get('bad')).toBeUndefined();
    fs.writeFileSync(filePath, 'null');
    expect(store.get('good')).toBeUndefined();
  });

  test('a prototype-looking agent name is just a name', () => {
    const store = new AudiencePinStore(filePath);
    store.set('__proto__', AGENT_ID);
    expect(store.get('__proto__')).toBe(AGENT_ID);
    expect(store.get('constructor')).toBeUndefined();
  });

  test('corrupt JSON is an error, not an empty pin set', () => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, '{not json');
    expect(() => new AudiencePinStore(filePath).get('edge')).toThrow();
  });

  test('other read errors propagate', () => {
    fs.mkdirSync(filePath, { recursive: true });
    expect(() => new AudiencePinStore(filePath).get('edge')).toThrow(/EISDIR/);
  });
});

describe('getAudiencePinStore', () => {
  test('resolves the configured store directory once', () => {
    configurationMock.getStoreConfiguration.mockReturnValue({ path: '/tmp/dd-store-a' });
    const store = getAudiencePinStore();
    expect(getAudiencePinStore()).toBe(store);
    expect((store as unknown as { filePath: string }).filePath).toBe(
      path.join('/tmp/dd-store-a', AUDIENCE_PIN_FILE),
    );
  });

  test('falls back to /store when no store path is configured', async () => {
    vi.resetModules();
    configurationMock.getStoreConfiguration.mockReturnValue(undefined);
    const fresh = await import('./portwing-audience.js');
    expect((fresh.getAudiencePinStore() as unknown as { filePath: string }).filePath).toBe(
      path.join('/store', fresh.AUDIENCE_PIN_FILE),
    );
  });
});
