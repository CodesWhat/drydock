import * as configuration from './index.js';

const SECURITY_KEYS = [
  'DD_SECURITY_SCANNER',
  'DD_SECURITY_BACKEND',
  'DD_SECURITY_AVAILABILITY_POLICY',
  'DD_SECURITY_TRIVY_WORKER_IMAGE',
  'DD_SECURITY_TRIVY_COMMAND',
  'DD_SECURITY_COSIGN_COMMAND',
  'DD_SECURITY_COSIGN_WORKER_IMAGE',
  'DD_SECURITY_GRYPE_COMMAND',
  'DD_SECURITY_GRYPE_TIMEOUT',
  'DD_SECURITY_GRYPE_WORKER_IMAGE',
  'DD_SECURITY_SBOM_GENERATOR',
  'DD_SECURITY_SYFT_COMMAND',
  'DD_SECURITY_SYFT_TIMEOUT',
  'DD_SECURITY_SYFT_WORKER_IMAGE',
  'DD_SECURITY_TRIVY_ARGS',
  'DD_SECURITY_GRYPE_ARGS',
  'DD_SECURITY_SYFT_ARGS',
  'DD_SECURITY_GATE_RELATIVE',
] as const;

afterEach(() => {
  SECURITY_KEYS.forEach((key) => delete configuration.ddEnvVars[key]);
});

