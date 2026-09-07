import { configFileSources, ddEnvVars } from '../configuration/index.js';
import Component from '../registry/Component.js';
import { createMockResponse } from '../test/helpers.js';
import { validateCandidateConfiguration } from './config-validate.js';
import { validateOpenApiJsonResponse } from './openapi-contract.js';

const mockRecordAuditEvent = vi.fn();
vi.mock('./audit-events.js', () => ({
  recordAuditEvent: (...args: unknown[]) => mockRecordAuditEvent(...args),
}));

function jsonRequest(body: unknown): { body: unknown } {
  return { body };
}

function yamlBody(text: string): { yaml: string } {
  return { yaml: text };
}

// `ddEnvVars`/`configFileSources` are the real, live singletons
// `config-validate.ts` reads (never mocked): a partial mock of
// `../configuration/index.js` here would give `validateConfiguration`'s
// real, unmocked discoverers (imported through the same specifier from
// `file/validate.ts`) a *different* module instance than the one this file
// mutates — the exact aliasing trap `validate.test.ts` already documents —
// so a test candidate would silently validate against nothing. Every test
// that needs `ddEnvVars`/`configFileSources` populated restores both to
// their pre-test snapshot afterward, the same discipline `validate.test.ts`
// uses for the same reason.
describe('validateCandidateConfiguration', () => {
  let ddEnvVarsSnapshot: Record<string, string | undefined>;
  let configFileSourcesSnapshot: Record<string, string>;

  beforeEach(() => {
    vi.clearAllMocks();
    ddEnvVarsSnapshot = { ...ddEnvVars };
    configFileSourcesSnapshot = { ...configFileSources };
  });

  afterEach(() => {
    for (const key of Object.keys(ddEnvVars)) {
      delete ddEnvVars[key];
    }
    Object.assign(ddEnvVars, ddEnvVarsSnapshot);
    for (const key of Object.keys(configFileSources)) {
      delete configFileSources[key];
    }
    Object.assign(configFileSources, configFileSourcesSnapshot);
  });

  test('a valid document (tree form) reports valid: true with no errors', async () => {
    const res = createMockResponse();

    await validateCandidateConfiguration(
      jsonRequest({
        notification: { discord: { myhook: { url: 'https://discord.example/hook' } } },
      }) as never,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.valid).toBe(true);
    expect(payload.errors).toEqual([]);
  });

  test('a valid document (yaml string form) reports valid: true with no errors', async () => {
    const res = createMockResponse();

    await validateCandidateConfiguration(
      jsonRequest(
        yamlBody(
          'notification:\n  discord:\n    myhook:\n      url: https://discord.example/hook\n',
        ),
      ) as never,
      res,
    );

    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.valid).toBe(true);
    expect(payload.errors).toEqual([]);
  });

  test('a provider Joi rejection reports the path, envKey and message', async () => {
    const res = createMockResponse();

    await validateCandidateConfiguration(
      jsonRequest({ agent: { node1: { secret: 'shared-secret' } } }) as never,
      res,
    );

    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.valid).toBe(false);
    expect(payload.errors).toHaveLength(1);
    expect(payload.errors[0].path).toBe('agent.node1.host');
    expect(payload.errors[0].envKey).toBe('DD_AGENT_NODE1_HOST');
  });

  test('an unknown provider names the available ones', async () => {
    const res = createMockResponse();

    await validateCandidateConfiguration(
      jsonRequest({ registry: { bogus: { myreg: { token: 'placeholder-value' } } } }) as never,
      res,
    );

    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.valid).toBe(false);
    expect(payload.errors).toHaveLength(1);
    expect(payload.errors[0].message).toContain("Unknown registry provider: 'bogus'");
    expect(payload.errors[0].message).toContain('Available registry providers:');
  });

  test('a duplicate key gives valid: false with one error', async () => {
    const res = createMockResponse();

    await validateCandidateConfiguration(
      jsonRequest(yamlBody('server:\n  port: 1\nserver:\n  port: 2\n')) as never,
      res,
    );

    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.valid).toBe(false);
    expect(payload.errors).toHaveLength(1);
    expect(payload.errors[0].message).toContain('not valid YAML');
  });

  test('a "<<" merge key gives valid: false with one error', async () => {
    const res = createMockResponse();

    await validateCandidateConfiguration(
      jsonRequest(yamlBody('base: &base\n  x: 1\nfoo:\n  <<: *base\n  y: 2\n')) as never,
      res,
    );

    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.valid).toBe(false);
    expect(payload.errors).toHaveLength(1);
    expect(payload.errors[0].message).toContain('key "<<" must match');
  });

  test('a non-mapping root gives valid: false with one error', async () => {
    const res = createMockResponse();

    await validateCandidateConfiguration(jsonRequest(yamlBody('- a\n- b\n')) as never, res);

    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.valid).toBe(false);
    expect(payload.errors).toHaveLength(1);
    expect(payload.errors[0].message).toContain('document root must be a mapping');
  });

  test('a body that is not a JSON object (an array) gives valid: false with one error naming the document', async () => {
    const res = createMockResponse();

    await validateCandidateConfiguration(jsonRequest([1, 2, 3]) as never, res);

    const payload = (res.json as any).mock.calls[0][0];
    expect(res.status).toHaveBeenCalledWith(200);
    expect(payload.valid).toBe(false);
    expect(payload.errors).toEqual([
      {
        path: 'document',
        envKey: 'DD_CONFIG_FILE',
        message: expect.stringContaining('Request body must be a JSON object'),
      },
    ]);
  });

  test('an unresolved ${NAME} interpolation gives valid: false with one error', async () => {
    const res = createMockResponse();
    const unsetVarName = 'DD_CONFIG_VALIDATE_TEST_UNSET_9f8e7d';
    delete process.env[unsetVarName];

    await validateCandidateConfiguration(
      jsonRequest(yamlBody(`server:\n  port: \${${unsetVarName}}\n`)) as never,
      res,
    );

    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.valid).toBe(false);
    expect(payload.errors).toHaveLength(1);
    expect(payload.errors[0].message).toContain(unsetVarName);
  });

  test('a legacy DD_TRIGGER_* prefix in the candidate surfaces as a validation error naming the env var, not a throw', async () => {
    const res = createMockResponse();

    await expect(
      validateCandidateConfiguration(
        jsonRequest({ trigger: { docker: { legacy: { pulltimeout: '30' } } } }) as never,
        res,
      ),
    ).resolves.toBeUndefined();

    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.valid).toBe(false);
    expect(payload.errors).toHaveLength(1);
    expect(payload.errors[0].message).toContain('DD_TRIGGER_DOCKER_LEGACY_PULLTIMEOUT');
    expect(payload.errors[0].message).toContain('DD_ACTION_DOCKER_LEGACY_PULLTIMEOUT');
  });

  test('env precedence: an env-sourced value that is already valid wins over an invalid candidate value', async () => {
    Object.assign(ddEnvVars, { DD_ACTION_DOCKER_DEPLOY_PULLTIMEOUT: '30' });
    Object.assign(configFileSources, { DD_ACTION_DOCKER_DEPLOY_PULLTIMEOUT: 'env' });
    const res = createMockResponse();

    await validateCandidateConfiguration(
      jsonRequest({ action: { docker: { deploy: { pulltimeout: 'not-a-number' } } } }) as never,
      res,
    );

    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.valid).toBe(true);
    expect(payload.errors).toEqual([]);
    expect(payload.diff.changed).toEqual([]);
  });

  test('a candidate that changes a currently file-sourced reloadable-section key is reported in diff.changed/diff.reload', async () => {
    Object.assign(ddEnvVars, {
      DD_WATCHER_LOCAL_SOCKET: '/var/run/docker.sock',
      DD_SERVER_PORT: '3000',
    });
    Object.assign(configFileSources, {
      DD_WATCHER_LOCAL_SOCKET: 'file',
      DD_SERVER_PORT: 'env',
    });
    const res = createMockResponse();

    await validateCandidateConfiguration(
      jsonRequest({
        watcher: { local: { socket: '/dev/new.sock' } },
        server: { port: '4000' },
      }) as never,
      res,
    );

    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.valid).toBe(true);
    expect(payload.diff.changed).toEqual(['DD_WATCHER_LOCAL_SOCKET']);
    expect(payload.diff.reload).toEqual(['watcher']);
    expect(payload.diff.restart).toEqual([]);
  });

  test('a candidate that changes a currently file-sourced restart-required-section key is reported in diff.restart', async () => {
    Object.assign(ddEnvVars, { DD_SECURITY_SCANNER: 'trivy' });
    Object.assign(configFileSources, { DD_SECURITY_SCANNER: 'file' });
    const res = createMockResponse();

    await validateCandidateConfiguration(
      jsonRequest({ security: { scanner: 'grype' } }) as never,
      res,
    );

    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.diff.changed).toEqual(['DD_SECURITY_SCANNER']);
    expect(payload.diff.reload).toEqual([]);
    expect(payload.diff.restart).toEqual(['security']);
  });

  test('a changed key with no section segment (a degenerate "DD_" key) is reported in diff.changed but classified into neither reload nor restart', async () => {
    // Not producible by a real flattened candidate — flatten.ts's key-segment
    // regex rejects an empty segment, so a real DD_* key always has a section
    // past the prefix. Exercised directly against `configFileSources` to
    // cover `ddEnvKeyToSection`'s defensive `!section` branch, the same way
    // `config.ts`'s own `buildSections` guards a key with no segment past the
    // section name.
    Object.assign(ddEnvVars, { DD_: 'x' });
    Object.assign(configFileSources, { DD_: 'file' });
    const res = createMockResponse();

    await validateCandidateConfiguration(jsonRequest({}) as never, res);

    const payload = (res.json as any).mock.calls[0][0];
    expect(payload.diff.changed).toEqual(['DD_']);
    expect(payload.diff.reload).toEqual([]);
    expect(payload.diff.restart).toEqual([]);
  });

  test('never calls init() on a discovered component', async () => {
    const initSpy = vi.spyOn(Component.prototype, 'init');
    const res = createMockResponse();

    await validateCandidateConfiguration(
      jsonRequest({
        notification: { discord: { myhook: { url: 'https://discord.example/hook' } } },
      }) as never,
      res,
    );

    expect(initSpy).not.toHaveBeenCalled();
    initSpy.mockRestore();
  });

  test('ddEnvVars is unmutated after the call', async () => {
    Object.assign(ddEnvVars, { DD_LOG_LEVEL: 'debug' });
    const before = { ...ddEnvVars };
    const res = createMockResponse();

    await validateCandidateConfiguration(jsonRequest({ server: { port: '4000' } }) as never, res);

    expect(ddEnvVars).toStrictEqual(before);
  });

  test('records a config-validated audit entry describing the outcome, before the body is sent', async () => {
    const res = createMockResponse();

    await validateCandidateConfiguration(
      jsonRequest({
        notification: { discord: { myhook: { url: 'https://discord.example/hook' } } },
      }) as never,
      res,
    );

    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'config-validated',
      containerName: 'diagnostics',
      status: 'info',
      details: 'Validated a candidate configuration: valid',
    });
  });

  test('records a config-validated audit entry naming the error count when invalid', async () => {
    const res = createMockResponse();

    await validateCandidateConfiguration(
      jsonRequest({ agent: { node1: { secret: 'shared-secret' } } }) as never,
      res,
    );

    expect(mockRecordAuditEvent).toHaveBeenCalledWith({
      action: 'config-validated',
      containerName: 'diagnostics',
      status: 'info',
      details: 'Validated a candidate configuration: 1 error(s)',
    });
  });

  test('fails with a 500 when validation itself throws', async () => {
    const validateModule = await import('../configuration/file/validate.js');
    const spy = vi
      .spyOn(validateModule, 'validateConfiguration')
      .mockRejectedValueOnce(new Error('boom'));
    const res = createMockResponse();

    await validateCandidateConfiguration(jsonRequest({ server: { port: '4000' } }) as never, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unable to validate the candidate configuration',
    });
    spy.mockRestore();
  });

  test('response satisfies the OpenAPI contract', async () => {
    const res = createMockResponse();

    await validateCandidateConfiguration(
      jsonRequest({
        notification: { discord: { myhook: { url: 'https://discord.example/hook' } } },
      }) as never,
      res,
    );

    const contractValidation = validateOpenApiJsonResponse({
      path: '/api/v1/config/validate',
      method: 'post',
      statusCode: '200',
      payload: (res.json as any).mock.calls[0][0],
    });
    expect(contractValidation.valid).toBe(true);
    expect(contractValidation.errors).toStrictEqual([]);
  });
});
