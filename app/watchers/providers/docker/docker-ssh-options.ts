import fs from 'node:fs';
import type Dockerode from 'dockerode';
import { resolveConfiguredPath } from '../../../runtime/paths.js';

export interface DockerSshConfiguration {
  host?: string;
  port: number;
  sshuser?: string;
  sshpassword?: string;
  sshkeyfile?: string;
  sshpassphrase?: string;
  sshagent?: string;
  sshhostkey?: string;
}

/**
 * Normalize a host key fingerprint to the lowercase hex SHA-256 digest ssh2
 * hands to `hostVerifier`. Accepts the OpenSSH form (`SHA256:<base64>`, as
 * printed by `ssh-keygen -lf`) and plain or colon-separated hex.
 */
export function normalizeSshHostKeyFingerprint(fingerprint: string): string {
  const trimmed = fingerprint.trim();
  if (/^sha256:/i.test(trimmed)) {
    return Buffer.from(trimmed.slice('sha256:'.length), 'base64').toString('hex');
  }
  return trimmed.replace(/:/g, '').toLowerCase();
}

/**
 * Build the dockerode options for a watcher with `protocol=ssh`. docker-modem
 * opens an SSH session per request and runs `docker system dial-stdio` on the
 * remote host. ssh2 accepts any host key unless a verifier is supplied, so a
 * pinned fingerprint is mandatory and a mismatch refuses the connection.
 */
export function buildDockerSshOptions(
  watcherName: string,
  configuration: DockerSshConfiguration,
): Dockerode.DockerOptions {
  if (!configuration.sshuser) {
    throw new Error(`Watcher ${watcherName}: protocol=ssh requires sshuser`);
  }
  if (!configuration.sshhostkey) {
    throw new Error(
      `Watcher ${watcherName}: protocol=ssh requires sshhostkey (the remote host key SHA-256 fingerprint)`,
    );
  }
  const expectedFingerprint = normalizeSshHostKeyFingerprint(configuration.sshhostkey);
  if (!/^[0-9a-f]{64}$/.test(expectedFingerprint)) {
    throw new Error(
      `Watcher ${watcherName}: sshhostkey must be a SHA-256 fingerprint (SHA256:<base64> or 64 hex characters)`,
    );
  }

  const sshOptions: NonNullable<Dockerode.DockerOptions['sshOptions']> = {
    hostHash: 'sha256',
    hostVerifier: (hash: unknown) => String(hash).toLowerCase() === expectedFingerprint,
  };
  if (configuration.sshkeyfile) {
    sshOptions.privateKey = fs.readFileSync(
      resolveConfiguredPath(configuration.sshkeyfile, {
        label: `watcher ${watcherName} SSH key file path`,
      }),
    );
    if (configuration.sshpassphrase) {
      sshOptions.passphrase = configuration.sshpassphrase;
    }
  }
  const agentSocket = configuration.sshagent || process.env.SSH_AUTH_SOCK;
  if (agentSocket) {
    sshOptions.agent = agentSocket;
  }
  if (!sshOptions.privateKey && !sshOptions.agent && !configuration.sshpassword) {
    throw new Error(
      `Watcher ${watcherName}: protocol=ssh needs a credential (sshkeyfile, sshagent or SSH_AUTH_SOCK, or sshpassword)`,
    );
  }

  // docker-modem reads `password` for SSH logins, but @types/dockerode omits it.
  const options: Dockerode.DockerOptions & { password?: string } = {
    protocol: 'ssh',
    host: configuration.host,
    port: configuration.port,
    username: configuration.sshuser,
    sshOptions,
  };
  if (configuration.sshpassword) {
    options.password = configuration.sshpassword;
  }
  return options;
}
