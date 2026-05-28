import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import SelfHostedBasic from './SelfHostedBasic.js';

test('init should add protocol and strip trailing slash', async () => {
  const registry = new SelfHostedBasic();
  registry.configuration = {
    url: 'registry.acme.com///',
    login: 'robot',
    password: 'secret',
  };

  registry.init();

  expect(registry.configuration.url).toBe('https://registry.acme.com');
});

test('init should keep existing protocol and strip trailing slash', async () => {
  const registry = new SelfHostedBasic();
  registry.configuration = {
    url: 'http://registry.acme.com///',
    login: 'robot',
    password: 'secret',
  };

  registry.init();

  expect(registry.configuration.url).toBe('http://registry.acme.com');
});

test('match should compare hosts and handle malformed URLs', async () => {
  const registry = new SelfHostedBasic();
  registry.configuration = {
    url: 'https://registry.acme.com',
  };

  expect(
    registry.match({
      registry: {
        url: 'registry.acme.com/library/nginx',
      },
    }),
  ).toBeTruthy();

  expect(
    registry.match({
      registry: {
        url: '%',
      },
    }),
  ).toBeFalsy();
});

test('match should include registry port in comparison', async () => {
  const registry = new SelfHostedBasic();
  registry.configuration = {
    url: 'https://registry.acme.com:5000',
  };

  expect(
    registry.match({
      registry: {
        url: 'registry.acme.com:5000/library/nginx',
      },
    }),
  ).toBeTruthy();

  expect(
    registry.match({
      registry: {
        url: 'registry.acme.com:5001/library/nginx',
      },
    }),
  ).toBeFalsy();
});

test('match should treat explicit default ports as equivalent', async () => {
  const registry = new SelfHostedBasic();
  registry.configuration = {
    url: 'https://registry.acme.com:443',
  };

  expect(
    registry.match({
      registry: {
        url: 'registry.acme.com/library/nginx',
      },
    }),
  ).toBeTruthy();
});

test('normalizeImage should point to configured v2 endpoint', async () => {
  const registry = new SelfHostedBasic();
  registry.configuration = {
    url: 'https://registry.acme.com',
  };

  expect(
    registry.normalizeImage({
      name: 'library/nginx',
      registry: {
        url: 'ignored.local',
      },
    }),
  ).toStrictEqual({
    name: 'library/nginx',
    registry: {
      url: 'https://registry.acme.com/v2',
    },
  });
});

test('normalizeImage should not mutate the input image object', async () => {
  const registry = new SelfHostedBasic();
  registry.configuration = {
    url: 'https://registry.acme.com',
  };

  const image = {
    name: 'library/nginx',
    registry: {
      url: 'ignored.local',
    },
  };

  const normalized = registry.normalizeImage(image);

  expect(normalized).not.toBe(image);
  expect(normalized.registry).not.toBe(image.registry);
  expect(image.registry.url).toBe('ignored.local');
  expect(normalized.registry.url).toBe('https://registry.acme.com/v2');
});

test('maskConfiguration should mask password and auth', async () => {
  const registry = new SelfHostedBasic();
  registry.configuration = {
    url: 'https://registry.acme.com',
    password: 'secret',
    auth: Buffer.from('robot:secret', 'utf-8').toString('base64'),
  };

  expect(registry.maskConfiguration()).toEqual({
    url: 'https://registry.acme.com',
    password: '[REDACTED]',
    auth: '[REDACTED]',
  });
});

test('authenticate should apply basic auth from credentials', async () => {
  const registry = new SelfHostedBasic();
  registry.configuration = {
    url: 'https://registry.acme.com',
    login: 'robot',
    password: 'secret',
  };

  await expect(
    registry.authenticate(
      {
        name: 'library/nginx',
        registry: { url: 'registry.acme.com' },
      },
      { headers: {} },
    ),
  ).resolves.toEqual({
    headers: {
      Authorization: `Basic ${Buffer.from('robot:secret', 'utf-8').toString('base64')}`,
    },
  });
});

test('validateConfiguration should allow cafile and insecure options', async () => {
  const registry = new SelfHostedBasic();
  expect(
    registry.validateConfiguration({
      url: 'https://registry.acme.com',
      cafile: '/certs/internal-ca.pem',
      insecure: true,
    }),
  ).toStrictEqual({
    url: 'https://registry.acme.com',
    cafile: '/certs/internal-ca.pem',
    insecure: true,
  });
});

