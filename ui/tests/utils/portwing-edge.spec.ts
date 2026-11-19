import {
  buildComposeSnippet,
  buildDockerRunSnippet,
  normalizeControllerUrl,
  parsePublicKey,
  publicKeyComment,
} from '@/utils/portwing-edge';

const KEY = 'kPGd2xqT8vWzN4cRfYbLmJhQ5sUaE7nVwXyZ0AB1CdE='; // gitleaks:allow fake test public key

describe('parsePublicKey', () => {
  it('accepts a bare 32-byte base64 key', () => {
    expect(parsePublicKey(KEY)).toBe(KEY);
  });

  it('accepts the authorized_keys line from portwing keygen', () => {
    expect(parsePublicKey(`ed25519 ${KEY} edge-host-01\n`)).toBe(KEY);
    expect(parsePublicKey(`ED25519 ${KEY}`)).toBe(KEY);
  });

  it('rejects empty input, a bare prefix, non-base64 and wrong lengths', () => {
    expect(parsePublicKey('')).toBeUndefined();
    expect(parsePublicKey('ed25519')).toBeUndefined();
    expect(parsePublicKey('not base64!')).toBeUndefined();
    expect(parsePublicKey('QUJD')).toBeUndefined();
    expect(parsePublicKey('A===')).toBeUndefined();
    expect(parsePublicKey('AAAAA')).toBeUndefined();
  });
});

describe('publicKeyComment', () => {
  it('returns the comment of an authorized_keys line', () => {
    expect(publicKeyComment(`ed25519 ${KEY} edge host 01`)).toBe('edge host 01');
  });

  it('returns an empty string for a bare key', () => {
    expect(publicKeyComment(KEY)).toBe('');
  });
});

describe('snippets', () => {
  it('normalizes trailing slashes on the controller URL', () => {
    expect(normalizeControllerUrl(' https://dd.example.com// ')).toBe('https://dd.example.com');
  });

  it('fills the controller URL and agent name into the docker run command', () => {
    const snippet = buildDockerRunSnippet('https://dd.example.com/', "it's-a-name");
    expect(snippet).toContain("-e DRYDOCK_URL='https://dd.example.com'");
    expect(snippet).toContain("-e AGENT_NAME='it'\\''s-a-name'");
    expect(snippet).toContain('-e PRIVATE_KEY_FILE=/run/secrets/portwing_key');
    expect(snippet.endsWith('ghcr.io/codeswhat/portwing:1.3.0')).toBe(true);
  });

  it('fills the controller URL and agent name into the compose file', () => {
    const snippet = buildComposeSnippet('https://dd.example.com/', 'edge-host-01');
    expect(snippet).toContain('- DRYDOCK_URL=https://dd.example.com\n');
    expect(snippet).toContain('- AGENT_NAME=edge-host-01\n');
    expect(snippet).toContain('file: ./portwing_ed25519.pem');
  });
});
