import { createHash, generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  buildDockerSshOptions,
  type DockerSshConfiguration,
  normalizeSshHostKeyFingerprint,
} from './docker-ssh-options.js';

const hex = createHash('sha256').update('host-key').digest('hex');
const b64 = createHash('sha256').update('host-key').digest('base64').replace(/=+$/, '');

const base: DockerSshConfiguration = {
  host: 'remote.example',
  port: 22,
  sshuser: 'drydock',
  sshhostkey: `SHA256:${b64}`,
  sshagent: '/run/agent.sock',
};

describe('normalizeSshHostKeyFingerprint', () => {
  test('converts the OpenSSH SHA256 form to hex', () => {
    expect(normalizeSshHostKeyFingerprint(`SHA256:${b64}`)).toBe(hex);
    expect(normalizeSshHostKeyFingerprint(`  sha256:${b64} `)).toBe(hex);
  });

  test('lowercases plain and colon-separated hex', () => {
    expect(normalizeSshHostKeyFingerprint(hex.toUpperCase())).toBe(hex);
    expect(normalizeSshHostKeyFingerprint(hex.match(/../g)?.join(':') ?? '')).toBe(hex);
  });
});

describe('buildDockerSshOptions', () => {
  let tmpDir: string;
  const originalAuthSock = process.env.SSH_AUTH_SOCK;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-ssh-opts-'));
    delete process.env.SSH_AUTH_SOCK;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalAuthSock === undefined) {
      delete process.env.SSH_AUTH_SOCK;
    } else {
      process.env.SSH_AUTH_SOCK = originalAuthSock;
    }
  });

  test('maps configuration to dockerode ssh options with an agent', () => {
    const options = buildDockerSshOptions('w', base);
    expect(options).toMatchObject({
      protocol: 'ssh',
      host: 'remote.example',
      port: 22,
      username: 'drydock',
      sshOptions: { agent: '/run/agent.sock', hostHash: 'sha256' },
    });
    expect(options.password).toBeUndefined();
  });

  test('host verifier accepts only the pinned fingerprint', () => {
    const verifier = buildDockerSshOptions('w', base).sshOptions?.hostVerifier as (
      hash: string,
    ) => boolean;
    expect(verifier(hex)).toBe(true);
    expect(verifier(hex.toUpperCase())).toBe(true);
    expect(verifier(createHash('sha256').update('other').digest('hex'))).toBe(false);
  });

  test('falls back to SSH_AUTH_SOCK when no agent is configured', () => {
    process.env.SSH_AUTH_SOCK = '/tmp/ambient.sock';
    const options = buildDockerSshOptions('w', { ...base, sshagent: undefined });
    expect(options.sshOptions?.agent).toBe('/tmp/ambient.sock');
  });

  test('reads the private key file and passes the passphrase', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const keyPath = path.join(tmpDir, 'id');
    fs.writeFileSync(keyPath, pem);
    const options = buildDockerSshOptions('w', {
      ...base,
      sshagent: undefined,
      sshkeyfile: keyPath,
      sshpassphrase: 'pp',
    });
    expect(Buffer.from(options.sshOptions?.privateKey as Buffer).toString()).toBe(String(pem));
    expect(options.sshOptions?.passphrase).toBe('pp');
    expect(options.sshOptions?.agent).toBeUndefined();
  });

  test('omits the passphrase when none is configured', () => {
    const keyPath = path.join(tmpDir, 'id');
    fs.writeFileSync(keyPath, 'key');
    const options = buildDockerSshOptions('w', {
      ...base,
      sshagent: undefined,
      sshkeyfile: keyPath,
    });
    expect(options.sshOptions?.passphrase).toBeUndefined();
  });

  test('passes a password as the only credential', () => {
    const options = buildDockerSshOptions('w', {
      ...base,
      sshagent: undefined,
      sshpassword: 'pw',
    });
    expect(options.password).toBe('pw');
  });

  test('requires sshuser', () => {
    expect(() => buildDockerSshOptions('w', { ...base, sshuser: undefined })).toThrow(/sshuser/);
  });

  test('requires a pinned host key', () => {
    expect(() => buildDockerSshOptions('w', { ...base, sshhostkey: undefined })).toThrow(
      /sshhostkey/,
    );
  });

  test('rejects a malformed host key fingerprint', () => {
    expect(() => buildDockerSshOptions('w', { ...base, sshhostkey: 'SHA256:abc' })).toThrow(
      /SHA-256 fingerprint/,
    );
  });

  test('requires some credential', () => {
    expect(() => buildDockerSshOptions('w', { ...base, sshagent: undefined })).toThrow(
      /needs a credential/,
    );
  });
});