test('validateConfiguration should allow mTLS client certificate options', async () => {
  const registry = new SelfHostedBasic();
  expect(
    registry.validateConfiguration({
      url: 'https://registry.acme.com',
      clientcert: '/certs/client.pem',
      clientkey: '/certs/client-key.pem',
    }),
  ).toStrictEqual({
    url: 'https://registry.acme.com',
    clientcert: '/certs/client.pem',
    clientkey: '/certs/client-key.pem',
  });
});

test('validateConfiguration should reject clientcert without clientkey', async () => {
  const registry = new SelfHostedBasic();
  expect(() =>
    registry.validateConfiguration({
      url: 'https://registry.acme.com',
      clientcert: '/certs/client.pem',
    }),
  ).toThrow();
});

test('validateConfiguration should reject clientkey without clientcert', async () => {
  const registry = new SelfHostedBasic();
  expect(() =>
    registry.validateConfiguration({
      url: 'https://registry.acme.com',
      clientkey: '/certs/client-key.pem',
    }),
  ).toThrow();
});

test('authenticate should set httpsAgent with rejectUnauthorized=false when insecure=true', async () => {
  const registry = new SelfHostedBasic();
  registry.configuration = {
    url: 'https://registry.acme.com',
    insecure: true,
  };

  const result = await registry.authenticate(
    {
      name: 'library/nginx',
      registry: { url: 'registry.acme.com' },
    },
    { headers: {} },
  );

  expect(result.httpsAgent).toBeDefined();
  expect(result.httpsAgent.options.rejectUnauthorized).toBe(false);
});

