import { openApiDocument } from '../index.js';

type Operation = {
  operationId: string;
  responses: Record<string, { content?: Record<string, { schema: { $ref?: string } }> }>;
};
const paths = openApiDocument.paths as unknown as Record<string, Record<string, Operation>>;
const schemas = openApiDocument.components.schemas as unknown as Record<
  string,
  { properties?: Record<string, unknown>; additionalProperties?: boolean }
>;

const EXPECTED: Array<[string, string, string[]]> = [
  ['/api/v1/auth/totp-factor', 'get', ['200']],
  ['/api/v1/auth/totp-factor', 'delete', ['204', '404', '409']],
  ['/api/v1/auth/totp-enrollments', 'post', ['201', '409', '503']],
  ['/api/v1/auth/totp-enrollments/{id}', 'put', ['201', '404', '409', '410', '422']],
  ['/api/v1/auth/totp-enrollments/{id}', 'delete', ['204']],
  ['/api/v1/auth/totp-recovery-code-sets', 'post', ['201', '404', '409']],
];

describe('TOTP factor management OpenAPI', () => {
  test.each(EXPECTED)('documents %s %s with its statuses', (path, method, statuses) => {
    const operation = paths[path]?.[method];
    expect(operation, `${method} ${path}`).toBeDefined();
    for (const status of statuses) {
      expect(operation.responses[status], `${method} ${path} ${status}`).toBeDefined();
    }
  });

  test('every operation has a unique operationId', () => {
    const ids = EXPECTED.map(([path, method]) => paths[path][method].operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('only the one-time reveals can carry a secret, and the status read cannot', () => {
    const secretBearing = ['TotpEnrollmentReveal', 'TotpFactorActivated', 'TotpRecoveryCodeSet'];
    const referenced = (schema?: { $ref?: string }) => schema?.$ref?.split('/').pop();
    for (const [path, method] of EXPECTED) {
      for (const [status, response] of Object.entries(paths[path][method].responses)) {
        const name = referenced(response.content?.['application/json']?.schema);
        if (name !== undefined && secretBearing.includes(name)) {
          expect(`${method} ${path} ${status}`).toMatch(/^(post|put) .* 201$/);
        }
      }
    }
    const status = Object.keys(schemas.TotpFactorStatus.properties ?? {}).sort();
    expect(status).toEqual([
      'activatedAt',
      'pendingEnrollment',
      'recoveryCodesRemaining',
      'status',
    ]);
    const pending = Object.keys(schemas.TotpPendingEnrollment.properties ?? {}).sort();
    expect(pending).toEqual(['expiresAt', 'id', 'replacesFactor']);
    for (const name of Object.keys(schemas).filter((n) => n.startsWith('Totp'))) {
      expect(schemas[name].additionalProperties, name).toBe(false);
    }
  });
});