describe('scanner provider and execution backend configuration', () => {
  test('enables no-worse-than-current gating explicitly', () => {
    configuration.ddEnvVars.DD_SECURITY_GATE_RELATIVE = 'true';

    expect(configuration.getSecurityConfiguration().gate).toEqual({
      mode: 'on',
      allowNoWorse: true,
    });
  });

  test('defaults the backend to auto with the pinned ghcr worker images', () => {
    expect(configuration.getSecurityConfiguration()).toMatchObject({
      enabled: false,
      scanner: '',
      backend: 'auto',
      availabilityPolicy: 'block',
      trivy: {
        command: 'trivy',
        workerImage: expect.stringMatching(
          /^ghcr\.io\/aquasecurity\/trivy:[\w.-]+@sha256:[a-f0-9]{64}$/,
        ),
      },
      grype: {
        command: 'grype',
        timeout: 600000,
        workerImage: expect.stringMatching(
          /^ghcr\.io\/anchore\/grype:v[\w.-]+@sha256:[a-f0-9]{64}$/,
        ),
      },
      sbom: {
        generator: 'auto',
      },
      syft: {
        command: 'syft',
        timeout: 600000,
        workerImage: expect.stringMatching(
          /^ghcr\.io\/anchore\/syft:v[\w.-]+@sha256:[a-f0-9]{64}$/,
        ),
      },
    });
  });

  test('pins the cosign worker image by tag and digest', () => {
    expect(configuration.getSecurityConfiguration().signature.cosign).toMatchObject({
      command: 'cosign',
      commandExplicit: false,
      workerImage: expect.stringMatching(
        /^ghcr\.io\/sigstore\/cosign\/cosign:v[\w.-]+@sha256:[a-f0-9]{64}$/,
      ),
    });
  });

  test('overrides the cosign worker image', () => {
    configuration.ddEnvVars.DD_SECURITY_COSIGN_WORKER_IMAGE = 'registry.example/cosign@sha256:abc';
    expect(configuration.getSecurityConfiguration().signature.cosign.workerImage).toBe(
      'registry.example/cosign@sha256:abc',
    );
  });

  test('reports which provider commands were set explicitly', () => {
    expect(configuration.getSecurityConfiguration()).toMatchObject({
      trivy: { commandExplicit: false },
      grype: { commandExplicit: false },
      syft: { commandExplicit: false },
    });
    configuration.ddEnvVars.DD_SECURITY_TRIVY_COMMAND = '/mnt/trivy';
    configuration.ddEnvVars.DD_SECURITY_GRYPE_COMMAND = '/opt/grype';
    configuration.ddEnvVars.DD_SECURITY_SYFT_COMMAND = '/opt/syft';
    configuration.ddEnvVars.DD_SECURITY_COSIGN_COMMAND = '/opt/cosign';
    const result = configuration.getSecurityConfiguration();
    expect(result.trivy.commandExplicit).toBe(true);
    expect(result.grype.commandExplicit).toBe(true);
    expect(result.syft.commandExplicit).toBe(true);
    expect(result.signature.cosign.commandExplicit).toBe(true);
  });

  test('does not treat a blank command as explicit', () => {
    configuration.ddEnvVars.DD_SECURITY_GRYPE_COMMAND = '   ';
    expect(configuration.getSecurityConfiguration().grype.commandExplicit).toBe(false);
  });

  test.each(['auto', 'command', 'docker', 'AUTO'] as const)('accepts backend %s', (backend) => {
    configuration.ddEnvVars.DD_SECURITY_BACKEND = backend;
    expect(configuration.getSecurityConfiguration().backend).toBe(backend.toLowerCase());
  });

  test.each(['grype', 'both'] as const)('accepts the %s scanner provider selection', (scanner) => {
    configuration.ddEnvVars.DD_SECURITY_SCANNER = scanner;
    expect(configuration.getSecurityConfiguration()).toMatchObject({ enabled: true, scanner });
  });

  test('parses Docker execution, warn availability, Grype and Syft overrides', () => {
    configuration.ddEnvVars.DD_SECURITY_SCANNER = 'both';
    configuration.ddEnvVars.DD_SECURITY_BACKEND = 'docker';
    configuration.ddEnvVars.DD_SECURITY_AVAILABILITY_POLICY = 'warn';
    configuration.ddEnvVars.DD_SECURITY_TRIVY_WORKER_IMAGE = 'registry.example/trivy@sha256:abc';
    configuration.ddEnvVars.DD_SECURITY_GRYPE_COMMAND = '/opt/grype';
    configuration.ddEnvVars.DD_SECURITY_GRYPE_TIMEOUT = '45000';
    configuration.ddEnvVars.DD_SECURITY_GRYPE_WORKER_IMAGE = 'registry.example/grype@sha256:def';
    configuration.ddEnvVars.DD_SECURITY_SBOM_GENERATOR = 'syft';
    configuration.ddEnvVars.DD_SECURITY_SYFT_COMMAND = '/opt/syft';
    configuration.ddEnvVars.DD_SECURITY_SYFT_TIMEOUT = '46000';
    configuration.ddEnvVars.DD_SECURITY_SYFT_WORKER_IMAGE = 'registry.example/syft@sha256:fed';

    expect(configuration.getSecurityConfiguration()).toMatchObject({
      scanner: 'both',
      backend: 'docker',
      availabilityPolicy: 'warn',
      trivy: { workerImage: 'registry.example/trivy@sha256:abc' },
      grype: {
        command: '/opt/grype',
        timeout: 45000,
        workerImage: 'registry.example/grype@sha256:def',
      },
      sbom: { generator: 'syft' },
      syft: {
        command: '/opt/syft',
        timeout: 46000,
        workerImage: 'registry.example/syft@sha256:fed',
      },
    });
  });

  test('accepts remote only for Trivy because Grype has no server protocol', () => {
    configuration.ddEnvVars.DD_SECURITY_SCANNER = 'grype';
    configuration.ddEnvVars.DD_SECURITY_BACKEND = 'remote';
    expect(() => configuration.getSecurityConfiguration()).toThrow(
      'DD_SECURITY_BACKEND=remote requires DD_SECURITY_SCANNER=trivy and DD_SECURITY_TRIVY_SERVER',
    );
  });

  test('parses provider extra arguments only from JSON string arrays', () => {
    configuration.ddEnvVars.DD_SECURITY_TRIVY_ARGS = '["--skip-dirs","/vendor"]';
    configuration.ddEnvVars.DD_SECURITY_GRYPE_ARGS = '["--only-fixed"]';
    configuration.ddEnvVars.DD_SECURITY_SYFT_ARGS = '["--scope","all-layers"]';

    expect(configuration.getSecurityConfiguration()).toMatchObject({
      trivy: { extraArgs: ['--skip-dirs', '/vendor'] },
      grype: { extraArgs: ['--only-fixed'] },
      syft: { extraArgs: ['--scope', 'all-layers'] },
    });

    configuration.ddEnvVars.DD_SECURITY_GRYPE_ARGS = '--only-fixed';
    expect(() => configuration.getSecurityConfiguration()).toThrow(
      'DD_SECURITY_GRYPE_ARGS must be a JSON array of strings',
    );
  });
});