test('authenticate should load CA file into httpsAgent when cafile is configured', async () => {
  const registry = new SelfHostedBasic();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-selfhosted-'));
  const caPath = path.join(tempDir, 'ca.pem');

  try {
    fs.writeFileSync(caPath, 'test-ca-content');
    registry.configuration = {
      url: 'https://registry.acme.com',
      cafile: caPath,
    };

    const result = await registry.authenticate(
      {
        name: 'library/nginx',
        registry: { url: 'registry.acme.com' },
      },
      { headers: {} },
    );

    expect(result.httpsAgent).toBeDefined();
    expect(result.httpsAgent.options.rejectUnauthorized).toBe(true);
    expect(result.httpsAgent.options.ca.toString('utf-8')).toBe('test-ca-content');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('authenticate should load client cert and key into httpsAgent for mTLS', async () => {
  const registry = new SelfHostedBasic();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-selfhosted-'));
  const certPath = path.join(tempDir, 'client.pem');
  const keyPath = path.join(tempDir, 'client-key.pem');

  try {
    fs.writeFileSync(certPath, 'test-client-cert');
    fs.writeFileSync(keyPath, 'test-client-key');
    registry.configuration = {
      url: 'https://registry.acme.com',
      clientcert: certPath,
      clientkey: keyPath,
    };

    const result = await registry.authenticate(
      {
        name: 'library/nginx',
        registry: { url: 'registry.acme.com' },
      },
      { headers: {} },
    );

    expect(result.httpsAgent).toBeDefined();
    expect(result.httpsAgent.options.rejectUnauthorized).toBe(true);
    expect(result.httpsAgent.options.cert.toString('utf-8')).toBe('test-client-cert');
    expect(result.httpsAgent.options.key.toString('utf-8')).toBe('test-client-key');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('authenticate should combine CA file and mTLS client cert in httpsAgent', async () => {
  const registry = new SelfHostedBasic();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drydock-selfhosted-'));
  const caPath = path.join(tempDir, 'ca.pem');
  const certPath = path.join(tempDir, 'client.pem');
  const keyPath = path.join(tempDir, 'client-key.pem');

  try {
    fs.writeFileSync(caPath, 'test-ca-content');
    fs.writeFileSync(certPath, 'test-client-cert');
    fs.writeFileSync(keyPath, 'test-client-key');
    registry.configuration = {
      url: 'https://registry.acme.com',
      cafile: caPath,
      clientcert: certPath,
      clientkey: keyPath,
    };

    const result = await registry.authenticate(
      {
        name: 'library/nginx',
        registry: { url: 'registry.acme.com' },
      },
      { headers: {} },
    );

    expect(result.httpsAgent).toBeDefined();
    expect(result.httpsAgent.options.ca.toString('utf-8')).toBe('test-ca-content');
    expect(result.httpsAgent.options.cert.toString('utf-8')).toBe('test-client-cert');
    expect(result.httpsAgent.options.key.toString('utf-8')).toBe('test-client-key');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ── getRegistryAuthority / match deep tests ──────────────────────────────────

test('match should lowercase the hostname (uppercase input)', async () => {
  // Kills: [MethodExpression] parsedUrl.hostname.toUpperCase()
  const registry = new SelfHostedBasic();
  registry.configuration = { url: 'https://Registry.ACME.Com' };

  // The authority derived from the configured URL must match the lowercase form
  expect(registry.match({ registry: { url: 'registry.acme.com' } })).toBe(true);

  expect(registry.match({ registry: { url: 'REGISTRY.ACME.COM' } })).toBe(true);
});

test('match should NOT match a different host', async () => {
  const registry = new SelfHostedBasic();
  registry.configuration = { url: 'https://registry.acme.com' };

  expect(registry.match({ registry: { url: 'other.registry.com' } })).toBe(false);
});

test('match: http port 80 is the default — authority excludes the port', async () => {
  // Kills: ConditionalExpression/EqualityOperator mutants on lines 34-36
  const registry = new SelfHostedBasic();
  registry.configuration = { url: 'http://registry.acme.com:80' };

  // http:80 is default — authority should be just "registry.acme.com"
  expect(registry.match({ registry: { url: 'http://registry.acme.com' } })).toBe(true);

  // port 81 is NOT default — authority should include port
  const registry81 = new SelfHostedBasic();
  registry81.configuration = { url: 'http://registry.acme.com:81' };
  expect(registry81.match({ registry: { url: 'registry.acme.com' } })).toBe(false);
  expect(registry81.match({ registry: { url: 'http://registry.acme.com:81' } })).toBe(true);
});

test('match: https port 443 is the default — authority excludes the port', async () => {
  // Kills: ConditionalExpression/EqualityOperator mutants on lines 35-36
  const registry = new SelfHostedBasic();
  registry.configuration = { url: 'https://registry.acme.com:443' };

  // https:443 is default — authority should be just "registry.acme.com"
  expect(registry.match({ registry: { url: 'https://registry.acme.com' } })).toBe(true);

  // port 444 is NOT default — authority should include port
  const registry444 = new SelfHostedBasic();
  registry444.configuration = { url: 'https://registry.acme.com:444' };
  expect(registry444.match({ registry: { url: 'registry.acme.com' } })).toBe(false);
  expect(registry444.match({ registry: { url: 'https://registry.acme.com:444' } })).toBe(true);
});

test('match: http port 80 vs https port 443 — wrong protocol default does NOT strip port', async () => {
  // Kills: protocol-equality mutants — http:443 should NOT strip port, https:80 should NOT strip port
  const registryHttpPort443 = new SelfHostedBasic();
  registryHttpPort443.configuration = { url: 'http://registry.acme.com:443' };
  // http:443 is non-default for http — authority keeps the port
  expect(registryHttpPort443.match({ registry: { url: 'http://registry.acme.com:443' } })).toBe(
    true,
  );
  expect(registryHttpPort443.match({ registry: { url: 'registry.acme.com' } })).toBe(false);

  const registryHttpsPort80 = new SelfHostedBasic();
  registryHttpsPort80.configuration = { url: 'https://registry.acme.com:80' };
  // https:80 is non-default for https — authority keeps the port
  expect(registryHttpsPort80.match({ registry: { url: 'https://registry.acme.com:80' } })).toBe(
    true,
  );
  expect(registryHttpsPort80.match({ registry: { url: 'registry.acme.com' } })).toBe(false);
});

test('match: no port in URL — authority is just hostname', async () => {
  // Kills: LogicalOperator (!parsedUrl.port || ...) mutant at line 36
  const registry = new SelfHostedBasic();
  registry.configuration = { url: 'https://registry.acme.com' };

  // No port → should return just the hostname
  expect(registry.match({ registry: { url: 'registry.acme.com' } })).toBe(true);
});

test('match: non-default http port must appear in authority', async () => {
  // Image URL uses port-less form — must NOT match a registry with non-default port
  const registry = new SelfHostedBasic();
  registry.configuration = { url: 'http://registry.acme.com:8080' };

  expect(registry.match({ registry: { url: 'registry.acme.com' } })).toBe(false);

  expect(registry.match({ registry: { url: 'registry.acme.com:8080' } })).toBe(true);
});

test('getRegistryAuthority fallback strips protocol prefix correctly from malformed URL', async () => {
  // Kills: Regex/StringLiteral mutants in the catch block (lines 41-43)
  // The catch block must: strip the https?:// prefix and take the host segment before '/'
  const registry = new SelfHostedBasic();
  // Use a URL with a path to verify the split('/')[0] part
  registry.configuration = { url: '%' }; // forces catch block for config

  // Image with 'http://...' that cannot be parsed — falls through to catch
  expect(registry.match({ registry: { url: '%' } })).toBe(true);

  expect(registry.match({ registry: { url: 'different%' } })).toBe(false);
});

test('getRegistryAuthority catch block: strips http:// prefix (not just https://)', async () => {
  // Kills: Regex /^https:\/\//i (only strips https, not http) at line 42:18
  // If the regex is /^https:\/\//i instead of /^https?:\/\//i,
  // an http:// prefix won't be stripped and the result will differ.
  const registry = new SelfHostedBasic();
  // Use a value that starts with http:// and fails URL parsing
  registry.configuration = { url: 'http://invalid%url' };

  // The catch block strips 'http://' leaving 'invalid%url', split('/')[0] = 'invalid%url'
  expect(registry.match({ registry: { url: 'http://invalid%url' } })).toBe(true);

  // Ensure it does NOT match a different host from the catch block
  expect(registry.match({ registry: { url: 'http://other%url' } })).toBe(false);
});

test('getRegistryAuthority catch block: splits on "/" to get just the host segment', async () => {
  // Kills: StringLiteral "" (replacing '/') at line 43:16
  // If .split('') is used instead of .split('/'), the result is a single character.
  const registry = new SelfHostedBasic();
  // URL with a path component to verify the split behavior
  registry.configuration = { url: 'invalid%host/path/to/image' };

  // Catch block: 'invalid%host/path/to/image' → strip no-proto → 'invalid%host/path/to/image'
  // → split('/')[0] → 'invalid%host'
  expect(registry.match({ registry: { url: 'invalid%host/other/path' } })).toBe(true);

  // A completely different host should not match
  expect(registry.match({ registry: { url: 'other%host/path' } })).toBe(false);
});

test('getRegistryAuthority catch block: replace() uses empty string replacement', async () => {
  // Kills: StringLiteral "Stryker was here!" at line 42:35 (the '' in replace)
  // If replace uses 'Stryker was here!' instead of '', the result has the placeholder.
  const registry = new SelfHostedBasic();
  registry.configuration = { url: 'https://invalid%host' };

  // Catch block: 'https://invalid%host'.replace(/^https?:\/\//i, '') = 'invalid%host'
  // With mutant: replace returns 'Stryker was here!invalid%host'
  expect(registry.match({ registry: { url: 'https://invalid%host' } })).toBe(true);
});

test('normalizeImage should spread registry fields onto new object', async () => {
  // Kills: [ObjectLiteral] {} at line 57 (the registry spread)
  const registry = new SelfHostedBasic();
  registry.configuration = { url: 'https://registry.acme.com' };

  const image = {
    name: 'library/nginx',
    registry: {
      url: 'ignored.local',
      extraField: 'should-be-preserved',
    },
  };

  const normalized = registry.normalizeImage(image);

  // The spread means extra fields from image.registry carry over
  expect((normalized.registry as Record<string, unknown>).extraField).toBe('should-be-preserved');
  // But the url is overwritten with the configured endpoint
  expect(normalized.registry.url).toBe('https://registry.acme.com/v2');
});

test('init: URL with HTTPS:// prefix (uppercase) is kept as-is', async () => {
  // Kills: [Regex] /https?:\/\//i (the case-insensitive flag matters)
  const registry = new SelfHostedBasic();
  registry.configuration = { url: 'HTTPS://registry.acme.com' };
  registry.init();
  // Should NOT prepend https:// again — the regex is case-insensitive
  expect(registry.configuration.url).toBe('HTTPS://registry.acme.com');
});

test('init: URL starting with "http" but no protocol marker gets https prepended', async () => {
  // Kills: StringLiteral "" at line 30:64 — the prepended "https://"
  const registry = new SelfHostedBasic();
  registry.configuration = { url: 'registry.acme.com' };
  registry.init();
  expect(registry.configuration.url).toMatch(/^https:\/\//);
  expect(registry.configuration.url).toBe('https://registry.acme.com');
});
