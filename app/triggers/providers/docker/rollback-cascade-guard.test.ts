import { describe, expect, test } from 'vitest';
import { buildRollbackCascadeGuardError } from './rollback-cascade-guard.js';

describe('buildRollbackCascadeGuardError', () => {
  test('names the given name and the canonical name in the message', () => {
    const error = buildRollbackCascadeGuardError('web-old-1781107685468');

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Container web-old-1781107685468 is already renamed');
    expect(error.message).toContain('squatting web ');
    expect(error.message).toContain('rename web-old-1781107685468 back to web');
  });

  test('resolves the canonical name through nested rollback rename suffixes', () => {
    const error = buildRollbackCascadeGuardError('web-old-1781107685468-old-1781107699999');

    expect(error.message).toContain('squatting web ');
    expect(error.message).toContain('rename web-old-1781107685468-old-1781107699999 back to web');
    expect(error.message).not.toContain('squatting web-old-1781107685468 ');
  });

  test('includes the intentional-naming caveat for operators who named a container this way on purpose', () => {
    const error = buildRollbackCascadeGuardError('web-old-1781107685468');

    expect(error.message).toContain(
      'If you intentionally named this container "web-old-1781107685468"',
    );
    expect(error.message).toContain("conflicts with drydock's own rollback naming convention");
  });
});
