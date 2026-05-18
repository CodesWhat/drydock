import { createMockResponse } from '../test/helpers.js';
import { requireDestructiveActionConfirmation } from './destructive-confirmation.js';

describe('requireDestructiveActionConfirmation', () => {
  test('calls next when the confirmation header matches', () => {
    const middleware = requireDestructiveActionConfirmation('Delete-Container');
    const req = {
      headers: {
        'x-dd-confirm-action': '  delete-container  ',
      },
    } as any;
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('uses the first header entry when multiple values are provided', () => {
    const middleware = requireDestructiveActionConfirmation('delete-container');
    const req = {
      headers: {
        'x-dd-confirm-action': ['wrong-value', 'delete-container'],
      },
    } as any;
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(428);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Confirmation required: X-DD-Confirm-Action=delete-container',
    });
  });

  test('rejects blank or missing confirmation header values', () => {
    const middleware = requireDestructiveActionConfirmation('delete-container');
    const blankRes = createMockResponse();
    const missingRes = createMockResponse();
    const next = vi.fn();

    middleware(
      {
        headers: {
          'x-dd-confirm-action': '   ',
        },
      } as any,
      blankRes as any,
      next,
    );
    middleware({ headers: {} } as any, missingRes as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(blankRes.status).toHaveBeenCalledWith(428);
    expect(blankRes.json).toHaveBeenCalledWith({
      error: 'Confirmation required: X-DD-Confirm-Action=delete-container',
    });
    expect(missingRes.status).toHaveBeenCalledWith(428);
    expect(missingRes.json).toHaveBeenCalledWith({
      error: 'Confirmation required: X-DD-Confirm-Action=delete-container',
    });
  });

  test('normalizeHeaderValue returns undefined for empty string (length === 0 boundary)', () => {
    // Providing an empty string header should behave exactly like missing header.
    const middleware = requireDestructiveActionConfirmation('delete-container');
    const res = createMockResponse();
    const next = vi.fn();

    middleware({ headers: { 'x-dd-confirm-action': '' } } as any, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(428);
  });

  test('actionToken with leading and trailing whitespace is normalised before comparison', () => {
    // requireDestructiveActionConfirmation trims and lowercases the actionToken.
    // If trim() were mutated away, '  Delete-Container  ' would not match 'delete-container'.
    const middleware = requireDestructiveActionConfirmation('  Delete-Container  ');
    const req = {
      headers: { 'x-dd-confirm-action': 'delete-container' },
    } as any;
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('actionToken uppercase is lowercased before comparison', () => {
    // If toLowerCase() were removed from the expectedValue computation,
    // 'DELETE-CONTAINER' would not match 'delete-container'.
    const middleware = requireDestructiveActionConfirmation('DELETE-CONTAINER');
    const req = {
      headers: { 'x-dd-confirm-action': 'delete-container' },
    } as any;
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('error message includes the original (untrimmed, original-case) actionToken', () => {
    // The error message uses the original actionToken parameter, not the normalised expectedValue.
    const middleware = requireDestructiveActionConfirmation('Delete-Container');
    const req = { headers: {} } as any;
    const res = createMockResponse();
    const next = vi.fn();

    middleware(req, res as any, next);

    expect(res.json).toHaveBeenCalledWith({
      error: 'Confirmation required: X-DD-Confirm-Action=Delete-Container',
    });
  });
});
