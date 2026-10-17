import { i18n, SUPPORTED_LOCALES } from '@/boot/i18n';
import {
  deleteContainer,
  previewUpdateChain,
  refreshContainer,
  revealContainerEnv,
  scanContainer,
  updateContainerPolicy,
  updateDependencyGroup,
} from '@/services/container';
import { PreviewRequestError, previewContainer } from '@/services/preview';
import { ApiError } from '@/utils/error';
import { resolveUpdateFailureReason } from '@/utils/update-error-summary';

const cases = [
  ['refresh', () => refreshContainer('c1'), 'actionToasts.recheckFailedDetail', { name: 'c1' }, ''],
  ['delete', () => deleteContainer('c1'), 'actionToasts.deleteFailedDetail', { name: 'c1' }, ''],
  [
    'policy',
    () => updateContainerPolicy('c1', 'disable'),
    'policy.toasts.failedDetail',
    {},
    ' (disable)',
  ],
  [
    'chain preview',
    () => previewUpdateChain('c1'),
    'confirmDialogs.dependencyGroup.previewFailedDetail',
    { name: 'c1' },
    '',
  ],
  [
    'chain update',
    () => updateDependencyGroup('c1', ['c1']),
    'confirmDialogs.dependencyGroup.failedDetail',
    { name: 'c1' },
    '',
  ],
  ['scan', () => scanContainer('c1'), 'actionToasts.scanFailedDetail', { name: 'c1' }, ''],
  ['reveal', () => revealContainerEnv('c1'), 'sideTabContent.revealFailed', {}, ''],
  ['preview', () => previewContainer('c1'), 'preview.toasts.failedDetail', {}, ''],
] as const;

describe('container action HTTP feedback', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    i18n.global.locale.value = 'en';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe.each(SUPPORTED_LOCALES)('%s', (locale) => {
    it.each(cases)(
      'localizes %s while keeping HTTP context',
      async (_label, request, key, params, context) => {
        i18n.global.locale.value = locale;
        for (const statusText of ['Bad Gateway', '']) {
          vi.mocked(fetch).mockResolvedValueOnce(Response.json({}, { status: 502, statusText }));
          const failure = await request().catch((error: unknown) => error);
          expect(failure).toBeInstanceOf(Error);
          expect((failure as Error).message).toBe(
            `${i18n.global.t(`containerComponents.${key}`, params)}${context} (HTTP 502)${statusText ? `: ${statusText}` : ''}`,
          );
        }
        expect(fetch).toHaveBeenCalledTimes(2);
      },
    );
  });

  it.each([
    ['policy', () => updateContainerPolicy('c1', 'disable')],
    ['chain', () => updateDependencyGroup('c1', ['c1'])],
    ['scan', () => scanContainer('c1')],
  ] as const)('retains the server diagnostic in %s', async (_label, request) => {
    i18n.global.locale.value = 'ar';
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({ error: 'Registry maintenance: abc-123' }, { status: 409 }),
    );
    await expect(request()).rejects.toThrow('Registry maintenance: abc-123');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('preserves the stale-chain error type and confirmation request', async () => {
    i18n.global.locale.value = 'fr';
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({}, { status: 409 }));
    const failure = await updateDependencyGroup('agent/root', ['agent/root']).catch(
      (error) => error,
    );
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.status).toBe(409);
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/api/v1/dependency-groups/agent%2Froot/update', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-DD-Confirm-Action': 'dependency-group-update',
      },
      body: JSON.stringify({ expectedContainerIds: ['agent/root'] }),
    });
  });

  it('uses the response-time locale without losing typed preview remediation', async () => {
    i18n.global.locale.value = 'fr';
    let finish!: (response: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = previewContainer('c1').catch((error) => error);
    i18n.global.locale.value = 'ar';
    finish(
      Response.json(
        {
          code: 'registry-missing',
          details: { registry: 'private' },
          action: { code: 'open-registry-settings', href: '/registries' },
        },
        { status: 409 },
      ),
    );
    const failure = await pending;
    expect(failure).toBeInstanceOf(PreviewRequestError);
    expect(failure).toMatchObject({
      code: 'registry-missing',
      status: 409,
      details: { registry: 'private' },
      action: { code: 'open-registry-settings', href: '/registries' },
      message: `${i18n.global.t('containerComponents.preview.toasts.failedDetail')} (HTTP 409)`,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(['fr', 'ar'] as const)('translates canonical rollback reasons in %s', (locale) => {
    i18n.global.locale.value = locale;
    expect(
      resolveUpdateFailureReason({ rollbackReason: 'health-gate-failed' }, i18n.global.t),
    ).toBe(i18n.global.t('containerComponents.backups.operationValues.health-gate-failed'));
    expect(resolveUpdateFailureReason({ rollbackReason: 'vendor_specific' }, i18n.global.t)).toBe(
      'vendor specific',
    );
    expect(resolveUpdateFailureReason({ rollbackReason: 'health-gate-failed' })).toBe(
      'health gate failed',
    );
  });
});
